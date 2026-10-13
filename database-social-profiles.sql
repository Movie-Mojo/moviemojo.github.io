-- Personal history changes never alter the shared group entry.
create table mojo_private.history_statuses(user_id uuid not null references auth.users(id) on delete cascade,movie_id uuid not null references public.movies(id) on delete cascade,status text not null check(status in ('watched','dnf')),updated_at timestamptz not null default now(),primary key(user_id,movie_id));
alter table mojo_private.history_statuses enable row level security;
revoke all on mojo_private.history_statuses from public,anon,authenticated;
create index history_statuses_movie on mojo_private.history_statuses(movie_id);
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
 with events as (
 select gm.movie_id,case when gm.dnf then 'dnf' else 'watched' end as status,
 coalesce(case when gm.dnf then gm.dnf_at else gm.watched_at end,gm.added_at) as watched_at,0 as priority
 from public.group_movies gm join public.group_members mem on mem.group_id=gm.group_id
 where mem.user_id=person and (gm.watched or gm.dnf)
 union all
 select h.movie_id,h.status,h.updated_at,1 from mojo_private.history_statuses h
 where h.user_id=person and exists(select 1 from public.group_movies gm join public.group_members mem on mem.group_id=gm.group_id where mem.user_id=person and gm.movie_id=h.movie_id and (gm.watched or gm.dnf))
 ), watched as (
 select distinct on(movie_id) movie_id,status,watched_at from events order by movie_id,watched_at desc,priority desc
 ), items as (
 select m.id,m.title,m.tmdb_id,m.poster_url,m.release_year,w.watched_at,w.status,r.stars as personal_rating,e.movie_id is not null as excluded from watched w join public.movies m on m.id=w.movie_id left join public.movie_ratings r on r.movie_id=m.id and r.user_id=person left join mojo_private.watched_exclusions e on e.user_id=person and e.movie_id=m.id
 ) select jsonb_build_object('name',coalesce((select nullif(trim(display_name),'') from public.user_profiles where id=person),'Movie friend'),'movies',coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by watched_at desc,title) from items i where not excluded),'[]'::jsonb),'excluded',case when person=auth.uid() then coalesce((select jsonb_agg(to_jsonb(i)-'excluded' order by title) from items i where excluded),'[]'::jsonb) else '[]'::jsonb end) into result;
 return result;
end; $$;


create function mojo_private.profile_details(person uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 if person is distinct from auth.uid() and not exists(select 1 from mojo_private.friendships f where f.accepted and ((f.requester=auth.uid() and f.recipient=person) or (f.recipient=auth.uid() and f.requester=person))) then raise exception 'Only friends can view this profile'; end if;
 return (select jsonb_build_object('name',coalesce(nullif(p.display_name,''),'Movie friend'),'bio',p.bio,'friend_count',(select count(*) from mojo_private.friendships f where f.accepted and person in(f.requester,f.recipient)),'group_count',(select count(*) from public.group_members m join public.groups g on g.id=m.group_id where m.user_id=person and not g.is_personal)) from public.user_profiles p where p.id=person);
end; $$;
create function mojo_private.set_history_status(movie uuid,completion text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not mojo_private.approved() then raise exception 'Verify your email first'; end if;
 if completion is null or completion not in('watched','dnf') then raise exception 'Choose watched or DNF'; end if;
 if not exists(select 1 from public.group_movies gm join public.group_members m on m.group_id=gm.group_id where m.user_id=auth.uid() and gm.movie_id=movie and (gm.watched or gm.dnf)) then raise exception 'Movie is not in your history'; end if;
 insert into mojo_private.history_statuses(user_id,movie_id,status) values(auth.uid(),movie,completion) on conflict(user_id,movie_id) do update set status=excluded.status,updated_at=clock_timestamp();
 return mojo_private.watched_profile(auth.uid());
end; $$;
create function mojo_private.group_ratings(target_group uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not mojo_private.member(target_group) then raise exception 'Only group members can view ratings'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('movie_id',gm.movie_id,'average',(select round(avg(r.stars),1) from public.movie_ratings r join public.group_members m on m.user_id=r.user_id where m.group_id=target_group and r.movie_id=gm.movie_id),'ratings',(select jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(nullif(p.display_name,''),'Movie friend'),'stars',r.stars) order by p.display_name) from public.group_members m join public.user_profiles p on p.id=m.user_id left join public.movie_ratings r on r.user_id=m.user_id and r.movie_id=gm.movie_id where m.group_id=target_group))) from public.group_movies gm where gm.group_id=target_group and (gm.watched or gm.dnf)),'[]'::jsonb);
end; $$;
create function public.mojo_profile_details(person uuid) returns jsonb language sql security invoker set search_path='' as $$select mojo_private.profile_details(person);$$;
create function public.mojo_set_history_status(movie uuid,completion text) returns jsonb language sql security invoker set search_path='' as $$select mojo_private.set_history_status(movie,completion);$$;
create function public.mojo_group_ratings(target_group uuid) returns jsonb language sql security invoker set search_path='' as $$select mojo_private.group_ratings(target_group);$$;
revoke all on function mojo_private.profile_details(uuid),mojo_private.set_history_status(uuid,text),mojo_private.group_ratings(uuid),public.mojo_profile_details(uuid),public.mojo_set_history_status(uuid,text),public.mojo_group_ratings(uuid) from public,anon;
grant execute on function mojo_private.profile_details(uuid),mojo_private.set_history_status(uuid,text),mojo_private.group_ratings(uuid),public.mojo_profile_details(uuid),public.mojo_set_history_status(uuid,text),public.mojo_group_ratings(uuid) to authenticated;
