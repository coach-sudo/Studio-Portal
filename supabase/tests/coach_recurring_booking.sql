begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cb(i integer) returns uuid language sql immutable as $$
  select ('c1120000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) select pg_temp.cb(i),'coach-series-'||i||'@example.test' from generate_series(1,5) i;
insert into public.studios(id,name,slug,timezone)
values(pg_temp.cb(10),'Coach series acceptance','coach-series-acceptance','America/New_York');
insert into public.memberships(studio_id,user_id,role,display_name) values(pg_temp.cb(10),pg_temp.cb(1),'coach','Synthetic coach');
insert into public.students(id,studio_id,user_id,full_name,email,portal_enabled,is_minor)
values (pg_temp.cb(11),pg_temp.cb(10),pg_temp.cb(2),'Owner','owner@example.test',true,false),
 (pg_temp.cb(12),pg_temp.cb(10),pg_temp.cb(3),'Sibling one','sibling-one@example.test',true,true),
 (pg_temp.cb(13),pg_temp.cb(10),null,'Sibling two','sibling-two@example.test',false,true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,is_primary_payer,can_view_finance,can_view_schedule,portal_enabled)
select pg_temp.cb(10),pg_temp.cb(i),pg_temp.cb(4),'Synthetic guardian','guardian@example.test','guardian',true,true,true,true
from generate_series(11,13) i;
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor,published,recurrence_options)
values(pg_temp.cb(20),pg_temp.cb(10),'private','Private coaching','private',45,8000,true,array['none','weekly','biweekly']);
insert into public.package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids)
values(pg_temp.cb(21),pg_temp.cb(10),'One shared credit',1,45,8000,array[pg_temp.cb(20)]);
insert into public.packages(id,student_id,name,definition_id,credit_quantity,expires_at)
values(pg_temp.cb(22),pg_temp.cb(11),'One shared credit',pg_temp.cb(21),1,'2032-01-01T00:00Z');
insert into public.package_credit_entries(package_id,kind,quantity,reason) values(pg_temp.cb(22),'adjustment',1,'Synthetic issued entitlement');
select public.command_student_credit_settings(pg_temp.cb(11),'set_sharing',
  jsonb_build_object('packageId',pg_temp.cb(22),'studentIds',jsonb_build_array(pg_temp.cb(12),pg_temp.cb(13)),
  'reviewedStudentIds','[]'::jsonb,'reason','Synthetic household roster'),0,'coach-series-share',pg_temp.cb(1));
insert into public.student_credit_accounts(student_id,auto_apply)
values(pg_temp.cb(12),true),(pg_temp.cb(13),true) on conflict (student_id) do update set auto_apply=true;

create function pg_temp.series_value(p_student integer,p_start text,p_repeat text default 'weekly',p_count integer default 3)
returns jsonb language sql immutable as $$
 select jsonb_build_object('student_id',pg_temp.cb(p_student),'service_id',pg_temp.cb(20),'service_version',1,
 'timezone','America/New_York','starts_at',p_start,'recurrence',p_repeat,'occurrence_count',p_count)
$$;
create function pg_temp.series_lessons(p_key text) returns setof uuid language sql stable as $$
 select (item->>'lessonId')::uuid from workspace_internal.manual_booking_receipts r
 cross join lateral jsonb_array_elements(r.result->'occurrences') item where r.key=p_key
$$;

-- A conflict in occurrence two must leave no new records or reservations.
insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label)
values(pg_temp.cb(10),pg_temp.cb(11),'Blocked slot','2031-02-24T18:00Z','2031-02-24T18:45Z','scheduled','virtual','Meet');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cb(3)::text,true);
select throws_ok($$select public.command_create_manual_booking('series-denied',pg_temp.series_value(12,'2031-03-03T18:00Z'))$$,
 '42501','FORBIDDEN','Learner cannot create a coach series');
select throws_ok($$select public.manual_booking_series_plan(pg_temp.series_value(12,'2031-03-03T18:00Z'))$$,
 '42501','FORBIDDEN','Learner cannot use the coach plan');
select set_config('request.jwt.claim.sub',pg_temp.cb(1)::text,true);
select throws_ok($$select public.command_create_manual_booking('series-conflict',pg_temp.series_value(12,'2031-02-17T18:00Z'))$$,
 'P0001','SLOT_UNAVAILABLE: Occurrence 2 (2031-02-24 13:00) overlaps a studio lesson. No lessons were scheduled.',
 'Later conflict rolls back the batch');
