create or replace function mojo_private.watched_profile(person uuid,action text default 'list',movie uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 if person is distinct from auth.uid() and not exists(select 1 from mojo_private.friendships f where f.accepted and ((f.requester=auth.uid() and f.recipient=person) or (f.recipient=auth.uid() and f.requester=person))) then raise exception 'Only friends can view watched profiles'; end if;
 if action in('remove','restore') then
  if person is distinct from auth.uid() then raise exception 'Only edit your own watched history'; end if;
  if action='remove' then
   if not exists(select 1 from public.group_movies gm join public.group_members m on m.group_id=gm.group_id where m.user_id=person and gm.movie_id=movie and (gm.watched or gm.dnf)) then raise exception 'Movie is not in your watched history'; end if;
   insert into mojo_private.watched_exclusions(user_id,movie_id) values(person,movie) on conflict do nothing;
  else delete from mojo_private.watched_exclusions where user_id=person and movie_id=movie;
  end if;
 elsif action<>'list' then raise exception 'Unknown action'; end if;
 with watched as (
 select distinct on (gm.movie_id) gm.movie_id,
 case when gm.dnf then 'dnf' else 'watched' end as status,
 coalesce(case when gm.dnf then gm.dnf_at else gm.watched_at end,gm.added_at) as watched_at
 from public.group_movies gm join public.group_members mem on mem.group_id=gm.group_id
 where mem.user_id=person and (gm.watched or gm.dnf)
 order by gm.movie_id,coalesce(case when gm.dnf then gm.dnf_at else gm.watched_at end,gm.added_at) desc,gm.id
 ), items as (
 select m.id,m.title,m.tmdb_id,m.poster_url,m.release_year,w.watched_at,w.status,case when person=auth.uid() then r.stars else null end as personal_rating,e.movie_id is not null as excluded from watched w join public.movies m on m.id=w.movie_id left join public.movie_ratings r on r.movie_id=m.id and r.user_id=person left join mojo_private.watched_exclusions e on e.user_id=person and e.movie_id=m.id
 ) select jsonb_build_object('name',coalesce((select nullif(trim(display_name),'') from public.user_profiles where id=person),'Movie friend'),'movies',coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by watched_at desc,title) from items i where not excluded),'[]'::jsonb),'excluded',case when person=auth.uid() then coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by title) from items i where excluded),'[]'::jsonb) else '[]'::jsonb end) into result;
 return result;
end; $$;

-- A rating can be written only after a completed/DNF entry exists in one of the caller's groups.
drop policy personal_rating_insert on public.movie_ratings;
drop policy personal_rating_update on public.movie_ratings;
create policy personal_rating_insert on public.movie_ratings for insert to authenticated
 with check(user_id=(select auth.uid()) and (select mojo_private.approved()) and exists(select 1 from public.group_movies gm where gm.movie_id=movie_ratings.movie_id and (gm.watched or gm.dnf) and mojo_private.member(gm.group_id)));
create policy personal_rating_update on public.movie_ratings for update to authenticated
 using(user_id=(select auth.uid()) and (select mojo_private.approved()))
 with check(user_id=(select auth.uid()) and (select mojo_private.approved()) and exists(select 1 from public.group_movies gm where gm.movie_id=movie_ratings.movie_id and (gm.watched or gm.dnf) and mojo_private.member(gm.group_id)));
create function public.mojo_completed_movies() returns table(movie_id uuid) language sql stable security invoker set search_path='' as $$
 select distinct gm.movie_id from public.group_movies gm where gm.watched or gm.dnf;
$$;
create function public.mojo_mark_completion(target_entry uuid,completion text,stars smallint default null) returns void language plpgsql security invoker set search_path='' as $$
declare mid uuid;
begin
 if completion not in ('watched','dnf') or completion is null then raise exception 'Choose watched or DNF'; end if;
 if stars is not null and stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars'; end if;
 update public.group_movies set watched=(completion='watched'),watched_at=case when completion='watched' then now() else null end,dnf=(completion='dnf'),dnf_at=case when completion='dnf' then now() else null end where id=target_entry returning movie_id into mid;
 if mid is null then raise exception 'This movie could not be updated'; end if;
 if stars is not null then
  insert into public.movie_ratings(user_id,movie_id,stars) values(auth.uid(),mid,stars) on conflict(user_id,movie_id) do update set stars=excluded.stars,updated_at=now();
 end if;
end;
$$;
revoke all on function public.mojo_completed_movies(),public.mojo_mark_completion(uuid,text,smallint) from public,anon;
grant execute on function public.mojo_completed_movies(),public.mojo_mark_completion(uuid,text,smallint) to authenticated;
