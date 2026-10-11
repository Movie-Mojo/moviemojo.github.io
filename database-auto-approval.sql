-- Automatically admit email-verified accounts; retain group membership checks.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.user_profiles(id,approved) values(new.id,new.email_confirmed_at is not null);
 return new;
end;
$$;
create function mojo_private.confirm_user_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null then
  update public.user_profiles set approved=true where id=new.id;
 end if;
 return new;
end;
$$;
revoke all on function mojo_private.confirm_user_email() from public,anon,authenticated;
create trigger mojo_email_verified after update of email_confirmed_at on auth.users for each row execute function mojo_private.confirm_user_email();
update public.user_profiles p set approved=true from auth.users u where p.id=u.id and u.email_confirmed_at is not null;
create or replace function mojo_private.approved() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.user_profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and p.approved is true and u.email_confirmed_at is not null);
$$;
