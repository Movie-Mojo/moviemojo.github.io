-- Group-wide completion status; personal ratings are stored independently.
alter table public.group_movies add column dnf boolean not null default false;
alter table public.group_movies add column dnf_at timestamptz;
alter table public.group_movies add constraint mojo_completion_status check(not(dnf and coalesce(watched,false)));
grant update(dnf,dnf_at) on public.group_movies to authenticated;

create table public.movie_ratings (
 user_id uuid not null references auth.users(id) on delete cascade,
 movie_id uuid not null references public.movies(id) on delete cascade,
 stars smallint not null check(stars between 1 and 5),
 updated_at timestamptz not null default now(),
 primary key(user_id,movie_id)
);
alter table public.movie_ratings enable row level security;
revoke all on public.movie_ratings from public,anon,authenticated;
grant select,insert,delete on public.movie_ratings to authenticated;
grant update(stars,updated_at) on public.movie_ratings to authenticated;
create policy personal_rating_read on public.movie_ratings for select to authenticated
 using(user_id=(select auth.uid()) and (select mojo_private.approved()));
create policy personal_rating_insert on public.movie_ratings for insert to authenticated
 with check(user_id=(select auth.uid()) and (select mojo_private.approved()) and exists(select 1 from public.group_movies gm where gm.movie_id=movie_ratings.movie_id and mojo_private.member(gm.group_id)));
create policy personal_rating_update on public.movie_ratings for update to authenticated
 using(user_id=(select auth.uid()) and (select mojo_private.approved()))
 with check(user_id=(select auth.uid()) and (select mojo_private.approved()) and exists(select 1 from public.group_movies gm where gm.movie_id=movie_ratings.movie_id and mojo_private.member(gm.group_id)));
create policy personal_rating_delete on public.movie_ratings for delete to authenticated
 using(user_id=(select auth.uid()) and (select mojo_private.approved()));
create index mojo_personal_ratings_movie on public.movie_ratings(movie_id);
