-- No migration/policy change: prove the existing exclusion predicate in real PG.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.studios(id,name,slug) values('e8200000-0000-4000-8000-000000000001','E2E overlap policy','e2e-overlap-policy');
insert into public.students(id,studio_id,full_name,status) values('e8200000-0000-4000-8000-000000000002','e8200000-0000-4000-8000-000000000001','E2E overlap learner','active');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,capacity) values('e8200000-0000-4000-8000-000000000003','e8200000-0000-4000-8000-000000000001','e2e-class','E2E class','group_class',60,4);
insert into public.service_offerings(id,studio_id,service_id,title,starts_at,ends_at,enrollment_closes_at,capacity) values('e8200000-0000-4000-8000-000000000004','e8200000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000003','E2E class','2031-11-10T18:00Z','2031-11-10T19:00Z','2031-11-10T17:00Z',4);
create function pg_temp.overlap_lesson(p_id integer,p_status public.lesson_status,p_offering uuid default null,p_start timestamptz default '2031-11-10T18:00Z',p_end timestamptz default '2031-11-10T19:00Z') returns void language sql as $$
 insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,offering_id)
 values(('e8200000-0000-4000-8000-'||lpad(p_id::text,12,'0'))::uuid,'e8200000-0000-4000-8000-000000000001','e8200000-0000-4000-8000-000000000002','E2E overlap',p_start,p_end,p_status,'in_person','E2E studio',p_offering);
$$;
select lives_ok($$select pg_temp.overlap_lesson(10,'scheduled')$$,'First scheduled private occurrence commits');
select throws_ok($$select pg_temp.overlap_lesson(11,'scheduled')$$,'23P01',null,'Second overlapping scheduled private occurrence is rejected');
select lives_ok($$select pg_temp.overlap_lesson(12,'draft')$$,'Overlapping draft is outside the existing exclusion predicate');
select throws_ok($$update public.lessons set status='scheduled' where id='e8200000-0000-4000-8000-000000000012'$$,'23P01',null,'Promoting overlapping draft still enforces the private exclusion');
select lives_ok($$select pg_temp.overlap_lesson(13,'scheduled','e8200000-0000-4000-8000-000000000004')$$,'Class offering remains outside private-only exclusion');
select throws_ok($$update public.lessons set offering_id=null where id='e8200000-0000-4000-8000-000000000013'$$,'23P01',null,'Converting an overlapping class to private enforces the exclusion');
select lives_ok($$select pg_temp.overlap_lesson(14,'cancelled')$$,'Cancelled history remains outside scheduled-only predicate');
select lives_ok($$select pg_temp.overlap_lesson(15,'scheduled',null,'2031-11-10T19:00Z','2031-11-10T20:00Z')$$,'Adjacent half-open interval does not overlap');
select throws_ok($$update public.lessons set starts_at='2031-11-10T18:30Z' where id='e8200000-0000-4000-8000-000000000015'$$,'23P01',null,'Concurrent-safe exclusion remains active on rescheduling');
select is((select starts_at from public.lessons where id='e8200000-0000-4000-8000-000000000015'),'2031-11-10T19:00Z'::timestamptz,'Rejected reschedule preserves original time');
select is((select count(*) from public.payment_entries where studio_id='e8200000-0000-4000-8000-000000000001'),0::bigint,'Overlap fixtures create no payment effect');
select is((select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id join public.students s on s.id=p.student_id where s.studio_id='e8200000-0000-4000-8000-000000000001'),0::bigint,'Overlap fixtures create no credit effect');
select * from finish();
rollback;
