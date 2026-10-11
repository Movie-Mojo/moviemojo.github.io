begin;
create temp table proxy_ids(a uuid,b uuid,c uuid);
insert into proxy_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at) select a,'proxy-a@example.invalid',now() from proxy_ids union all select b,'proxy-b@example.invalid',null from proxy_ids union all select c,'proxy-c@example.invalid',now() from proxy_ids;
select set_config('proxy.a',(select a::text from proxy_ids),true),set_config('proxy.b',(select b::text from proxy_ids),true),set_config('proxy.c',(select c::text from proxy_ids),true);
select set_config('request.jwt.claim.sub',current_setting('proxy.a'),true);
set local role authenticated;
do $$ begin
 for i in 1..120 loop
  if not public.mojo_movie_request_allowed() then raise exception 'FAIL: normal request blocked'; end if;
 end loop;
 if public.mojo_movie_request_allowed() then raise exception 'FAIL: user limit bypassed'; end if;
 begin
  perform * from mojo_private.movie_request_limits;
  raise exception 'FAIL: counters exposed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('proxy.b'),true);
do $$ begin
 begin
  perform public.mojo_movie_request_allowed(); raise exception 'FAIL: unverified account allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into mojo_private.movie_request_limits values('*',date_trunc('minute',now()),1200) on conflict(subject,bucket) do update set requests=1200;
select set_config('request.jwt.claim.sub',current_setting('proxy.c'),true);
set local role authenticated;
do $$ begin
 if public.mojo_movie_request_allowed() then raise exception 'FAIL: project limit bypassed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ begin
 begin
  perform public.mojo_movie_request_allowed(); raise exception 'FAIL: anonymous caller allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: verified approval, user and shared project caps, private counter isolation, anonymous denial' as result;
rollback;
