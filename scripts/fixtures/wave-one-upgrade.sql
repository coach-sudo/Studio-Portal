-- Synthetic history inserted only by the explicitly guarded local upgrade harness.
insert into auth.users(id,email) values('e1000000-0000-4000-8000-000000000001','e2e-upgrade-coach@example.test');
insert into public.studios(id,name,slug) values('e2000000-0000-4000-8000-000000000001','Upgrade fixture','e2e-wave-one-upgrade');
insert into public.memberships(studio_id,user_id,role,display_name) values('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','coach','Upgrade coach');
insert into public.students(id,studio_id,full_name) values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Synthetic legacy student');
insert into public.student_credit_accounts(student_id,auto_apply) values('e3000000-0000-4000-8000-000000000001',false);
insert into public.packages(id,student_id,name,expires_at) values('e5000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Legacy held credits',now()+interval '2 years'),('e5000000-0000-4000-8000-000000000002','e3000000-0000-4000-8000-000000000001','Expired unused lot',now()-interval '1 day');
insert into public.package_credit_entries(package_id,kind,quantity,reason) values('e5000000-0000-4000-8000-000000000001','purchase',3,'Synthetic paid purchase'),('e5000000-0000-4000-8000-000000000002','purchase',1,'Synthetic expired lot');
insert into public.lessons(id,studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,payment_status,price_minor,paid_minor)
select ('e6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','Legacy lesson '||n,now()+n*interval '1 day',now()+n*interval '1 day'+interval '1 hour','scheduled','in_person','Fixture studio',case when n=2 then 'partially_paid' else 'due' end,4000,case when n=2 then 1000 else 0 end from generate_series(1,3)n;
select public.reserve_student_lesson_credit('e6000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',null,true);
insert into public.notes(student_id,lesson_id,title,body,status) values('e3000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-000000000001','Legacy private note','Preserve authored content','draft');
insert into public.payment_entries(student_id,kind,amount_minor,currency,reason,account_credit) values('e3000000-0000-4000-8000-000000000001','payment',1000,'USD','Legacy partial payment',false);

insert into public.studio_invoices(studio_id,student_id,number,status,currency,issue_date,due_date,branding,recipient,items,total_minor,paid_minor)
 values('e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','E2E-UPGRADE-1','partially_paid','USD',current_date,current_date+7,'{}','{}','[{"id":"legacy-line","description":"Synthetic issued lesson","quantity":1,"unitMinor":4000,"totalMinor":4000,"lessonIds":["e6000000-0000-4000-8000-000000000003"]}]',4000,1000);
