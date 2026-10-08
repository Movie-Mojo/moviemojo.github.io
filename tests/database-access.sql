begin;
create temp table mojo_test_ids (a uuid,b uuid,g uuid,h uuid);
insert into mojo_test_ids values(gen_random_uuid(),gen_random_uuid(),null,null);
insert into auth.users(id,email) select a,'mojo-test-a@example.invalid' from mojo_test_ids union all select b,'mojo-test-b@example.invalid' from mojo_test_ids;
update public.user_profiles set approved=true where id in(select a from mojo_test_ids union select b from mojo_test_ids);
select set_config('request.jwt.claim.sub',(select a::text from mojo_test_ids),true);
update mojo_test_ids set g=mojo_private.create_group('Mojo transactional QA');
select set_config('request.jwt.claim.sub',(select b::text from mojo_test_ids),true);
update mojo_test_ids set h=mojo_private.create_group('Other private group');
select set_config('mojo.test.group',(select g::text from mojo_test_ids),true);
select set_config('mojo.test.other',(select h::text from mojo_test_ids),true);
select set_config('mojo.test.user',(select a::text from mojo_test_ids),true);
select set_config('request.jwt.claim.sub',(select a::text from mojo_test_ids),true);
set local role authenticated;
do $$ declare n int; gid uuid; begin
 select count(*) into n from public.groups where id=current_setting('mojo.test.group')::uuid;
 if n<>1 then raise exception 'Own group not visible'; end if;
 select count(*) into n from public.groups where id=current_setting('mojo.test.other')::uuid;
 if n<>0 then raise exception 'Other private group leaked'; end if;
 select count(*) into n from public.get_user_groups_with_counts(current_setting('mojo.test.user')::uuid);
 if n<>1 then raise exception 'Group count RPC failed'; end if;
 perform public.mojo_join_group(current_setting('mojo.test.other')::uuid);
 select count(*) into n from public.groups where id=current_setting('mojo.test.other')::uuid;
 if n<>1 then raise exception 'Invited group not visible after join'; end if;
 begin
 perform public.mojo_delete_group(current_setting('mojo.test.other')::uuid);
 raise exception 'Non-owner deletion was allowed';
 exception when raise_exception then
 if sqlerrm='Non-owner deletion was allowed' then raise; end if;
 end;
 gid=public.mojo_create_group('Personal test');
 perform public.mojo_delete_group(gid);
 if exists(select 1 from public.groups where id=gid) then raise exception 'Atomic deletion failed'; end if;
 begin
 update public.user_profiles set approved=true;
 raise exception 'Self approval was allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
update public.user_profiles set approved=false where id=current_setting('mojo.test.user')::uuid;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.groups) then raise exception 'Unapproved access was allowed'; end if;
 begin
 perform public.mojo_create_group('Blocked');
 raise exception 'Unapproved create was allowed';
 exception when raise_exception then
 if sqlerrm='Unapproved create was allowed' then raise; end if;
 end;
end $$;
reset role;
rollback;
select 'PASS: own-group reads, cross-group denial, invitation join, creator-only atomic deletion, self-approval denial, unapproved-account denial; fixtures rolled back' as verification;
