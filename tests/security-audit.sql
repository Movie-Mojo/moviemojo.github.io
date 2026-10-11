-- Isolated security checks. All fixture data is rolled back.
begin;
create temp table audit_ids(a uuid,b uuid,g uuid,m uuid);
insert into audit_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,email_confirmed_at) select a,'security-a@example.invalid',now() from audit_ids union all select b,'security-b@example.invalid',now() from audit_ids;
insert into public.groups(id,name,created_by) select g,'Security private group',a from audit_ids;
insert into public.group_members(group_id,user_id) select g,a from audit_ids;
insert into public.movies(id,created_by,title,description) select m,a,'Security private manual title','fixture only' from audit_ids;
insert into public.group_movies(group_id,movie_id,added_by) select g,m,a from audit_ids;
select set_config('audit.a',(select a::text from audit_ids),true),set_config('audit.b',(select b::text from audit_ids),true),set_config('audit.g',(select g::text from audit_ids),true),set_config('audit.m',(select m::text from audit_ids),true);
select set_config('request.jwt.claim.sub',(select b::text from audit_ids),true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.groups where id=current_setting('audit.g')::uuid) then raise exception 'FAIL: private group leaked'; end if;
 if exists(select 1 from public.group_movies where group_id=current_setting('audit.g')::uuid) then raise exception 'FAIL: private membership leaked'; end if;
 if exists(select 1 from public.user_profiles where id=current_setting('audit.a')::uuid) then raise exception 'FAIL: another profile leaked'; end if;
 begin
  perform public.mojo_group_people(current_setting('audit.g')::uuid);
  raise exception 'FAIL: unauthorized group people access';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 begin
  perform public.mojo_watched_profile(current_setting('audit.a')::uuid);
  raise exception 'FAIL: nonfriend watched access';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 begin
  update public.user_profiles set approved=true where id=auth.uid();
  raise exception 'FAIL: self approval';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.movies where id=current_setting('audit.m')::uuid) then raise exception 'FAIL: private manual metadata leaked'; end if;
 begin
  insert into public.groups(name,created_by) values(repeat('x',1000),auth.uid());
  raise exception 'FAIL: long group name allowed';
 exception when check_violation then null; end;
 begin
  insert into public.movies(title,description) values(repeat('x',1000),repeat('y',10001));
  raise exception 'FAIL: oversized movie allowed';
 exception when check_violation then null; end;
 -- SQL-looking text must remain literal data, never an executable query.
 insert into public.movies(title) values($payload$'); DROP TABLE public.groups; --$payload$);
 if to_regclass('public.groups') is null then raise exception 'FAIL: SQL injection'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform 1 from public.groups limit 1;
  raise exception 'FAIL: anonymous table read';
 exception when insufficient_privilege then null; end;
 begin
  perform public.mojo_create_group('unauthorized');
  raise exception 'FAIL: anonymous RPC';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: group/profile isolation, nonfriend denial, self-approval denial, anonymous denial, literal SQL input. PASS: private movie isolation and DB length limits. All fixtures rolled back.' as verification;
