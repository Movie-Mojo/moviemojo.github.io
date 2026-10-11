alter table public.groups add column is_personal boolean not null default false;
create unique index mojo_personal_owner on public.groups(created_by) where is_personal;
create function mojo_private.personal_list(uid uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare gid uuid;
begin
 insert into public.groups(name,created_by,is_personal) values('My personal list',uid,true) on conflict(created_by) where is_personal do nothing;
 select id into gid from public.groups where created_by=uid and is_personal;
 insert into public.group_members(group_id,user_id) values(gid,uid) on conflict do nothing;
 return gid;
end; $$;
create function mojo_private.new_personal_list() returns trigger language plpgsql security definer set search_path='' as $$ begin perform mojo_private.personal_list(new.id); return new; end; $$;
create trigger mojo_personal_signup after insert on public.user_profiles for each row execute function mojo_private.new_personal_list();
select mojo_private.personal_list(id) from public.user_profiles;
create function mojo_private.guard_personal_list() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='groups' then
  if tg_op='UPDATE' and (new.is_personal is distinct from old.is_personal or (old.is_personal and new.created_by is distinct from old.created_by)) then raise exception 'Personal list ownership cannot change'; end if;
  if tg_op='DELETE' and old.is_personal and exists(select 1 from auth.users where id=old.created_by) then raise exception 'Your personal list cannot be deleted'; end if;
 else
  if tg_op='INSERT' and exists(select 1 from public.groups where id=new.group_id and is_personal and created_by<>new.user_id) then raise exception 'Personal lists cannot be shared'; end if;
  if tg_op='DELETE' and exists(select 1 from public.groups g join auth.users u on u.id=g.created_by where g.id=old.group_id and g.is_personal) then raise exception 'You cannot leave your personal list'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger mojo_personal_group_guard before update or delete on public.groups for each row execute function mojo_private.guard_personal_list();
create trigger mojo_personal_members_guard before insert or delete on public.group_members for each row execute function mojo_private.guard_personal_list();
create function public.mojo_personal_list() returns uuid language sql security invoker set search_path='' as $$ select id from public.groups where is_personal and created_by=auth.uid(); $$;
revoke all on function mojo_private.personal_list(uuid),mojo_private.new_personal_list(),mojo_private.guard_personal_list() from public,anon,authenticated;
revoke all on function public.mojo_personal_list() from public,anon;
grant execute on function public.mojo_personal_list() to authenticated;
-- Reject invitations before they can even be created.
create function mojo_private.guard_personal_invitation() returns trigger language plpgsql security definer set search_path='' as $$ begin if exists(select 1 from public.groups where id=new.group_id and is_personal) then raise exception 'Personal lists cannot be shared'; end if; return new; end; $$;
create trigger mojo_personal_invite_guard before insert or update on mojo_private.group_invitations for each row execute function mojo_private.guard_personal_invitation();
revoke all on function mojo_private.guard_personal_invitation() from public,anon,authenticated;
