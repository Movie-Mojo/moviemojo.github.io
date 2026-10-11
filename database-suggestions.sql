-- Display names are editable only by the profile owner. Approval stays admin-only.
alter table public.user_profiles add column display_name text not null default '' check (length(display_name)<=60);
grant update(display_name) on public.user_profiles to authenticated;
alter table public.group_movies add column suggestion_note text not null default '' check (length(suggestion_note)<=500);
-- Read only names of people who added movies to a group the caller belongs to.
create function mojo_private.group_contributors(target_group uuid) returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not mojo_private.member(target_group) then raise exception 'Group membership is required'; end if;
 return query select distinct gm.added_by,coalesce(nullif(trim(p.display_name),''),'Group member') from public.group_movies gm left join public.user_profiles p on p.id=gm.added_by where gm.group_id=target_group;
end;
$$;
create function mojo_private.set_suggestion_note(target_entry uuid,note text) returns void language plpgsql security definer set search_path='' as $$
declare gid uuid; author uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select group_id,added_by into gid,author from public.group_movies where id=target_entry for update;
 if not found or not mojo_private.member(gid) or author is distinct from auth.uid() then raise exception 'Only the person who added this movie can edit its note'; end if;
 if note is null or length(note)>500 then raise exception 'Keep your note to 500 characters'; end if;
 update public.group_movies set suggestion_note=trim(note) where id=target_entry;
end;
$$;
create function public.mojo_group_contributors(target_group uuid) returns table(user_id uuid,display_name text) language sql security invoker set search_path='' as $$ select * from mojo_private.group_contributors(target_group); $$;
create function public.mojo_set_suggestion_note(target_entry uuid,note text) returns void language sql security invoker set search_path='' as $$ select mojo_private.set_suggestion_note(target_entry,note); $$;
revoke all on function mojo_private.group_contributors(uuid),mojo_private.set_suggestion_note(uuid,text),public.mojo_group_contributors(uuid),public.mojo_set_suggestion_note(uuid,text) from public,anon;
grant execute on function mojo_private.group_contributors(uuid),mojo_private.set_suggestion_note(uuid,text),public.mojo_group_contributors(uuid),public.mojo_set_suggestion_note(uuid,text) to authenticated;
