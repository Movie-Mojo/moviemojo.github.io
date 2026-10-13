begin;
select set_config('test.a',gen_random_uuid()::text,true),set_config('test.b',gen_random_uuid()::text,true),set_config('test.c',gen_random_uuid()::text,true),set_config('test.g1',gen_random_uuid()::text,true),set_config('test.g2',gen_random_uuid()::text,true),set_config('test.m',gen_random_uuid()::text,true),set_config('test.e',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) select current_setting('test.'||v)::uuid,'social-test-'||current_setting('test.'||v)||'@example.invalid',now(),now(),now() from unnest(array['a','b','c']) v;
update public.user_profiles set display_name='Profile test',bio='Bio test' where id=current_setting('test.a')::uuid;
insert into public.groups(id,name,created_by) select current_setting('test.'||v)::uuid,'Temporary social group',current_setting('test.a')::uuid from unnest(array['g1','g2']) v;
insert into public.group_members(group_id,user_id) values(current_setting('test.g1')::uuid,current_setting('test.a')::uuid),(current_setting('test.g1')::uuid,current_setting('test.b')::uuid),(current_setting('test.g2')::uuid,current_setting('test.a')::uuid);
insert into mojo_private.friendships(requester,recipient,accepted) values(current_setting('test.a')::uuid,current_setting('test.b')::uuid,true),(current_setting('test.a')::uuid,current_setting('test.c')::uuid,false);
insert into public.movies(id,title) values(current_setting('test.m')::uuid,'Temporary social test movie');
insert into public.group_movies(id,group_id,movie_id,added_by) values(current_setting('test.e')::uuid,current_setting('test.g1')::uuid,current_setting('test.m')::uuid,current_setting('test.a')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
select public.mojo_mark_completion(current_setting('test.e')::uuid,'watched',4::smallint);
do $$ declare h jsonb; p jsonb; begin
 h=public.mojo_set_history_status(current_setting('test.m')::uuid,'dnf');
 if not exists(select 1 from jsonb_array_elements(h->'movies') x where x->>'status'='dnf' and (x->>'personal_rating')::int=4) then raise exception 'personal status/rating failed'; end if;
 if not exists(select 1 from public.group_movies where id=current_setting('test.e')::uuid and watched and not dnf) then raise exception 'group entry changed'; end if;
 p=public.mojo_profile_details(auth.uid());
 if (p->>'friend_count')::int<>1 or (p->>'group_count')::int<>2 then raise exception 'counts failed %',p; end if;
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.b'),'role','authenticated','aal','aal1')::text,true);
do $$ declare h jsonb; p jsonb; begin
 p=public.mojo_profile_details(current_setting('test.a')::uuid);
 if p->>'bio'<>'Bio test' or p ? 'email' then raise exception 'friend profile fields incorrect'; end if;
 h=public.mojo_watched_profile(current_setting('test.a')::uuid);
 if not exists(select 1 from jsonb_array_elements(h->'movies') x where x->>'status'='dnf' and (x->>'personal_rating')::int=4) then raise exception 'friend history/rating failed'; end if;
 h=public.mojo_watched_profile(auth.uid());
 if not exists(select 1 from jsonb_array_elements(h->'movies') x where x->>'status'='watched') then raise exception 'other member personal status changed'; end if;
end $$;
insert into public.movie_ratings(user_id,movie_id,stars) values(auth.uid(),current_setting('test.m')::uuid,2);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.c'),'role','authenticated','aal','aal1')::text,true);
do $$ begin
 begin perform public.mojo_profile_details(current_setting('test.a')::uuid);raise exception 'pending friend can view profile';exception when raise_exception then if sqlerrm<>'Only friends can view this profile' then raise;end if;end;
 begin perform public.mojo_group_ratings(current_setting('test.g1')::uuid);raise exception 'nonmember can view group ratings';exception when raise_exception then if sqlerrm<>'Only group members can view ratings' then raise;end if;end;
end $$;
reset role;
insert into public.group_members(group_id,user_id) values(current_setting('test.g1')::uuid,current_setting('test.c')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.a'),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$ declare r jsonb; begin
 r=public.mojo_group_ratings(current_setting('test.g1')::uuid);
 if not exists(select 1 from jsonb_array_elements(r) x where (x->>'average')::numeric=3 and jsonb_array_length(x->'ratings')=3) then raise exception 'average or member list failed %',r;end if;
end $$;
insert into public.group_movies(group_id,movie_id,added_by,watched,watched_at) values(current_setting('test.g2')::uuid,current_setting('test.m')::uuid,auth.uid(),true,clock_timestamp()+interval '1 second');
do $$ declare h jsonb; begin
 h=public.mojo_watched_profile(auth.uid());
 if not exists(select 1 from jsonb_array_elements(h->'movies') x where x->>'status'='watched' and (x->>'personal_rating')::int=4) then raise exception 'latest group status or preserved rating failed';end if;
end $$;
reset role;
rollback;
