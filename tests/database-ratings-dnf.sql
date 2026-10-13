begin;
select set_config('test.user1',gen_random_uuid()::text,true),set_config('test.user2',gen_random_uuid()::text,true),set_config('test.group',gen_random_uuid()::text,true),set_config('test.movie',gen_random_uuid()::text,true),set_config('test.entry',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at)
select current_setting('test.'||name)::uuid,'rating-test-'||current_setting('test.'||name)||'@example.invalid',now(),now(),now() from unnest(array['user1','user2']) name;
insert into public.groups(id,name,created_by) values(current_setting('test.group')::uuid,'Temporary rating test',current_setting('test.user1')::uuid);
insert into public.group_members(group_id,user_id) select current_setting('test.group')::uuid,current_setting('test.'||name)::uuid from unnest(array['user1','user2']) name;
insert into mojo_private.friendships(requester,recipient,accepted) values(current_setting('test.user1')::uuid,current_setting('test.user2')::uuid,true);
insert into public.movies(id,title) values(current_setting('test.movie')::uuid,'Temporary rating test movie');
insert into public.group_movies(id,group_id,movie_id,added_by) values(current_setting('test.entry')::uuid,current_setting('test.group')::uuid,current_setting('test.movie')::uuid,current_setting('test.user1')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user1'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$ begin
 begin
  insert into public.movie_ratings(user_id,movie_id,stars) values(auth.uid(),current_setting('test.movie')::uuid,4);
  raise exception 'uncompleted movie rating allowed';
 exception when insufficient_privilege then null; end;
end $$;
select public.mojo_mark_completion(current_setting('test.entry')::uuid,'watched',4::smallint);
update public.movie_ratings set stars=5 where movie_id=current_setting('test.movie')::uuid;
do $$ begin
 begin
  update public.movie_ratings set stars=6 where movie_id=current_setting('test.movie')::uuid;
  raise exception 'out of range rating allowed';
 exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user2'),'role','authenticated','aal','aal1')::text,true);
do $$ begin
 if exists(select 1 from public.movie_ratings where movie_id=current_setting('test.movie')::uuid) then raise exception 'another user rating exposed'; end if;
 begin
  insert into public.movie_ratings(user_id,movie_id,stars) values(current_setting('test.user1')::uuid,current_setting('test.movie')::uuid,1);
  raise exception 'impersonated rating allowed';
 exception when insufficient_privilege then null; end;
 update public.movie_ratings set stars=1 where user_id=current_setting('test.user1')::uuid;
 if found then raise exception 'another user rating editable'; end if;
 delete from public.movie_ratings where user_id=current_setting('test.user1')::uuid;
 if found then raise exception 'another user rating deletable'; end if;
end $$;
insert into public.movie_ratings(user_id,movie_id,stars) values(auth.uid(),current_setting('test.movie')::uuid,2);
do $$ declare history jsonb; begin
 history=public.mojo_watched_profile(current_setting('test.user1')::uuid);
 if exists(select 1 from jsonb_array_elements(history->'movies') item where item->>'id'=current_setting('test.movie') and item->>'personal_rating' is not null) then raise exception 'friend history exposes private rating'; end if;
end $$;
update public.group_movies set dnf=true,dnf_at=now(),watched=false,watched_at=null where id=current_setting('test.entry')::uuid;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.user1'),'role','authenticated','aal','aal1')::text,true);
do $$ begin
 if not exists(select 1 from public.group_movies where id=current_setting('test.entry')::uuid and dnf and not watched) then raise exception 'DNF not shared'; end if;
 if (select stars from public.movie_ratings where movie_id=current_setting('test.movie')::uuid)<>5 then raise exception 'personal rating overwritten'; end if;
 begin
  update public.group_movies set watched=true where id=current_setting('test.entry')::uuid;
  raise exception 'watched and DNF simultaneously allowed';
 exception when check_violation then null; end;
 update public.group_movies set watched=true,watched_at=now(),dnf=false,dnf_at=null where id=current_setting('test.entry')::uuid;
 delete from public.movie_ratings where movie_id=current_setting('test.movie')::uuid;
 if not found then raise exception 'own rating clear failed'; end if;
end $$;
select public.mojo_mark_completion(current_setting('test.entry')::uuid,'dnf',3::smallint);
reset role;
select set_config('test.group2',gen_random_uuid()::text,true),set_config('test.entry2',gen_random_uuid()::text,true);
insert into public.groups(id,name,created_by) values(current_setting('test.group2')::uuid,'Temporary second rating group',current_setting('test.user1')::uuid);
insert into public.group_members(group_id,user_id) values(current_setting('test.group2')::uuid,current_setting('test.user1')::uuid);
insert into public.group_movies(id,group_id,movie_id,added_by,watched,watched_at) values(current_setting('test.entry2')::uuid,current_setting('test.group2')::uuid,current_setting('test.movie')::uuid,current_setting('test.user1')::uuid,true,now()+interval '1 minute');
set local role authenticated;
do $$ declare history jsonb; item jsonb; begin
 history=public.mojo_watched_profile(auth.uid());
 select value into item from jsonb_array_elements(history->'movies') where value->>'id'=current_setting('test.movie');
 if item->>'status'<>'watched' or (item->>'personal_rating')::int<>3 then raise exception 'latest watched or preserved rating incorrect: %',item; end if;
 update public.group_movies set dnf_at=now()+interval '2 minute' where id=current_setting('test.entry')::uuid;
 history=public.mojo_watched_profile(auth.uid());
 select value into item from jsonb_array_elements(history->'movies') where value->>'id'=current_setting('test.movie');
 if item->>'status'<>'dnf' or (item->>'personal_rating')::int<>3 then raise exception 'latest DNF or preserved rating incorrect: %',item; end if;
 perform public.mojo_mark_completion(current_setting('test.entry2')::uuid,'watched',null);
 if (select stars from public.movie_ratings where movie_id=current_setting('test.movie')::uuid)<>3 then raise exception 'skipped rating changed existing rating'; end if;
 history=public.mojo_watched_profile(auth.uid(),'remove',current_setting('test.movie')::uuid);
 if exists(select 1 from jsonb_array_elements(history->'movies') histrow(value) where histrow.value->>'id'=current_setting('test.movie')) then raise exception 'DNF removal failed'; end if;
 perform public.mojo_watched_profile(auth.uid(),'restore',current_setting('test.movie')::uuid);
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform 1 from public.movie_ratings;
  raise exception 'anonymous rating read allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
