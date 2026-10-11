-- Private movie metadata and database-enforced input limits.
alter table public.movies add column created_by uuid references auth.users(id) on delete set null default auth.uid();
update public.movies m set created_by=(select gm.added_by from public.group_movies gm where gm.movie_id=m.id order by gm.added_at limit 1);
create index mojo_movies_creator on public.movies(created_by);
create index mojo_list_movie on public.group_movies(movie_id);
drop policy movies_read on public.movies;
create policy movies_read on public.movies for select to authenticated using(mojo_private.approved() and (created_by=auth.uid() or exists(select 1 from public.group_movies gm where gm.movie_id=movies.id and mojo_private.member(gm.group_id))));
drop policy movies_insert on public.movies;
create policy movies_insert on public.movies for insert to authenticated with check(mojo_private.approved() and created_by=auth.uid());
alter table public.groups add constraint mojo_group_name_length check(length(trim(name)) between 1 and 100);
alter table public.movies add constraint mojo_movie_title_length check(length(trim(title)) between 1 and case when tmdb_id is null then 200 else 500 end), add constraint mojo_movie_description_length check(length(description)<=10000), add constraint mojo_movie_tmdb_id check(tmdb_id is null or tmdb_id ~ '^[1-9][0-9]{0,11}$'), add constraint mojo_movie_year check(release_year between 1000 and 2100), add constraint mojo_movie_poster check(poster_url is null or (length(poster_url)<=2048 and poster_url ~ '^https://image[.]tmdb[.]org/t/p/[A-Za-z0-9/_.,-]+$'));
alter table public.ratings add constraint mojo_rating_comment_length check(length(comment)<=2000);
-- Share invitations use independent tokens, never a permanent group UUID.
create table mojo_private.share_invites(token uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups on delete cascade,created_by uuid not null references auth.users on delete cascade,expires_at timestamptz not null default (now()+interval '7 days'),unique(group_id,created_by));
alter table mojo_private.share_invites enable row level security;
revoke all on mojo_private.share_invites from public,anon,authenticated;
create function mojo_private.share_invite(target_group uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv mojo_private.share_invites;
begin
 if not mojo_private.member(target_group) or exists(select 1 from public.groups where id=target_group and is_personal) then raise exception 'Only members of shared groups can invite'; end if;
 perform 1 from public.groups where id=target_group for update;
 insert into mojo_private.share_invites(group_id,created_by) values(target_group,auth.uid()) on conflict(group_id,created_by) do update set token=gen_random_uuid(),expires_at=now()+interval '7 days' where share_invites.expires_at<=now();
 select * into inv from mojo_private.share_invites where group_id=target_group and created_by=auth.uid();
 return jsonb_build_object('token',inv.token,'expires_at',inv.expires_at);
end; $$;
create function public.mojo_share_invite(target_group uuid) returns jsonb language sql security invoker set search_path='' as $$ select mojo_private.share_invite(target_group); $$;
create function mojo_private.accept_invite(invite_code uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare inv mojo_private.share_invites;
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 select * into inv from mojo_private.share_invites where token=invite_code and expires_at>now();
 if not found then raise exception 'This invite is invalid or expired. Ask for a new link'; end if;
 perform 1 from public.groups where id=inv.group_id and not is_personal for update;
 perform 1 from mojo_private.share_invites where token=invite_code and expires_at>now() for update;
 if not found then raise exception 'This invite is invalid or expired. Ask for a new link'; end if;
 if not exists(select 1 from public.group_members where group_id=inv.group_id and user_id=inv.created_by) then raise exception 'This invite is no longer valid'; end if;
 insert into public.group_members(group_id,user_id) values(inv.group_id,auth.uid()) on conflict do nothing;
 return inv.group_id;
end; $$;
create function public.mojo_accept_invite(invite_code uuid) returns uuid language sql security invoker set search_path='' as $$ select mojo_private.accept_invite(invite_code); $$;
create or replace function mojo_private.join_group(invite_code uuid) returns void language plpgsql security definer set search_path='' as $$ begin perform mojo_private.accept_invite(invite_code); end; $$;
revoke all on function mojo_private.share_invite(uuid),public.mojo_share_invite(uuid),mojo_private.accept_invite(uuid),public.mojo_accept_invite(uuid) from public,anon;
grant execute on function mojo_private.share_invite(uuid),public.mojo_share_invite(uuid),mojo_private.accept_invite(uuid),public.mojo_accept_invite(uuid) to authenticated;
-- Direct friend invitations follow the same seven-day window.
alter table mojo_private.group_invitations add column expires_at timestamptz not null default(now()+interval '7 days');
update mojo_private.group_invitations set expires_at=created_at+interval '7 days';
create or replace function mojo_private.social(action text,target uuid default null,gid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); inv mojo_private.group_invitations; result jsonb;
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 perform pg_advisory_xact_lock(hashtextextended(me::text,0));
 if action='request' then
  if target=me or not exists(select 1 from public.user_profiles p join auth.users u on u.id=p.id where p.id=target and p.approved and u.email_confirmed_at is not null) then raise exception 'Check your friend code'; end if;
  if exists(select 1 from mojo_private.friendships where (requester=me and recipient=target) or (recipient=me and requester=target)) then raise exception 'You already have a friendship or pending request'; end if;
  if (select count(*) from mojo_private.friendships where requester=me and not accepted)>=50 then raise exception 'You have too many pending requests'; end if;
  insert into mojo_private.friendships(requester,recipient) values(me,target);
 elsif action='accept' then
  update mojo_private.friendships set accepted=true where requester=target and recipient=me and not accepted;
  if not found then raise exception 'Request no longer available'; end if;
 elsif action='remove' then
  delete from mojo_private.friendships where (requester=me and recipient=target) or (recipient=me and requester=target);
  delete from mojo_private.group_invitations where (sender=me and recipient=target) or (recipient=me and sender=target);
 elsif action='invite' then
  if not mojo_private.member(gid) or not exists(select 1 from mojo_private.friendships where accepted and ((requester=me and recipient=target) or (recipient=me and requester=target))) then raise exception 'Invite an accepted friend to a group you belong to'; end if;
  if exists(select 1 from public.group_members where group_id=gid and user_id=target) then raise exception 'Your friend is already in this group'; end if;
  insert into mojo_private.group_invitations(group_id,sender,recipient) values(gid,me,target) on conflict(group_id,recipient) do update set sender=excluded.sender,created_at=now(),expires_at=now()+interval '7 days' where group_invitations.expires_at<=now();
 elsif action in('join','decline') then
  select * into inv from mojo_private.group_invitations where id=target and recipient=me and expires_at>now() for update;
  if not found then raise exception 'Invitation expired or no longer available'; end if;
  if action='join' then
   if not mojo_private.member(inv.group_id) then
    if not exists(select 1 from public.group_members where group_id=inv.group_id and user_id=inv.sender) then raise exception 'Invitation is no longer valid'; end if;
    insert into public.group_members(group_id,user_id) values(inv.group_id,me) on conflict do nothing;
   end if;
  end if;
  delete from mojo_private.group_invitations where id=inv.id;
 elsif action<>'list' then raise exception 'Unknown action'; end if;
 select jsonb_build_object('friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),'Movie friend'),'accepted',f.accepted,'incoming',f.recipient=me)) from mojo_private.friendships f join public.user_profiles p on p.id=case when f.requester=me then f.recipient else f.requester end where me in(f.requester,f.recipient)),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'group',g.name,'sender',coalesce(nullif(p.display_name,''),'Movie friend'))) from mojo_private.group_invitations i join public.groups g on g.id=i.group_id join public.user_profiles p on p.id=i.sender where i.recipient=me and i.expires_at>now()),'[]'::jsonb)) into result;
 return result;
end; $$;
