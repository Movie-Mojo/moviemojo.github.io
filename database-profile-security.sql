alter table public.user_profiles add column if not exists bio text not null default '';
alter table public.user_profiles add constraint mojo_bio_length check(length(bio)<=500);
grant update(bio) on public.user_profiles to authenticated;
create or replace function mojo_private.mfa_satisfied() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
   coalesce(auth.jwt()->>'aal','aal1')='aal2'
   or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified' and f.factor_type in ('totp','phone'))
 );
$$;
revoke all on function mojo_private.mfa_satisfied() from public,anon;
grant execute on function mojo_private.mfa_satisfied() to authenticated;
create or replace function mojo_private.approved() returns boolean language sql stable security definer set search_path='' as $$
 select mojo_private.mfa_satisfied() and exists(select 1 from public.user_profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.approved is true and u.email_confirmed_at is not null);
$$;
drop policy profiles_preferences_update on public.user_profiles;
create policy profiles_preferences_update on public.user_profiles for update to authenticated
using(id=(select auth.uid()) and (select mojo_private.mfa_satisfied()))
with check(id=(select auth.uid()) and (select mojo_private.mfa_satisfied()));
drop policy profiles_read on public.user_profiles;
create policy profiles_read on public.user_profiles for select to authenticated
using(id=(select auth.uid()) and (select mojo_private.mfa_satisfied()));
