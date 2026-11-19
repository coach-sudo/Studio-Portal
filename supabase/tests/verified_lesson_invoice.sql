begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values
 ('6b000000-0000-4000-8000-000000000001','invoice-owner@example.test'),
 ('6b000000-0000-4000-8000-000000000002','invoice-peer@example.test');
insert into public.studios(id,name,slug) values
 ('6b000000-0000-4000-8000-000000000003','Verified terms studio','verified-terms-test');
insert into public.students(id,studio_id,user_id,full_name,email,portal_enabled) values
 ('6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000003','6b000000-0000-4000-8000-000000000001','Invoice payer','invoice-owner@example.test',true);
insert into public.booking_services(id,studio_id,slug,name,category,duration_minutes,price_minor) values
 ('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000003','verified-rehearsal','Verified rehearsal','private',60,12500);
insert into public.lessons(id,studio_id,student_id,service_id,topic,starts_at,ends_at,status,location_type,location_label,payment_status,price_minor) values
 ('6b000000-0000-4000-8000-000000000006','6b000000-0000-4000-8000-000000000003','6b000000-0000-4000-8000-000000000004',
  '6b000000-0000-4000-8000-000000000005','Agreed rate','2030-02-01T12:00:00Z','2030-02-01T13:00:00Z','scheduled','virtual','Online','due',7250);
select set_config('test.verified_lesson','{"actor":"6b000000-0000-4000-8000-000000000001","studentId":"6b000000-0000-4000-8000-000000000004","lessonId":"6b000000-0000-4000-8000-000000000006","version":1,"amountMinor":7250}',true);
select ok(not has_function_privilege('authenticated','public.training_prepare_lesson_invoice(text,jsonb)','EXECUTE'),'Only the server adapter can supply the actor');
select is(public.training_prepare_lesson_invoice('quote',current_setting('test.verified_lesson')::jsonb),null::jsonb,'Disabled policy never provides an invoice quote');
update public.studios set settings='{"currency":"USD","bookingDefaults":{"allowLearnerLessonInvoices":true}}' where id='6b000000-0000-4000-8000-000000000003';
select is(public.training_prepare_lesson_invoice('quote',current_setting('test.verified_lesson')::jsonb)->>'amountMinor','7250','Quote uses the saved lesson price');
select throws_ok($$select public.training_prepare_lesson_invoice('issue',current_setting('test.verified_lesson')::jsonb || '{"actor":"6b000000-0000-4000-8000-000000000002"}')$$,'P0001','FORBIDDEN','Peer cannot issue the invoice');
select throws_ok($$select public.training_prepare_lesson_invoice('issue',current_setting('test.verified_lesson')::jsonb || '{"amountMinor":6000}')$$,'P0001','VERSION_CONFLICT: Review the current lesson price before continuing.','A changed amount requires review');
select isnt(public.training_prepare_lesson_invoice('issue',current_setting('test.verified_lesson')::jsonb)->>'invoiceId',null,'Studio policy permits authorized issuance');
select is(public.training_prepare_lesson_invoice('issue',current_setting('test.verified_lesson')::jsonb)->>'invoiceId',
 (select invoice_id::text from public.lessons where id='6b000000-0000-4000-8000-000000000006'),'Replay reuses the linked invoice');
select is((select count(*) from public.studio_invoices where student_id='6b000000-0000-4000-8000-000000000004'),1::bigint,'No duplicate invoice');
select is((select total_minor from public.studio_invoices where student_id='6b000000-0000-4000-8000-000000000004'),7250::bigint,'The amount matches the quote');
select is((select count(*) from public.payment_entries where student_id='6b000000-0000-4000-8000-000000000004'),0::bigint,'Issuance collects no money');
select is((select count(*) from public.outbox_messages where student_id='6b000000-0000-4000-8000-000000000004'),0::bigint,'Issuance creates no outbound message');
select * from finish();
rollback;
