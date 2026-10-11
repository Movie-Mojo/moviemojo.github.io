begin;
create temp table fix_ids(a uuid,b uuid,c uuid,g uuid,m uuid,t uuid,i uuid);
insert into fix_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),null,null);
insert into auth.users(id,email,email_confirmed_at) select a,'fix-a@example.invalid',now() from fix_ids union all select b,'fix-b@example.invalid',now() from fix_ids union all select c,'fix-c@example.invalid',now() from fix_ids;
insert into public.groups(id,name,created_by) select g,'Fix test group',a from fix_ids;
insert into public.group_members(group_id,user_id) select g,a from fix_ids;
insert into public.movies(id,created_by,title) select m,a,'Private title' from fix_ids;
insert into public.group_movies(group_id,movie_id,added_by,watched) select g,m,a,true from fix_ids;
select set_config('fix.a',(select a::text from fix_ids),true),set_config('fix.b',(select b::text from fix_ids),true),set_config('fix.c',(select c::text from fix_ids),true),set_config('fix.g',(select g::text from fix_ids),true),set_config('fix.m',(select m::text from fix_ids),true);
select set_config('request.jwt.claim.sub',(select a::text from fix_ids),true);
set local role authenticated;
select set_config('fix.token',(public.mojo_share_invite(current_setting('fix.g')::uuid)->>'token'),true);
do $$ declare j jsonb; begin
 j=public.mojo_share_invite(current_setting('fix.g')::uuid);
 if j->>'token'<>current_setting('fix.token') or (j->>'expires_at')::timestamptz<>now()+interval '7 days' then raise exception 'FAIL: token stability or expiry'; end if;
 begin
  perform public.mojo_share_invite(public.mojo_personal_list());
  raise exception 'FAIL: personal invite allowed';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 perform public.mojo_social('request',current_setting('fix.b')::uuid);
end $$;
select set_config('request.jwt.claim.sub',current_setting('fix.b'),true);
do $$ begin
 if exists(select 1 from public.movies where id=current_setting('fix.m')::uuid) then raise exception 'FAIL: outsider movie leak'; end if;
 begin
  perform public.mojo_accept_invite(current_setting('fix.g')::uuid);
  raise exception 'FAIL: permanent group ID bypass';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 if public.mojo_accept_invite(current_setting('fix.token')::uuid)<>current_setting('fix.g')::uuid then raise exception 'FAIL: group resolution'; end if;
 if not exists(select 1 from public.movies where id=current_setting('fix.m')::uuid) then raise exception 'FAIL: joined member movie missing'; end if;
 delete from public.group_members where group_id=current_setting('fix.g')::uuid and user_id=auth.uid();
 perform public.mojo_social('accept',current_setting('fix.a')::uuid);
 if jsonb_array_length(public.mojo_watched_profile(current_setting('fix.a')::uuid)->'movies')<>1 then raise exception 'FAIL: friend history missing'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('fix.a'),true);
select public.mojo_social('invite',current_setting('fix.b')::uuid,current_setting('fix.g')::uuid);
reset role;
update mojo_private.share_invites set expires_at=now()-interval '1 second' where token=current_setting('fix.token')::uuid;
update mojo_private.group_invitations set expires_at=now()-interval '1 second' where group_id=current_setting('fix.g')::uuid;
select set_config('fix.invitation',(select id::text from mojo_private.group_invitations where group_id=current_setting('fix.g')::uuid),true);
select set_config('request.jwt.claim.sub',current_setting('fix.c'),true);
set local role authenticated;
do $$ begin
 begin
  perform public.mojo_accept_invite(current_setting('fix.token')::uuid);
  raise exception 'FAIL: expired share accepted';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
 if exists(select 1 from public.groups where id=current_setting('fix.g')::uuid) then raise exception 'FAIL: expiry created membership'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('fix.b'),true);
do $$ begin
 if jsonb_array_length(public.mojo_social('list')->'invitations')<>0 then raise exception 'FAIL: expired friend invite listed'; end if;
 begin
  perform public.mojo_social('join',current_setting('fix.invitation')::uuid);
  raise exception 'FAIL: expired friend invite accepted';
 exception when raise_exception then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('fix.a'),true);
do $$ begin
 if public.mojo_share_invite(current_setting('fix.g')::uuid)->>'token'=current_setting('fix.token') then raise exception 'FAIL: expired token not rotated'; end if;
end $$;
reset role;
rollback;
select 'PASS: private movies, member access, separate tokens, exactly seven-day expiry, personal-list protection, expired share/direct invitation denial, token renewal; fixtures rolled back' as verification;
