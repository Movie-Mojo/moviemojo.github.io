begin;
create temp table suggestion_test(a uuid,b uuid,g uuid,m uuid,e uuid);
insert into suggestion_test values(gen_random_uuid(),gen_random_uuid(),null,null,null);
insert into auth.users(id,email) select a,'suggestion-a@example.invalid' from suggestion_test union all select b,'suggestion-b@example.invalid' from suggestion_test;
update auth.users set email_confirmed_at=now() where email like '%example.invalid';
update public.user_profiles set approved=true where id in(select a from suggestion_test union select b from suggestion_test);
select set_config('request.jwt.claim.sub',(select a::text from suggestion_test),true);
update suggestion_test set g=mojo_private.create_group('Suggestion QA');
with inserted as(insert into public.movies(title) values('Suggestion QA') returning id) update suggestion_test set m=(select id from inserted);
with inserted as(insert into public.group_movies(group_id,movie_id,added_by,suggestion_note) select g,m,a,'Original' from suggestion_test returning id) update suggestion_test set e=(select id from inserted);
select set_config('mojo.test.group',(select g::text from suggestion_test),true),set_config('mojo.test.entry',(select e::text from suggestion_test),true),set_config('mojo.test.other',(select b::text from suggestion_test),true);
set local role authenticated;
do $$ begin
 update public.user_profiles set display_name='Alex' where id=auth.uid();
 perform public.mojo_set_suggestion_note(current_setting('mojo.test.entry')::uuid,' Updated ');
 if not exists(select 1 from public.group_movies where id=current_setting('mojo.test.entry')::uuid and suggestion_note='Updated') then raise exception 'Author note update failed'; end if;
 if not exists(select 1 from public.mojo_group_contributors(current_setting('mojo.test.group')::uuid) where display_name='Alex') then raise exception 'Contributor name missing'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('mojo.test.other'),true);
do $$ begin
 begin
 perform public.mojo_group_contributors(current_setting('mojo.test.group')::uuid);
 raise exception 'Outsider names leaked';
 exception when raise_exception then if sqlerrm='Outsider names leaked' then raise; end if; end;
 perform public.mojo_join_group(current_setting('mojo.test.group')::uuid);
 begin
 perform public.mojo_set_suggestion_note(current_setting('mojo.test.entry')::uuid,'Unauthorized');
 raise exception 'Non-author edit allowed';
 exception when raise_exception then if sqlerrm='Non-author edit allowed' then raise; end if; end;
 begin
 update public.group_movies set suggestion_note='Direct bypass';
 raise exception 'Direct edit allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: names visible to members only, author note editing, non-author and direct-update denial; fixtures rolled back' as verification;
