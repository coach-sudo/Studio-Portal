begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into public.studios(id,name,slug) values
 ('6c000000-0000-4000-8000-000000000001','Exact hold studio','exact-held-dates-test');
insert into public.students(id,studio_id,full_name,email) values
 ('6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001','Student','exact-holds@example.test');
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values
 ('6c000000-0000-4000-8000-000000000003','6c000000-0000-4000-8000-000000000001','rehearsal','Rehearsal','private',60,8500);
insert into public.recurring_series(id,studio_id,student_id,service_id,kind,cadence,starts_on,occurrence_count,payment_policy,recurrence_rule) values
 ('6c000000-0000-4000-8000-000000000004','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000003','fixed','weekly',
 '2031-03-03T21:00Z',4,'pay_later','{"intervalWeeks":1,"slots":[{"weekday":1,"time":"16:00"}],"proposedOccurrenceCount":6}');
insert into public.booking_holds(id,studio_id,service_id,starts_at,ends_at) values
 ('6c000000-0000-4000-8000-000000000005','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000003','2031-03-03T21:00Z','2031-03-03T22:00Z'),
 ('6c000000-0000-4000-8000-000000000006','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000003','2031-03-17T20:00Z','2031-03-17T21:00Z'),
 ('6c000000-0000-4000-8000-000000000007','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000003','2031-03-24T20:00Z','2031-03-24T21:00Z'),
 ('6c000000-0000-4000-8000-000000000008','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000003','2031-04-07T20:00Z','2031-04-07T21:00Z');
insert into public.bookings(id,studio_id,student_id,service_id,series_id,reference,guest_name,guest_email,starts_at,ends_at,timezone,location,payment_policy,total_minor,manage_token_hash,policy_snapshot,hold_ids)
values ('6c000000-0000-4000-8000-000000000009','6c000000-0000-4000-8000-000000000001','6c000000-0000-4000-8000-000000000002',
 '6c000000-0000-4000-8000-000000000003','6c000000-0000-4000-8000-000000000004','EXACT-HOLDS','Student','exact-holds@example.test',
 '2031-03-03T21:00Z','2031-03-03T22:00Z','America/New_York','in_person','pay_later',34000,'exact-holds-token','{}',
 '{6c000000-0000-4000-8000-000000000005,6c000000-0000-4000-8000-000000000006,6c000000-0000-4000-8000-000000000007,6c000000-0000-4000-8000-000000000008}');
select is(public.confirm_booking('6c000000-0000-4000-8000-000000000009','6c000000-0000-4000-8000-000000000005',0,'exact-holds-receipt')->>'duplicate','false','The held proposal confirms');
select is((select array_agg(starts_at order by starts_at) from public.lessons where series_id='6c000000-0000-4000-8000-000000000004'),
 array['2031-03-03T21:00Z','2031-03-17T20:00Z','2031-03-24T20:00Z','2031-04-07T20:00Z']::timestamptz[],'Confirmation preserves exactly the held dates and skips');
select is((select paid_minor from public.bookings where id='6c000000-0000-4000-8000-000000000009'),0::bigint,'Booking consent does not charge');
select is(public.confirm_booking('6c000000-0000-4000-8000-000000000009','6c000000-0000-4000-8000-000000000005',0,'exact-holds-receipt')->>'duplicate','true','A replay returns the canonical booking');
select is((select count(*) from public.lesson_participants where booking_id='6c000000-0000-4000-8000-000000000009'),4::bigint,'Only kept dates have participants');
select * from finish();
rollback;
