-- Personal exceptions never change a shared group's watched status.
create table mojo_private.watched_exclusions(user_id uuid not null references auth.users on delete cascade,movie_id uuid not null references public.movies on delete cascade,primary key(user_id,movie_id));
alter table mojo_private.watched_exclusions enable row level security;
revoke all on mojo_private.watched_exclusions from public,anon,authenticated;
create function mojo_private.watched_profile(person uuid,action text default 'list',movie uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 if person is distinct from auth.uid() and not exists(select 1 from mojo_private.friendships f where f.accepted and ((f.requester=auth.uid() and f.recipient=person) or (f.recipient=auth.uid() and f.requester=person))) then raise exception 'Only friends can view watched profiles'; end if;
 if action in('remove','restore') then
  if person is distinct from auth.uid() then raise exception 'Only edit your own watched history'; end if;
  if action='remove' then
   if not exists(select 1 from public.group_movies gm join public.group_members m on m.group_id=gm.group_id where m.user_id=person and gm.movie_id=movie and gm.watched) then raise exception 'Movie is not in your watched history'; end if;
   insert into mojo_private.watched_exclusions(user_id,movie_id) values(person,movie) on conflict do nothing;
  else delete from mojo_private.watched_exclusions where user_id=person and movie_id=movie;
  end if;
 elsif action<>'list' then raise exception 'Unknown action'; end if;
 with watched as (
 select gm.movie_id,max(coalesce(gm.watched_at,gm.added_at)) as watched_at from public.group_movies gm join public.group_members mem on mem.group_id=gm.group_id where mem.user_id=person and gm.watched group by gm.movie_id
 ), items as (
 select m.id,m.title,m.tmdb_id,m.poster_url,m.release_year,w.watched_at,e.movie_id is not null as excluded from watched w join public.movies m on m.id=w.movie_id left join mojo_private.watched_exclusions e on e.user_id=person and e.movie_id=m.id
 ) select jsonb_build_object('name',coalesce((select nullif(trim(display_name),'') from public.user_profiles where id=person),'Movie friend'),'movies',coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by watched_at desc,title) from items i where not excluded),'[]'::jsonb),'excluded',case when person=auth.uid() then coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by title) from items i where excluded),'[]'::jsonb) else '[]'::jsonb end) into result;
 return result;
end; $$;
create function public.mojo_watched_profile(person uuid,action text default 'list',movie uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select mojo_private.watched_profile(person,action,movie); $$;
revoke all on function mojo_private.watched_profile(uuid,text,uuid),public.mojo_watched_profile(uuid,text,uuid) from public,anon;
grant execute on function mojo_private.watched_profile(uuid,text,uuid),public.mojo_watched_profile(uuid,text,uuid) to authenticated;
