create table mojo_private.friendships(requester uuid references auth.users on delete cascade,recipient uuid references auth.users on delete cascade,accepted boolean not null default false,created_at timestamptz not null default now(),primary key(requester,recipient),check(requester<>recipient));
create unique index friendship_pair on mojo_private.friendships(least(requester,recipient),greatest(requester,recipient));
create index friendship_recipient on mojo_private.friendships(recipient);
create table mojo_private.group_invitations(id uuid primary key default gen_random_uuid(),group_id uuid not null references public.groups on delete cascade,sender uuid not null references auth.users on delete cascade,recipient uuid not null references auth.users on delete cascade,created_at timestamptz not null default now(),unique(group_id,recipient));
alter table mojo_private.friendships enable row level security;
alter table mojo_private.group_invitations enable row level security;
revoke all on mojo_private.friendships,mojo_private.group_invitations from public,anon,authenticated;
create function mojo_private.social(action text,target uuid default null,gid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
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
  insert into mojo_private.group_invitations(group_id,sender,recipient) values(gid,me,target) on conflict(group_id,recipient) do nothing;
 elsif action in('join','decline') then
  select * into inv from mojo_private.group_invitations where id=target and recipient=me for update;
  if not found then raise exception 'Invitation no longer available'; end if;
  if action='join' then
   if not mojo_private.member(inv.group_id) then
    if not exists(select 1 from public.group_members where group_id=inv.group_id and user_id=inv.sender) then raise exception 'Invitation is no longer valid'; end if;
    insert into public.group_members(group_id,user_id) values(inv.group_id,me) on conflict do nothing;
   end if;
  end if;
  delete from mojo_private.group_invitations where id=inv.id;
 elsif action<>'list' then raise exception 'Unknown action'; end if;
 select jsonb_build_object('friends',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(p.display_name,''),'Movie friend'),'accepted',f.accepted,'incoming',f.recipient=me)) from mojo_private.friendships f join public.user_profiles p on p.id=case when f.requester=me then f.recipient else f.requester end where me in(f.requester,f.recipient)),'[]'::jsonb),'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'group',g.name,'sender',coalesce(nullif(p.display_name,''),'Movie friend'))) from mojo_private.group_invitations i join public.groups g on g.id=i.group_id join public.user_profiles p on p.id=i.sender where i.recipient=me),'[]'::jsonb)) into result;
 return result;
end; $$;
create function public.mojo_social(action text,target uuid default null,gid uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select mojo_private.social(action,target,gid); $$;
revoke all on function mojo_private.social(text,uuid,uuid),public.mojo_social(text,uuid,uuid) from public,anon;
grant execute on function mojo_private.social(text,uuid,uuid),public.mojo_social(text,uuid,uuid) to authenticated;
