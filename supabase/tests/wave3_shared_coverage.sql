begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.w3(i integer) returns uuid language sql immutable as $$
select ('f3110000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) select pg_temp.w3(i),'wave3-'||i||'@example.test' from generate_series(1,4) i;
insert into public.studios(id,name,slug) values(pg_temp.w3(10),'Shared credits studio','wave3-credit-test');
insert into public.memberships(studio_id,user_id,role,display_name) values(pg_temp.w3(10),pg_temp.w3(1),'coach','Coach');
insert into public.students(id,studio_id,full_name,is_minor) values
  (pg_temp.w3(11),pg_temp.w3(10),'Package owner',true),
  (pg_temp.w3(12),pg_temp.w3(10),'Sibling one',true),
  (pg_temp.w3(13),pg_temp.w3(10),'Sibling two',true),
  (pg_temp.w3(14),pg_temp.w3(10),'Unrelated',true);
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,is_primary_payer,can_view_finance,portal_enabled)
select pg_temp.w3(10),pg_temp.w3(i),pg_temp.w3(2),'Guardian','wave3-2@example.test','guardian',true,true,true
from generate_series(11,13) i;
insert into public.linked_contacts(studio_id,student_id,user_id,full_name,email,relationship_type,can_view_schedule,portal_enabled)
values(pg_temp.w3(10),pg_temp.w3(12),pg_temp.w3(3),'Schedule only','wave3-3@example.test','guardian',true,true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes)
values(pg_temp.w3(20),pg_temp.w3(10),'coaching','Coaching','private',60);
insert into public.package_definitions(id,studio_id,name,session_count,session_duration_minutes,price_minor,eligible_service_ids)
values(pg_temp.w3(21),pg_temp.w3(10),'Family coaching',1,60,8000,array[pg_temp.w3(20)]);
insert into public.packages(id,student_id,name,definition_id,credit_quantity,expires_at)
values(pg_temp.w3(22),pg_temp.w3(11),'Family coaching',pg_temp.w3(21),1,now()+interval '30 days'),
      (pg_temp.w3(23),pg_temp.w3(11),'Matching package',pg_temp.w3(21),1,now()+interval '30 days');
insert into public.package_credit_entries(package_id,kind,quantity,reason)
values(pg_temp.w3(22),'adjustment',1,'Synthetic issued package'),(pg_temp.w3(23),'adjustment',1,'Synthetic issued package');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,source_provider,price_minor,payment_status)
values(pg_temp.w3(31),pg_temp.w3(10),pg_temp.w3(12),'Sibling one lesson',now()+interval '3 days',now()+interval '3 days 1 hour','scheduled','virtual','Meet',pg_temp.w3(20),'studio',8000,'due'),
      (pg_temp.w3(32),pg_temp.w3(10),pg_temp.w3(13),'Sibling two lesson',now()+interval '4 days',now()+interval '4 days 1 hour','scheduled','virtual','Meet',pg_temp.w3(20),'studio',8000,'due');
create function pg_temp.share(p_package integer,p_ids integer[],p_before uuid[],p_actor integer,p_key text)
returns jsonb language sql as $$
  select public.command_student_credit_settings(pg_temp.w3(11),'set_sharing',
    jsonb_build_object('packageId',pg_temp.w3(p_package),'studentIds',coalesce((select jsonb_agg(pg_temp.w3(i)) from unnest(p_ids) i),'[]'),
      'reviewedStudentIds',to_jsonb(p_before),'reason','Verified household roster'),0,p_key,pg_temp.w3(p_actor))
$$;
select throws_ok($$select pg_temp.share(22,array[12],array[]::uuid[],3,'w3-deny-coach')$$,'P0001','FORBIDDEN','Schedule-only member cannot manage eligibility');
select throws_ok($$select pg_temp.share(22,array[14],array[]::uuid[],1,'w3-deny-other')$$,'P0001','FORBIDDEN: Select students with the same authorized household payer.','Unrelated student cannot join roster');
select is(jsonb_array_length(pg_temp.share(22,array[12,13],array[]::uuid[],1,'w3-share')->'roster'->'selected'),2,'Coach can share one package across two siblings');
select is(pg_temp.share(22,array[12,13],array[]::uuid[],1,'w3-share')->>'duplicate','true','Exact roster command replay returns its receipt');
select is(public.reserve_student_lesson_credit(pg_temp.w3(31),pg_temp.w3(12),null,true),pg_temp.w3(22),'Eligible sibling reserves from owner package');
select is(public.reserve_student_lesson_credit(pg_temp.w3(31),pg_temp.w3(12),null,true),pg_temp.w3(22),'Replayed lesson keeps same reservation');
select is(public.reserve_student_lesson_credit(pg_temp.w3(32),pg_temp.w3(13),null,true),null::uuid,'Other sibling cannot reserve exhausted credit');
select is(public.package_credit_balance(pg_temp.w3(22)),0,'Pool reports one remaining balance');
select is((select covered_student_id from public.package_credit_entries where lesson_id=pg_temp.w3(31)),pg_temp.w3(12),'Reservation attributes the covered sibling');
select is(training_internal.direct_lesson_quote(pg_temp.w3(2),pg_temp.w3(31),null)->>'reasonCode','credit_review','Wave 2 quote suppresses cash on a covered lesson');
select throws_ok($$update public.lessons set ends_at=starts_at+interval '30 minutes' where id=pg_temp.w3(31)$$,'P0001','INVALID_TRANSITION: Review package coverage before changing this lesson.','Incompatible reschedule is held for review');
select is(jsonb_array_length(pg_temp.share(22,array[13],array[pg_temp.w3(12),pg_temp.w3(13)],1,'w3-remove')->'roster'->'selected'),1,'Roster changes do not rewrite existing use');
select is(credit_internal.evaluate_student_lesson_credit(pg_temp.w3(12),pg_temp.w3(31),'manual')->>'state','covered','After removal existing reservation is preserved');
do $$ begin
  perform public.settle_lesson_credits(pg_temp.w3(31),false,pg_temp.w3(12));
  perform public.settle_lesson_credits(pg_temp.w3(31),false,pg_temp.w3(12));
end $$;
select is(public.package_credit_balance(pg_temp.w3(22)),1,'Cancellation releases shared credit exactly once');
select is(jsonb_array_length(pg_temp.share(23,array[13],array[]::uuid[],1,'w3-share-second')->'roster'->'selected'),1,'Explicit second matching package can be shared');
select is(credit_internal.evaluate_student_lesson_credit(pg_temp.w3(13),pg_temp.w3(32),'manual')->>'state','review_required','Equally eligible shared lots require coach review');
select is(public.reserve_student_lesson_credit(pg_temp.w3(32),pg_temp.w3(13),pg_temp.w3(22),true),pg_temp.w3(22),'Coach can choose one verified lot explicitly');
select is(public.wave3_booking_credit_check(pg_temp.w3(2),pg_temp.w3(13),pg_temp.w3(20),array[now()+interval '7 days'],null),'eligible','Public booking sees the remaining eligible shared lot');
select throws_ok($$select public.wave3_booking_credit_check(pg_temp.w3(3),pg_temp.w3(12),pg_temp.w3(20),array[now()+interval '7 days'],null)$$,'42501','FORBIDDEN','Schedule access cannot authorize prepaid booking');
select ok(not has_table_privilege('authenticated','credit_internal.package_beneficiaries','SELECT'),'Roster table is private');
select * from finish();
rollback;
