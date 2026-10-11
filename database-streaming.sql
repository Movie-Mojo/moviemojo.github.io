-- Private profile preferences; approval remains admin-only.
alter table public.user_profiles add column streaming_services integer[] not null default '{}';
alter table public.user_profiles add column streaming_region text not null default 'US' check (streaming_region in ('US','GB','CA','AU'));
alter table public.user_profiles add constraint streaming_services_valid check (cardinality(streaming_services)<=500 and 0 < all(streaming_services) and array_position(streaming_services,null) is null);
create policy profiles_preferences_update on public.user_profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
grant update(streaming_services,streaming_region) on public.user_profiles to authenticated;
