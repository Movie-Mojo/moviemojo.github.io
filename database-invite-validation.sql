create or replace function mojo_private.invite_valid(invite_code uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select mojo_private.approved() and exists (
   select 1 from mojo_private.share_invites i
   join public.groups g on g.id=i.group_id
   where i.token=invite_code and i.expires_at>now() and not g.is_personal
   and exists(select 1 from public.group_members m where m.group_id=i.group_id and m.user_id=i.created_by)
 );
$$;
create or replace function public.mojo_invite_valid(invite_code uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select mojo_private.invite_valid(invite_code); $$;
revoke all on function mojo_private.invite_valid(uuid),public.mojo_invite_valid(uuid) from public,anon;
grant execute on function mojo_private.invite_valid(uuid),public.mojo_invite_valid(uuid) to authenticated;
