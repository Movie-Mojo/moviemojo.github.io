begin;
select set_config('test.mfa_uid',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
values(current_setting('test.mfa_uid')::uuid,'mfa-test-'||current_setting('test.mfa_uid')||'@example.invalid',now(),now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.mfa_uid'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$ begin
 if not mojo_private.approved() then raise exception 'non-enrolled approved account rejected'; end if;
 update public.user_profiles set bio='Test bio' where id=auth.uid();
 if not found then raise exception 'bio update failed'; end if;
 begin
   update public.user_profiles set approved=false where id=auth.uid();
   raise exception 'approval modification unexpectedly allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into auth.mfa_factors(id,user_id,factor_type,status,secret,created_at,updated_at)
values(gen_random_uuid(),current_setting('test.mfa_uid')::uuid,'totp','verified','synthetic-test-only',now(),now());
set local role authenticated;
do $$ begin
 if mojo_private.approved() then raise exception 'AAL1 account with MFA unexpectedly approved'; end if;
 if exists(select 1 from public.groups) then raise exception 'AAL1 can read groups'; end if;
 update public.user_profiles set bio='Blocked change' where id=auth.uid();
 if found then raise exception 'AAL1 can edit preferences'; end if;
 begin
   perform public.mojo_movie_request_allowed();
   raise exception 'movie API gate unexpectedly allowed AAL1';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.mfa_uid'),'role','authenticated','aal','aal2')::text,true);
do $$ begin
 if not mojo_private.approved() then raise exception 'AAL2 rejected'; end if;
 if not exists(select 1 from public.groups) then raise exception 'AAL2 cannot read own group'; end if;
 update public.user_profiles set bio='Verified change' where id=auth.uid();
 if not found then raise exception 'AAL2 cannot update bio'; end if;
 if not public.mojo_movie_request_allowed() then raise exception 'AAL2 movie gate rejected'; end if;
end $$;
reset role;
select 'PASS: optional MFA, AAL1 denial, AAL2 access, bio permissions and API gate' as result;
rollback;
