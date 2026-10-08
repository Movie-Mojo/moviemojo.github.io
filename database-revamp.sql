-- Movie Mojo: private watchlists, atomic group operations, and safe RPC access.
-- Privileged implementations live in an unexposed schema and check the caller.
create schema if not exists mojo_private;
revoke all on schema mojo_private from public, anon;
grant usage on schema mojo_private to authenticated;
create or replace function mojo_private.approved() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.user_profiles where id=auth.uid() and approved is true);
$$;
create or replace function mojo_private.member(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select mojo_private.approved() and exists(select 1 from public.group_members where group_id=gid and user_id=auth.uid());
$$;
create or replace function mojo_private.owner(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select mojo_private.approved() and exists(select 1 from public.groups where id=gid and created_by=auth.uid());
$$;
-- Replace permissive policies; approval alone must never grant all-group access.
do $$ declare p record; begin
 for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('groups','group_members','group_movies','movies','ratings','user_profiles') loop
 execute format('drop policy %I on public.%I',p.policyname,p.tablename);
 end loop;
end $$;
create policy groups_read on public.groups for select to authenticated using(mojo_private.member(id) or mojo_private.owner(id));
create policy groups_insert on public.groups for insert to authenticated with check(mojo_private.approved() and created_by=auth.uid());
create policy groups_update on public.groups for update to authenticated using(mojo_private.owner(id)) with check(mojo_private.owner(id) and created_by=auth.uid());
create policy groups_delete on public.groups for delete to authenticated using(mojo_private.owner(id));
create policy members_read on public.group_members for select to authenticated using(mojo_private.member(group_id) or mojo_private.owner(group_id));
create policy members_leave on public.group_members for delete to authenticated using(mojo_private.approved() and user_id=auth.uid());
create policy list_read on public.group_movies for select to authenticated using(mojo_private.member(group_id));
create policy list_insert on public.group_movies for insert to authenticated with check(mojo_private.member(group_id) and added_by=auth.uid());
create policy list_update on public.group_movies for update to authenticated using(mojo_private.member(group_id)) with check(mojo_private.member(group_id));
create policy list_delete on public.group_movies for delete to authenticated using(mojo_private.member(group_id));
create policy movies_read on public.movies for select to authenticated using(mojo_private.approved());
create policy movies_insert on public.movies for insert to authenticated with check(mojo_private.approved());
create policy ratings_read on public.ratings for select to authenticated using(mojo_private.member(group_id));
create policy ratings_insert on public.ratings for insert to authenticated with check(mojo_private.member(group_id) and user_id=auth.uid());
create policy ratings_update on public.ratings for update to authenticated using(mojo_private.member(group_id) and user_id=auth.uid()) with check(mojo_private.member(group_id) and user_id=auth.uid());
create policy ratings_delete on public.ratings for delete to authenticated using(mojo_private.member(group_id) and user_id=auth.uid());
create policy profiles_read on public.user_profiles for select to authenticated using(id=auth.uid());
-- Browser clients cannot approve themselves or alter membership directly.
revoke all on public.groups,public.group_members,public.group_movies,public.movies,public.ratings,public.user_profiles from anon;
revoke insert,update,delete on public.user_profiles from authenticated;
revoke insert,update on public.group_members from authenticated;
grant select on public.user_profiles,public.group_members to authenticated;
grant delete on public.group_members to authenticated;
grant select,insert,update,delete on public.groups,public.group_movies,public.ratings to authenticated;
grant select,insert on public.movies to authenticated;
revoke update,delete on public.movies from authenticated;
-- Only mutable watch status columns may be updated by the browser.
revoke update on public.group_movies from authenticated;
grant update(watched,watched_at) on public.group_movies to authenticated;
create or replace function mojo_private.create_group(group_name text) returns uuid language plpgsql security definer set search_path='' as $$
 declare gid uuid; begin
 if not mojo_private.approved() then raise exception 'An approved account is required'; end if;
 if length(trim(group_name))=0 or length(trim(group_name))>100 then raise exception 'Enter a name up to 100 characters'; end if;
 insert into public.groups(name,created_by) values(trim(group_name),auth.uid()) returning id into gid;
 insert into public.group_members(group_id,user_id) values(gid,auth.uid());
 return gid;
 end;
$$;
create or replace function mojo_private.join_group(invite_code uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not mojo_private.approved() then raise exception 'An approved account is required'; end if;
 perform 1 from public.groups where id=invite_code for update;
 if not found then raise exception 'Group not found. Check your invite code'; end if;
 if exists(select 1 from public.group_members where group_id=invite_code and user_id=auth.uid()) then raise exception 'You already belong to this group'; end if;
 insert into public.group_members(group_id,user_id) values(invite_code,auth.uid());
 end;
$$;
create or replace function mojo_private.delete_group(target_group uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not mojo_private.owner(target_group) then raise exception 'Only the group creator can delete this watchlist'; end if;
 perform 1 from public.groups where id=target_group for update;
 delete from public.ratings where group_id=target_group;
 delete from public.group_movies where group_id=target_group;
 delete from public.group_members where group_id=target_group;
 delete from public.groups where id=target_group;
 end;
$$;
create or replace function public.mojo_create_group(group_name text) returns uuid language sql security invoker set search_path='' as $$ select mojo_private.create_group(group_name); $$;
create or replace function public.mojo_join_group(invite_code uuid) returns void language sql security invoker set search_path='' as $$ select mojo_private.join_group(invite_code); $$;
create or replace function public.mojo_delete_group(target_group uuid) returns void language sql security invoker set search_path='' as $$ select mojo_private.delete_group(target_group); $$;
create or replace function public.get_user_groups_with_counts(uid uuid) returns table(group_id uuid,group_name text,created_by uuid,member_count bigint) language sql security invoker set search_path='' as $$
 select g.id,g.name,g.created_by,(select count(*) from public.group_members gm where gm.group_id=g.id)
 from public.groups g where uid=auth.uid() and mojo_private.member(g.id);
$$;
revoke all on all functions in schema mojo_private from public,anon;
grant execute on all functions in schema mojo_private to authenticated;
revoke all on function public.mojo_create_group(text),public.mojo_join_group(uuid),public.mojo_delete_group(uuid),public.get_user_groups_with_counts(uuid) from public,anon;
grant execute on function public.mojo_create_group(text),public.mojo_join_group(uuid),public.mojo_delete_group(uuid),public.get_user_groups_with_counts(uuid) to authenticated;
create index if not exists mojo_members_user_group on public.group_members(user_id,group_id);
create index if not exists mojo_members_group on public.group_members(group_id);
create index if not exists mojo_list_group on public.group_movies(group_id);
create index if not exists mojo_movies_tmdb on public.movies(tmdb_id);
create index if not exists mojo_ratings_group on public.ratings(group_id);
-- Signup trigger is internal, not a browser RPC.
alter function public.handle_new_user() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