select throws_ok($$select public.manual_booking_series_plan(pg_temp.series_value(12,'2031-03-02T07:30Z'))$$,
 'P0001','VALIDATION_FAILED: Occurrence 2 falls in a skipped daylight-saving hour. Choose another time.',
 'A missing local clock time is rejected');
select throws_ok($$select public.manual_booking_series_plan(pg_temp.series_value(12,'2031-03-03T18:00Z','weekly',53))$$,
 'P0001','VALIDATION_FAILED: Schedule 2 to 52 future lessons without recording payments.','A finite count is enforced');
reset role;
select is((select count(*) from public.recurring_series where studio_id=pg_temp.cb(10)),0::bigint,'No orphan series');
select is((select count(*) from public.bookings where studio_id=pg_temp.cb(10)),0::bigint,'No orphan booking');
select is(public.package_credit_balance(pg_temp.cb(22)),1,'The failed batch leaves the credit available');

select public.create_booking_hold(pg_temp.cb(20),null,'2031-04-14T17:00Z','2031-04-14T17:45Z');
set local role authenticated;
select throws_ok($$select public.command_create_manual_booking('series-held-date',pg_temp.series_value(12,'2031-04-07T17:00Z'))$$,
 'P0001','SLOT_UNAVAILABLE: A booking is holding one of these times. Review the dates and retry.','An active public hold blocks a later slot');
select lives_ok($$select public.command_create_manual_booking('series-weekly',pg_temp.series_value(12,'2031-03-03T18:00Z'))$$,'Weekly booking commits');
select is(public.command_create_manual_booking('series-weekly',pg_temp.series_value(12,'2031-03-03T18:00Z'))::text,
 public.manual_booking_replay('series-weekly',pg_temp.series_value(12,'2031-03-03T18:00Z'))::text,'Replay returns the same complete receipt');
select throws_ok($$select public.command_create_manual_booking('series-weekly',pg_temp.series_value(12,'2031-03-03T18:00Z','weekly',2))$$,
 'P0001','IDEMPOTENCY_CONFLICT','Changing the count under its original key is rejected');
select lives_ok($$select public.command_create_manual_booking('series-biweekly',pg_temp.series_value(13,'2031-03-04T19:00Z','biweekly',2))$$,
 'Biweekly booking commits independently');
reset role;
select is((select array_agg(starts_at order by starts_at) from public.lessons where id in(select pg_temp.series_lessons('series-weekly'))),
 array['2031-03-03T18:00Z','2031-03-10T17:00Z','2031-03-17T17:00Z']::timestamptz[],'Weekly wall time survives daylight saving');
select is((select array_agg(starts_at order by starts_at) from public.lessons where id in(select pg_temp.series_lessons('series-biweekly'))),
 array['2031-03-04T19:00Z','2031-03-18T18:00Z']::timestamptz[],'Biweekly wall time survives daylight saving');
select is((select count(distinct b.id) from public.lessons l join public.lesson_participants p on p.lesson_id=l.id
 join public.bookings b on b.id=p.booking_id join public.recurring_series s on s.id=l.series_id
 join public.calendar_projections c on c.lesson_id=l.id join workspace_internal.manual_booking_effects e on e.booking_id=b.id and e.lesson_id=l.id
 where l.studio_id=pg_temp.cb(10) and l.student_id=s.student_id and b.student_id=s.student_id
 and l.service_id=s.service_id and b.service_id=s.service_id and s.recurrence_rule->>'bookingMode'='per_occurrence'
 and b.series_id is null and b.paid_minor=0 and c.status='queued' and e.status='queued'
 and l.ends_at-l.starts_at=interval '45 minutes' and l.price_minor=8000),5::bigint,
 'Five lessons have one booking each, a series, the service price and duration, calendar projections and notification intents');
select is((select count(*) from public.lessons where studio_id=pg_temp.cb(10) and series_id is not null and payment_status='due'
 and paid_minor=0 and invoice_id is null),4::bigint,'Only the covered lesson avoids a cash balance');
select is((select count(*) from public.package_credit_entries where package_id=pg_temp.cb(22) and kind='reservation'
 and covered_student_id=pg_temp.cb(12)),1::bigint,'The shared package reserves exactly once for the eligible sibling');
