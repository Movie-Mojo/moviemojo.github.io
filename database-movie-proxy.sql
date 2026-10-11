-- Durable per-user and project-wide minute limits; no browser access to counters.
create table mojo_private.movie_request_limits (
 subject text not null, bucket timestamptz not null, requests integer not null,
 primary key(subject,bucket)
);
create index movie_request_limits_bucket on mojo_private.movie_request_limits(bucket);
alter table mojo_private.movie_request_limits enable row level security;
revoke all on mojo_private.movie_request_limits from public,anon,authenticated;
create function mojo_private.movie_request_allowed() returns boolean
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); minute timestamptz:=date_trunc('minute',now()); count integer;
begin
 if not mojo_private.approved() then raise insufficient_privilege using message='Verified account required'; end if;
 delete from mojo_private.movie_request_limits where bucket<minute-interval '10 minutes';
 insert into mojo_private.movie_request_limits as counters values(me::text,minute,1)
 on conflict(subject,bucket) do update set requests=least(counters.requests+1,121)
 returning requests into count;
 if count>120 then return false; end if;
 insert into mojo_private.movie_request_limits as counters values('*',minute,1)
 on conflict(subject,bucket) do update set requests=least(counters.requests+1,1201)
 returning requests into count;
 return count<=1200;
end $$;
create function public.mojo_movie_request_allowed() returns boolean
language sql security invoker set search_path='' as $$ select mojo_private.movie_request_allowed(); $$;
revoke all on function mojo_private.movie_request_allowed(),public.mojo_movie_request_allowed() from public,anon;
grant execute on function mojo_private.movie_request_allowed(),public.mojo_movie_request_allowed() to authenticated;
