-- Group-scoped display names, never a public profile directory.
create function mojo_private.group_people(target_group uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not mojo_private.member(target_group) then raise exception 'Group membership is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(nullif(trim(p.display_name),''),'Movie friend'),'owner',g.created_by=p.id) order by g.created_by=p.id desc,p.display_name,p.id) from public.group_members m join public.user_profiles p on p.id=m.user_id join public.groups g on g.id=m.group_id where m.group_id=target_group),'[]'::jsonb);
end; $$;
create function public.mojo_group_people(target_group uuid) returns jsonb language sql security invoker set search_path='' as $$ select mojo_private.group_people(target_group); $$;
revoke all on function mojo_private.group_people(uuid),public.mojo_group_people(uuid) from public,anon;
grant execute on function mojo_private.group_people(uuid),public.mojo_group_people(uuid) to authenticated;