select is(training_internal.direct_lesson_quote(pg_temp.cb(4),(select id from public.lessons where
 studio_id=pg_temp.cb(10) and starts_at='2031-03-10T17:00Z'),null)->>'eligible','true',
 'An uncovered fixed-series occurrence retains invoice-free checkout');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cb(3)::text,true);
select is((select count(*) from public.lessons where studio_id=pg_temp.cb(10) and series_id is not null),3::bigint,'Learner sees their own occurrences');
select set_config('request.jwt.claim.sub',pg_temp.cb(5)::text,true);
select is((select count(*) from public.lessons where studio_id=pg_temp.cb(10) and series_id is not null),0::bigint,'Unrelated learner sees none');
select set_config('request.jwt.claim.sub',pg_temp.cb(1)::text,true);
select throws_ok($$update public.recurring_series set status='cancelled' where studio_id=pg_temp.cb(10)$$,
 '42501','permission denied for table recurring_series','Direct series cancellation is fenced behind reviewed changes');
reset role;

create function pg_temp.change_series(p_key text,p_value jsonb) returns jsonb language sql as $$
 select public.execute_lesson_occurrence_change(pg_temp.cb(1),p_key,p_value||
    jsonb_build_object('reviewToken',public.preview_lesson_occurrence_change(pg_temp.cb(1),p_value)->>'reviewToken'))
$$;
create temp table move_request as select jsonb_build_object('lessonId',id,'action','reschedule','scope','series',
 'reason','Synthetic reviewed series reschedule','startsAt','2031-03-04T18:00Z','endsAt','2031-03-04T18:45Z') value
from public.lessons where studio_id=pg_temp.cb(10) and starts_at='2031-03-03T18:00Z';
select lives_ok($$select pg_temp.change_series('series-review-move',value) from move_request$$,'Reviewed reschedule can move the entire series');
select is((select count(*) from public.lessons l join public.lesson_participants p on p.lesson_id=l.id
 join public.bookings b on b.id=p.booking_id join public.calendar_projections c on c.lesson_id=l.id
 where l.id in(select pg_temp.series_lessons('series-weekly')) and l.starts_at=b.starts_at and l.ends_at=b.ends_at
 and b.reschedule_count=1 and c.status='queued'),3::bigint,'Reschedule moves the same bookings and requeues the same lesson projections');
select is(public.package_credit_balance(pg_temp.cb(22)),0,'Reschedule retains the existing credit');
create temp table paid_occurrence as
select l.id from public.lessons l where l.id in(select pg_temp.series_lessons('series-weekly')) and l.payment_status='due'
order by l.starts_at limit 1;
grant select on paid_occurrence to authenticated;
set local role authenticated;
select lives_ok($$select public.record_lesson_payment(
  jsonb_build_object('lessonId',p.id,'version',(ctx->>'version')::int,'reviewToken',ctx->>'reviewToken',
    'amountMinor',8000,'currency','USD','method','cash','reason','Synthetic settled payment'),
  'series-cash-receipt') from paid_occurrence p cross join lateral public.lesson_payment_context(p.id) ctx$$,
  'The ordinary recording command can settle one uncovered occurrence');
reset role;
create temp table cancel_request as select jsonb_build_object('lessonId',id,'action','cancel','scope','series',
 'reason','Synthetic reviewed series cancellation','useCredit',false) value
from public.lessons where studio_id=pg_temp.cb(10) and starts_at='2031-03-04T18:00Z';
select lives_ok($$select pg_temp.change_series('series-review-cancel',value) from cancel_request$$,'Reviewed cancellation can cancel the entire series');
select is((select count(*) from public.lessons l join public.lesson_participants p on p.lesson_id=l.id
 join public.bookings b on b.id=p.booking_id join public.recurring_series s on s.id=l.series_id
 where l.id in(select pg_temp.series_lessons('series-weekly')) and l.status='cancelled' and b.status='cancelled' and s.status='cancelled'),
 3::bigint,'Cancellation updates the linked records without touching the other series');
select is(public.package_credit_balance(pg_temp.cb(22)),1,'Cancellation returns the reserved shared credit once');
select is((select count(*) from public.lessons l join public.lesson_participants p on p.lesson_id=l.id
 join public.bookings b on b.id=p.booking_id join lesson_ops.payment_receipts r on r.lesson_id=l.id
 where l.id in(select id from paid_occurrence) and l.paid_minor=8000 and b.paid_minor=8000 and r.amount_minor=8000),
  1::bigint,'Reviewed series cancellation preserves settled money and its receipt');
select * from finish();
rollback;
