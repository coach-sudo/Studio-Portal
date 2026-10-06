-- Additive: existing credit ledger entries and purchased quantities are never rewritten.
-- Preserve the previously visible dollar balance, then separate receipts from spendable account credit.
alter table public.payment_entries add column account_credit boolean not null default false;
insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
select student_id,'refund',sum(case when kind='refund' then amount_minor else -amount_minor end),currency,
 'opening-account-credit:'||student_id::text||':'||currency,'Preserved opening dollar credit balance',true
from public.payment_entries group by student_id,currency having sum(case when kind='refund' then amount_minor else -amount_minor end)>0;
create table public.student_credit_accounts (
  student_id uuid primary key references public.students(id) on delete restrict,
  auto_apply boolean default false, -- null preserves mixed legacy package settings until coach review
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.student_credit_accounts(student_id,auto_apply)
select s.id, case when count(p.id)=0 then false when bool_and(p.auto_apply) then true
  when not bool_or(p.auto_apply) then false else null end
from public.students s left join public.packages p on p.student_id=s.id group by s.id;
alter table public.student_credit_accounts enable row level security;
revoke all on public.student_credit_accounts from anon,authenticated;
grant select on public.student_credit_accounts to authenticated;
grant all on public.student_credit_accounts to service_role;
create policy credit_account_read on public.student_credit_accounts for select to authenticated
using (public.can_view_student_finance(student_id));

create function public.credit_account_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  select p.student_id into sid from public.packages p where p.id=new.package_id;
  insert into public.student_credit_accounts(student_id,auto_apply) select sid,case when bool_and(auto_apply) then true when not bool_or(auto_apply) then false else null end from public.packages where student_id=sid on conflict(student_id) do nothing;
  update public.student_credit_accounts set version=version+1,updated_at=now() where student_id=sid;
  return new;
end $$;
revoke all on function public.credit_account_changed() from public,anon,authenticated;
create trigger credit_account_changed after insert on public.package_credit_entries for each row execute function public.credit_account_changed();

create function public.student_credit_summary(p_student uuid) returns jsonb language sql stable security invoker set search_path='' as $$
with balances as (
 select p.id,p.name,p.expires_at,p.auto_apply,coalesce(sum(e.quantity),0)::integer available
 from public.packages p left join public.package_credit_entries e on e.package_id=p.id
 where p.student_id=p_student group by p.id
), holds as (
 select e.package_id,e.lesson_id,greatest(0,-sum(e.quantity))::integer qty
 from public.package_credit_entries e join public.packages p on p.id=e.package_id
 join public.lessons l on l.id=e.lesson_id
 where p.student_id=p_student and l.status='scheduled' and (l.student_id=p_student or exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed'))) group by e.package_id,e.lesson_id
), totals as (
 select coalesce(sum(case when expires_at is null or expires_at>now() then available else 0 end),0)::integer available,
 coalesce(sum(case when expires_at<=now() then greatest(available,0) else 0 end),0)::integer expired from balances
)
select jsonb_build_object('available',t.available,'expired',t.expired,
 'reserved',coalesce((select sum(qty) from holds),0),
 'remaining',t.available+coalesce((select sum(qty) from holds),0),
 'version',coalesce((select version from public.student_credit_accounts where student_id=p_student),1),
 'autoApply',case when exists(select 1 from public.student_credit_accounts where student_id=p_student) then (select auto_apply from public.student_credit_accounts where student_id=p_student) else false end,
 'needsReview',exists(select 1 from balances where available<0) or exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id is not null group by e.lesson_id having sum(e.quantity)<-1) or exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student and e.quantity<0 and e.lesson_id is null and e.kind in ('reservation','consumption')),
 'lots',coalesce((select jsonb_agg(to_jsonb(b)) from balances b),'[]'::jsonb)) from totals t;
$$;
revoke all on function public.student_credit_summary(uuid) from public,anon;
grant execute on function public.student_credit_summary(uuid) to authenticated,service_role;

create function public.set_student_credit_total(p_student uuid,p_target integer,p_version integer,p_reason text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare summary jsonb; delta integer; pkg uuid; lot record; take integer;
begin
  perform 1 from public.students where id=p_student for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists(select 1 from public.package_credit_entries where idempotency_key like p_key||':%') then return public.student_credit_summary(p_student); end if;
  insert into public.student_credit_accounts(student_id) values(p_student) on conflict do nothing;
  summary:=public.student_credit_summary(p_student);
  if (summary->>'needsReview')::boolean then raise exception 'INVALID_TRANSITION: Review legacy credit reservations before changing the total.'; end if;
  if (summary->>'version')::integer<>p_version then raise exception 'VERSION_CONFLICT: Refresh the balance before editing.'; end if;
  if p_target<0 or p_target>100000 or p_target<(summary->>'reserved')::integer or length(trim(p_reason))<3 then
    raise exception 'VALIDATION_FAILED: Total must include reserved credits and a reason.';
  end if;
  delta:=p_target-(summary->>'remaining')::integer;
  if delta>0 then
    select id into pkg from public.packages where student_id=p_student and name='Studio lesson credits' and expires_at is null order by created_at,id limit 1;
    if pkg is null then insert into public.packages(student_id,name) values(p_student,'Studio lesson credits') returning id into pkg; end if;
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(pkg,'adjustment',delta,p_reason,p_key||':add');
  elsif delta<0 then
    for lot in select p.id,public.package_credit_balance(p.id) balance from public.packages p
      where p.student_id=p_student and (p.expires_at is null or p.expires_at>now())
      order by p.expires_at desc nulls first,p.created_at desc,p.id for update
    loop
      take:=least(-delta,greatest(0,lot.balance));
      if take>0 then
        insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(lot.id,'adjustment',-take,p_reason,p_key||':'||lot.id::text);
        delta:=delta+take;
      end if;
      exit when delta=0;
    end loop;
    if delta<>0 then raise exception 'CREDIT_UNAVAILABLE'; end if;
  end if;
  if (select auto_apply from public.student_credit_accounts where student_id=p_student) then
    perform public.reserve_student_upcoming_credits(p_student);
  end if;
  return public.student_credit_summary(p_student);
end $$;
revoke all on function public.set_student_credit_total(uuid,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.set_student_credit_total(uuid,integer,integer,text,text) to service_role;

-- Same reservation operation for manual use, scheduling, and recovery. History is netted.
create function public.reserve_student_lesson_credit(p_lesson_id uuid,p_student uuid,p_package_id uuid default null,p_manual boolean default false,p_reason text default 'Credit reserved for upcoming lesson') returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.lessons; pkg public.packages; enabled boolean;
begin
  select * into l from public.lessons where id=p_lesson_id;
  if l.id is null or not exists(select 1 from public.students s where s.id=p_student and s.studio_id=l.studio_id) then return null; end if;
  if l.student_id is distinct from p_student and not exists(select 1 from public.lesson_participants where lesson_id=l.id and student_id=p_student and status in ('confirmed','reserved')) then return null; end if;
  perform 1 from public.students where id=p_student for update;
  select * into l from public.lessons where id=p_lesson_id for update;
  if l.status<>'scheduled' and not (p_manual and l.status='completed') then return null; end if;
  if exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x where i.student_id=p_student and i.checkout_key is not null and x->'lessonIds' @> to_jsonb(array[l.id::text])) then return null; end if;
  select e.package_id into pkg.id from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=l.id and p.student_id=p_student group by e.package_id having sum(e.quantity)<0;
  if pkg.id is not null then return pkg.id; end if;
  if (public.student_credit_summary(p_student)->>'needsReview')::boolean then return null; end if;
  if l.student_id=p_student and (l.payment_status in ('paid','partially_paid','waived','refunded') or l.paid_minor>0) then return null; end if;
  if exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
    where lp.lesson_id=l.id and b.student_id=p_student and b.payment_policy<>'credits' and b.payment_status in ('paid','partially_paid','processing')) then return null; end if;
  select auto_apply into enabled from public.student_credit_accounts where student_id=p_student;
  select p.* into pkg from public.packages p where p.student_id=p_student
    and (p_manual or coalesce(enabled,p.auto_apply))
    and (p_package_id is null or p.id=p_package_id)
    and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
    and public.package_credit_balance(p.id)>0
    order by p.expires_at nulls last,p.created_at,p.id limit 1 for update;
  if pkg.id is null then return null; end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason)
    values(pkg.id,l.id,case when l.status='completed' then 'consumption'::public.credit_entry_kind else 'reservation'::public.credit_entry_kind end,-1,p_reason);
  update public.bookings b set payment_policy='credits',payment_status='paid',version=b.version+1,updated_at=now()
    where b.student_id=p_student and b.paid_minor=0 and b.id in(select booking_id from public.lesson_participants where lesson_id=l.id and student_id=p_student);
  update public.lessons set package_id=pkg.id,payment_status='paid_by_credit',version=version+1,updated_at=now() where id=l.id and student_id=p_student;
  perform public.sync_invoice_lesson_credit(l.id,p_student);
  return pkg.id;
end $$;
revoke all on function public.reserve_student_lesson_credit(uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.reserve_student_lesson_credit(uuid,uuid,uuid,boolean,text) to service_role;
create or replace function public.reserve_package_credit_for_lesson(p_lesson_id uuid,p_package_id uuid default null,p_reason text default 'Credit reserved for upcoming lesson') returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.lessons; sid uuid; pkg uuid; first_pkg uuid;
begin
  select * into l from public.lessons where id=p_lesson_id;
  if l.student_id is not null then return public.reserve_student_lesson_credit(l.id,l.student_id,p_package_id,false,p_reason); end if;
  for sid in select distinct student_id from public.lesson_participants where lesson_id=l.id and student_id is not null and status in ('reserved','confirmed') order by student_id loop
    pkg:=public.reserve_student_lesson_credit(l.id,sid,p_package_id,false,p_reason);
    first_pkg:=coalesce(first_pkg,pkg);
  end loop;
  return first_pkg;
end $$;

create or replace function public.command_apply_lesson_credit(target_lesson uuid,requested_package uuid,entry_reason text,entry_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pkg uuid; l public.lessons;
begin
  select * into l from public.lessons where id=target_lesson;
  if requested_package is null then
    select id into requested_package from public.packages where student_id=l.student_id
      and (expires_at is null or expires_at>greatest(now(),l.starts_at)) and public.package_credit_balance(id)>0
      order by expires_at nulls last,created_at,id limit 1;
  end if;
  if requested_package is null then raise exception 'CREDIT_UNAVAILABLE'; end if;
  pkg:=public.reserve_student_lesson_credit(target_lesson,l.student_id,requested_package,true,entry_reason);
  if pkg is null then raise exception 'CREDIT_UNAVAILABLE: Lesson is already paid or credit is unavailable.'; end if;
  return jsonb_build_object('lesson',(select to_jsonb(x) from public.lessons x where x.id=target_lesson),'packageId',pkg,
    'entry',(select to_jsonb(e) from public.package_credit_entries e where e.lesson_id=target_lesson and e.package_id=pkg and e.quantity<0 order by created_at desc limit 1));
end $$;

create function public.settle_lesson_credits(p_lesson uuid,p_use boolean,p_student uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare lot record; restored uuid; quantity integer;
begin
  if p_use then return; end if;
  perform 1 from public.students where id in(select p.student_id from public.packages p join public.package_credit_entries e on e.package_id=p.id where e.lesson_id=p_lesson and (p_student is null or p.student_id=p_student)) order by id for update;
  for lot in select p.id,p.student_id,p.expires_at from public.packages p
    where (p_student is null or p.student_id=p_student) and exists(select 1 from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=p.id)
    order by p.student_id,p.id for update
  loop
    perform 1 from public.students where id=lot.student_id for update;
    select greatest(0,-coalesce(sum(e.quantity),0))::integer into quantity from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=lot.id;
    if quantity=0 then continue; end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason)
      values(lot.id,p_lesson,'release',quantity,'Credit returned after cancellation');
    if lot.expires_at is not null and lot.expires_at<=now() then
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(lot.id,'adjustment',-quantity,'Returned credit transferred to 30-day balance');
      insert into public.packages(student_id,name,expires_at) values(lot.student_id,'Returned lesson credits',now()+interval '30 days') returning id into restored;
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(restored,'adjustment',quantity,'Cancelled lesson credit available for 30 days');
    end if;
  end loop;
end $$;
revoke all on function public.settle_lesson_credits(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.settle_lesson_credits(uuid,boolean,uuid) to service_role;

create function public.set_student_credit_auto(p_student uuid,p_enabled boolean,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l record; applied integer:=0;
begin
  perform 1 from public.students where id=p_student for update;
  insert into public.student_credit_accounts(student_id) values(p_student) on conflict do nothing;
  if p_enabled and (public.student_credit_summary(p_student)->>'needsReview')::boolean then raise exception 'INVALID_TRANSITION: Review legacy credit reservations before enabling automatic use.'; end if;
  update public.student_credit_accounts set auto_apply=p_enabled,version=version+1,updated_at=now() where student_id=p_student and version=p_version;
  if not found then raise exception 'VERSION_CONFLICT'; end if;
  update public.packages set auto_apply=p_enabled where student_id=p_student;
  if p_enabled then
    for l in select x.id from public.lessons x where (x.student_id=p_student or exists(select 1 from public.lesson_participants where lesson_id=x.id and student_id=p_student and status in ('reserved','confirmed'))) and x.status='scheduled' and x.starts_at>=now() order by x.starts_at,x.id loop
      if public.reserve_student_lesson_credit(l.id,p_student) is not null then applied:=applied+1; end if;
    end loop;
  end if;
  return public.student_credit_summary(p_student)||jsonb_build_object('applied',applied);
end $$;
revoke all on function public.set_student_credit_auto(uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.set_student_credit_auto(uuid,boolean,integer) to service_role;

-- Reconcile before rollout: no corrective entries are inserted by this report.
create function public.credit_reconciliation() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('studentId',s.id,'summary',public.student_credit_summary(s.id),
 'negativeLots', (select coalesce(jsonb_agg(p.id),'[]'::jsonb) from public.packages p where p.student_id=s.id and public.package_credit_balance(p.id)<0),
 'multipleDebits',(select coalesce(jsonb_agg(x.lesson_id),'[]'::jsonb) from (
   select e.lesson_id from public.package_credit_entries e join public.packages p on p.id=e.package_id
   where p.student_id=s.id and e.lesson_id is not null group by e.lesson_id having sum(e.quantity)<-1) x))), '[]'::jsonb) from public.students s;
$$;
revoke all on function public.credit_reconciliation() from public,anon,authenticated;
grant execute on function public.credit_reconciliation() to service_role;

create table public.studio_invoices (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 student_id uuid not null references public.students(id), number text not null,
 status text not null check(status in ('draft','open','partially_paid','paid','void')),
 currency text not null check(length(currency)=3), issue_date date not null,due_date date not null check(due_date>=issue_date),
 introduction text not null default '',notes text not null default '',footer text not null default '',
 branding jsonb not null,recipient jsonb not null,items jsonb not null check(jsonb_typeof(items)='array'),
 total_minor bigint not null check(total_minor>=0),paid_minor bigint not null default 0 check(paid_minor>=0),
 waived_minor bigint not null default 0 check(waived_minor>=0),credit_minor bigint not null default 0 check(credit_minor>=0),version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 idempotency_key text unique,unique(studio_id,number),check(paid_minor+credit_minor+waived_minor<=total_minor)
);
create index studio_invoices_student_idx on public.studio_invoices(student_id,status);
create table public.invoice_settlements (
 id uuid primary key default gen_random_uuid(),invoice_id uuid not null references public.studio_invoices(id),
 amount_minor bigint not null check(amount_minor>0),method text not null check(method in ('stripe','cash','bank','account_credit','lesson_credit')),
 reference text not null unique,allocations jsonb not null,created_at timestamptz not null default now()
);
alter table public.studio_invoices enable row level security;
alter table public.invoice_settlements enable row level security;
revoke all on public.studio_invoices,public.invoice_settlements from anon,authenticated;
grant select on public.studio_invoices,public.invoice_settlements to authenticated;
grant all on public.studio_invoices,public.invoice_settlements to service_role;
create policy invoice_read on public.studio_invoices for select to authenticated using(public.can_view_student_finance(student_id) and (status<>'draft' or public.is_studio_coach(studio_id)));
create policy invoice_settlement_read on public.invoice_settlements for select to authenticated using(exists(select 1 from public.studio_invoices i where i.id=invoice_id and public.can_view_student_finance(i.student_id)));

create function public.settle_studio_invoice(p_invoice uuid,p_amount bigint,p_method text,p_reference text,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; new_items jsonb:='[]'; allocations jsonb:='[]'; remainder bigint:=p_amount; take bigint; line_due bigint; pkg uuid; def public.package_definitions; lid uuid; balance bigint;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if exists(select 1 from public.invoice_settlements where reference=p_reference and invoice_id=p_invoice) then return to_jsonb(inv); end if;
  if inv.status not in ('open','partially_paid') or p_amount<=0 or p_amount>inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor then raise exception 'VALIDATION_FAILED: Payment exceeds outstanding balance or invoice is not payable.'; end if;
  if inv.checkout_key is not null and (p_method<>'stripe' or current_setting('app.invoice_checkout_key',true) is distinct from inv.checkout_key) then raise exception 'INVALID_TRANSITION: An online payment is pending. Check or cancel it first.'; end if;
  if p_version is not null and inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if p_method='account_credit' then
    select coalesce(sum(case when kind='refund' then amount_minor else -amount_minor end),0) into balance from public.payment_entries where student_id=inv.student_id and currency=inv.currency and account_credit;
    if p_amount>balance then raise exception 'CREDIT_UNAVAILABLE'; end if;
  elsif p_method not in ('stripe','cash','bank') then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    line_due:=(item->>'quantity')::bigint*(item->>'unitMinor')::bigint-coalesce((item->>'creditMinor')::bigint,0)-coalesce((item->>'paidMinor')::bigint,0)-coalesce((item->>'waivedMinor')::bigint,0);
    take:=least(remainder,line_due);
    if take>0 then
      item:=jsonb_set(item,'{paidMinor}',to_jsonb(coalesce((item->>'paidMinor')::bigint,0)+take));
      allocations:=allocations||jsonb_build_array(jsonb_build_object('lineId',item->>'id','amountMinor',take));
      remainder:=remainder-take;
      if item->>'kind'='package' and take=line_due and item->>'packageId' is null then
        select * into def from public.package_definitions where id=(item->>'referenceId')::uuid and studio_id=inv.studio_id;
        if def.id is null then raise exception 'NOT_FOUND: Package definition'; end if;
        insert into public.packages(student_id,definition_id,name,price_minor,currency,expires_at,credit_quantity,auto_apply)
          values(inv.student_id,def.id,item->>'description',(item->>'quantity')::integer*(item->>'unitMinor')::bigint,inv.currency,
            case when item->>'expirationDays' is null then null else now()+make_interval(days=>(item->>'expirationDays')::integer) end,
            coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),coalesce((select auto_apply from public.student_credit_accounts where student_id=inv.student_id),false)) returning id into pkg;
        insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key) values(pkg,'purchase',coalesce((item->>'creditQuantity')::integer,(item->>'quantity')::integer*def.session_count),'Invoice '||inv.number,'invoice-package:'||inv.id::text||':'||(item->>'id'));
        item:=jsonb_set(item,'{packageId}',to_jsonb(pkg::text));
      elsif item->>'kind'='service' then
        for lid in select value::uuid from jsonb_array_elements_text(coalesce(item->'lessonIds','[]')) loop
          update public.lessons set paid_minor=least(coalesce(price_minor,(item->>'unitMinor')::bigint),coalesce(paid_minor,0)+take/greatest(1,jsonb_array_length(item->'lessonIds'))),
          payment_status=case when take=line_due then 'paid' else 'partially_paid' end,version=version+1,updated_at=now()
          where id=lid and student_id=inv.student_id;
          update public.bookings b set paid_minor=(select coalesce(sum(l.paid_minor),0) from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id),
            payment_status=case when not exists(select 1 from public.lessons l join public.lesson_participants lp on lp.lesson_id=l.id where lp.booking_id=b.id and l.payment_status not in ('paid','paid_by_credit','waived')) then 'paid' else 'partially_paid' end,version=b.version+1,updated_at=now()
            where b.student_id=inv.student_id and b.id in(select booking_id from public.lesson_participants where lesson_id=lid and student_id=inv.student_id);
        end loop;
      end if;
    end if;
    new_items:=new_items||jsonb_build_array(item);
  end loop;
  insert into public.invoice_settlements(invoice_id,amount_minor,method,reference,allocations) values(inv.id,p_amount,p_method,p_reference,allocations);
  -- Dollar credit is spent as an adjustment; externally received payments remain in the existing ledger.
  insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
    values(inv.student_id,case when p_method='account_credit' then 'adjustment'::public.payment_entry_kind else 'payment'::public.payment_entry_kind end,p_amount,inv.currency,p_reference,'Invoice '||inv.number||' · '||p_method,p_method='account_credit');
  update public.studio_invoices set items=new_items,paid_minor=paid_minor+p_amount,
    status=case when paid_minor+p_amount+credit_minor+waived_minor=total_minor then 'paid' else 'partially_paid' end,
    version=version+1,updated_at=now() where id=inv.id returning * into inv;
  perform public.reserve_student_upcoming_credits(inv.student_id);
  return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id);
end $$;
revoke all on function public.settle_studio_invoice(uuid,bigint,text,text,integer) from public,anon,authenticated;
grant execute on function public.settle_studio_invoice(uuid,bigint,text,text,integer) to service_role;

create function public.save_studio_invoice(p_value jsonb,p_key text,p_version integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; sid uuid:=(p_value->>'student_id')::uuid; studio uuid:=(p_value->>'studio_id')::uuid; item jsonb; lid uuid; total bigint:=0; line_total bigint; old public.studio_invoices; new_items jsonb:='[]'; original jsonb; is_draft boolean:=p_value->>'status'='draft';
begin
  perform 1 from public.students where id=sid and studio_id=studio and deleted_at is null for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  select * into inv from public.studio_invoices where idempotency_key=p_key;
  if inv.id is not null then return to_jsonb(inv); end if;
  if p_value->>'id' is not null then
    select * into old from public.studio_invoices where id=(p_value->>'id')::uuid and studio_id=studio and student_id=sid for update;
    if old.id is null or old.status<>'draft' then raise exception 'INVALID_TRANSITION'; end if;
    if old.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  end if;
  if jsonb_array_length(p_value->'items')<1 or jsonb_array_length(p_value->'items')>50 then raise exception 'VALIDATION_FAILED'; end if;
  for item in select value from jsonb_array_elements(p_value->'items') loop
    if (item->>'quantity')::integer not between 1 and 500 or (item->>'unitMinor')::bigint<0 then raise exception 'VALIDATION_FAILED'; end if;
    line_total:=(item->>'quantity')::bigint*(item->>'unitMinor')::bigint;
    if line_total>100000000 then raise exception 'VALIDATION_FAILED'; end if;
    if item->>'kind'='package' then
      if line_total=0 then raise exception 'VALIDATION_FAILED: Package invoices need a positive price.'; end if;
      if not exists(select 1 from public.package_definitions where id=(item->>'referenceId')::uuid and studio_id=studio) then raise exception 'FORBIDDEN'; end if;
    elsif item->>'kind'='service' then
      if not exists(select 1 from public.booking_services where id=(item->>'referenceId')::uuid and studio_id=studio) then raise exception 'FORBIDDEN'; end if;
    else raise exception 'VALIDATION_FAILED'; end if;
    for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
      if (item->>'quantity')::integer<>1 or jsonb_array_length(item->'lessonIds')<>1 or item->>'kind'<>'service' then raise exception 'VALIDATION_FAILED: Use one invoice line per linked lesson.'; end if;
      if not exists(select 1 from public.lessons where id=lid and student_id=sid and studio_id=studio and (service_id is null or service_id=(item->>'referenceId')::uuid) and status not in ('cancelled','late_cancelled') and paid_minor=0 and payment_status not in ('paid','waived','refunded','partially_paid')) then raise exception 'VALIDATION_FAILED: Choose an unpaid matching lesson.'; end if;
      if exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id where lp.lesson_id=lid and b.student_id=sid and b.payment_policy<>'credits' and (b.paid_minor>0 or b.payment_status in ('paid','partially_paid','processing','not_required'))) then raise exception 'VALIDATION_FAILED: This booking already has payment coverage.'; end if;
      if not is_draft and exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
        where i.student_id=sid and i.status not in ('draft','void') and x->'lessonIds' @> to_jsonb(array[lid::text])) then raise exception 'INVALID_TRANSITION: Lesson already invoiced.'; end if;
      select jsonb_build_object('priceMinor',price_minor,'paymentStatus',payment_status,'serviceId',service_id) into original from public.lessons where id=lid;
      item:=jsonb_set(item,'{originalLesson}',original);
      if not is_draft then update public.lessons set service_id=coalesce(service_id,(item->>'referenceId')::uuid),price_minor=(item->>'unitMinor')::bigint,payment_status=case when payment_status='paid_by_credit' then payment_status when line_total=0 then 'waived' else 'due' end,version=version+1,updated_at=now() where id=lid; end if;
    end loop;
    new_items:=new_items||jsonb_build_array(item);
    total:=total+line_total;
  end loop;
  if old.id is not null then
    update public.studio_invoices set status=case when is_draft then 'draft' when total=0 then 'paid' else 'open' end,
      issue_date=(p_value->>'issue_date')::date,due_date=(p_value->>'due_date')::date,introduction=p_value->>'introduction',notes=p_value->>'notes',footer=p_value->>'footer',
      items=new_items,total_minor=total,branding=p_value->'branding',recipient=p_value->'recipient',currency=p_value->>'currency',version=version+1,updated_at=now(),idempotency_key=p_key where id=old.id returning * into inv;
  else
    insert into public.studio_invoices(studio_id,student_id,number,status,currency,issue_date,due_date,introduction,notes,footer,branding,recipient,items,total_minor,idempotency_key)
    values(studio,sid,'INV-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),case when is_draft then 'draft' when total=0 then 'paid' else 'open' end,
      p_value->>'currency',(p_value->>'issue_date')::date,(p_value->>'due_date')::date,p_value->>'introduction',p_value->>'notes',p_value->>'footer',p_value->'branding',p_value->'recipient',new_items,total,p_key) returning * into inv;
  end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
    values(studio,'invoice.saved','invoice',inv.id,'Coach saved invoice',p_key,'coach_portal',to_jsonb(inv));
  if not is_draft then
    for item in select value from jsonb_array_elements(inv.items) loop
      for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
        update public.lessons set invoice_id=inv.id where id=lid;
        perform public.sync_invoice_lesson_credit(lid,sid);
      end loop;
    end loop;
  end if;
  return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id);
end $$;
revoke all on function public.save_studio_invoice(jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.save_studio_invoice(jsonb,text,integer) to service_role;

create function public.apply_invoice_lesson_credit(p_invoice uuid,p_line text,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; new_items jsonb:='[]'; lid uuid; pkg uuid; amount bigint;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: An online payment is pending.'; end if;
  if inv.status not in ('open','partially_paid') then raise exception 'INVALID_TRANSITION'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    if item->>'id'=p_line then
      if item->>'kind'<>'service' or jsonb_array_length(item->'lessonIds')<>1 or (item->>'quantity')::integer<>1 or coalesce((item->>'paidMinor')::bigint,0)>0 or coalesce((item->>'creditMinor')::bigint,0)>0 then raise exception 'INVALID_TRANSITION: Credit requires one unpaid linked lesson.'; end if;
      lid:=(item->'lessonIds'->>0)::uuid;
      pkg:=public.reserve_student_lesson_credit(lid,inv.student_id,null,true,'Invoice '||inv.number);
      if pkg is null then raise exception 'CREDIT_UNAVAILABLE'; end if;
      return (select to_jsonb(i) from public.studio_invoices i where i.id=inv.id);
    end if;
  end loop;
  raise exception 'NOT_FOUND';
end $$;
revoke all on function public.apply_invoice_lesson_credit(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.apply_invoice_lesson_credit(uuid,text,integer) to service_role;

create function public.command_cancel_lesson_credit(p_lesson uuid,p_version integer,p_use boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform set_config('app.use_credit',p_use::text,true);
  return public.command_change_lesson_state(p_lesson,p_version,'cancel',null,null,true);
end $$;
revoke all on function public.command_cancel_lesson_credit(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.command_cancel_lesson_credit(uuid,integer,boolean) to service_role;

create function public.cancel_booking_credit(p_booking uuid,p_version integer,p_use boolean default false,p_student_action boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings; late boolean;
begin
  select * into b from public.bookings where id=p_booking;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=b.student_id for update;
  select * into b from public.bookings where id=p_booking for update;
  if exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id=b.student_id and i.checkout_key is not null and x->'lessonIds' ?| array(select lesson_id::text from public.lesson_participants where booking_id=b.id)) then
    raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.';
  end if;
  late:=p_student_action and b.starts_at-now()<make_interval(hours=>coalesce((b.policy_snapshot->>'cancellationWindowHours')::integer,0));
  perform set_config('app.student_cancel',p_student_action::text,true);
  perform set_config('app.use_credit',(p_use or late)::text,true);
  return public.finalize_booking_cancellation(b.id,p_version,case when late then 'late_cancelled' else 'cancelled' end,null,0,'cancel-credit:'||b.id::text||':'||p_version::text);
end $$;
revoke all on function public.cancel_booking_credit(uuid,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.cancel_booking_credit(uuid,integer,boolean,boolean) to service_role;

create function public.void_studio_invoice(p_invoice uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; lid uuid;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  if inv.id is null then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if inv.paid_minor>0 or inv.credit_minor>0 then raise exception 'INVALID_TRANSITION'; end if;
  if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: An online payment is pending.'; end if;
  for item in select value from jsonb_array_elements(inv.items) loop
    for lid in select value::uuid from jsonb_array_elements_text(item->'lessonIds') loop
      update public.lessons set invoice_id=null,price_minor=(item->'originalLesson'->>'priceMinor')::bigint,payment_status=coalesce(item->'originalLesson'->>'paymentStatus','untracked'),service_id=(item->'originalLesson'->>'serviceId')::uuid,version=version+1,updated_at=now()
      where id=lid and invoice_id=inv.id and student_id=inv.student_id and paid_minor=0 and payment_status='due';
    end loop;
  end loop;
  update public.studio_invoices set status='void',version=version+1,updated_at=now() where id=inv.id returning * into inv;
  return to_jsonb(inv);
end $$;
revoke all on function public.void_studio_invoice(uuid,integer) from public,anon,authenticated;
grant execute on function public.void_studio_invoice(uuid,integer) to service_role;

create function public.sync_invoice_lesson_credit(p_lesson uuid,p_student uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; new_items jsonb; credit bigint; amount bigint;
begin
  if not exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where e.lesson_id=p_lesson and p.student_id=p_student group by e.package_id having sum(e.quantity)<0) then return; end if;
  for inv in select i.* from public.studio_invoices i where i.student_id=p_student and i.status in ('open','partially_paid') and exists(select 1 from jsonb_array_elements(i.items) x where x->'lessonIds' @> to_jsonb(array[p_lesson::text])) order by i.id for update loop
    new_items:='[]';credit:=0;
    for item in select value from jsonb_array_elements(inv.items) loop
      if item->'lessonIds' @> to_jsonb(array[p_lesson::text]) and coalesce((item->>'paidMinor')::bigint,0)=0 and coalesce((item->>'creditMinor')::bigint,0)=0 then
        amount:=(item->>'unitMinor')::bigint;
        if amount>0 then
          item:=jsonb_set(item,'{creditMinor}',to_jsonb(amount));credit:=credit+amount;
          insert into public.invoice_settlements(invoice_id,amount_minor,method,reference,allocations) values(inv.id,amount,'lesson_credit','invoice-credit:'||inv.id::text||':'||(item->>'id'),jsonb_build_array(jsonb_build_object('lineId',item->>'id','amountMinor',amount))) on conflict(reference) do nothing;
        end if;
      end if;
      new_items:=new_items||jsonb_build_array(item);
    end loop;
    if credit>0 then
      update public.studio_invoices set items=new_items,credit_minor=credit_minor+credit,version=version+1,updated_at=now(),
        status=case when paid_minor+credit_minor+credit+waived_minor=total_minor then 'paid' else 'partially_paid' end where id=inv.id;
    end if;
  end loop;
end $$;
revoke all on function public.sync_invoice_lesson_credit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sync_invoice_lesson_credit(uuid,uuid) to service_role;

alter table public.studio_invoices add column checkout_key text,add column checkout_session_id text,add column checkout_amount bigint;
alter table public.lessons add column invoice_payment_pending boolean not null default false;
alter table public.lessons add column invoice_id uuid references public.studio_invoices(id);
create function public.attach_studio_invoice_checkout(p_invoice uuid,p_key text,p_session text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.invoice_settlements where invoice_id=p_invoice and reference='invoice-stripe:'||p_session) then return; end if;
  update public.studio_invoices set checkout_session_id=p_session where id=p_invoice and checkout_key=p_key and (checkout_session_id is null or checkout_session_id=p_session);
  if not found then raise exception 'VERSION_CONFLICT'; end if;
end $$;
revoke all on function public.attach_studio_invoice_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.attach_studio_invoice_checkout(uuid,text,text) to service_role;
create function public.claim_studio_invoice_checkout(p_invoice uuid,p_amount bigint,p_key text,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if inv.checkout_key=p_key then return to_jsonb(inv); end if;
  if inv.version<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: An online payment is already pending.'; end if;
  if inv.status not in ('open','partially_paid') or p_amount<=0 or p_amount>inv.total_minor-inv.paid_minor-inv.credit_minor-inv.waived_minor then raise exception 'VALIDATION_FAILED'; end if;
  update public.studio_invoices set checkout_key=p_key,checkout_amount=p_amount,version=version+1,updated_at=now() where id=inv.id returning * into inv;
  update public.lessons l set invoice_payment_pending=true where exists(select 1 from jsonb_array_elements(inv.items) x where x->'lessonIds' @> to_jsonb(array[l.id::text]));
  return to_jsonb(inv);
end $$;
revoke all on function public.claim_studio_invoice_checkout(uuid,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.claim_studio_invoice_checkout(uuid,bigint,text,integer) to service_role;

create function public.release_studio_invoice_checkout(p_invoice uuid,p_key text) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  perform 1 from public.students where id=inv.student_id for update;
  update public.studio_invoices set checkout_key=null,checkout_session_id=null,checkout_amount=null,version=version+1,updated_at=now() where id=inv.id and checkout_key=p_key;
  if found then update public.lessons l set invoice_payment_pending=false where exists(select 1 from jsonb_array_elements(inv.items) x where x->'lessonIds' @> to_jsonb(array[l.id::text])); end if;
end $$;
revoke all on function public.release_studio_invoice_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.release_studio_invoice_checkout(uuid,text) to service_role;

create function public.settle_studio_invoice_checkout(p_invoice uuid,p_key text,p_session text,p_amount bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; result jsonb;
begin
  select * into inv from public.studio_invoices where id=p_invoice;
  perform 1 from public.students where id=inv.student_id for update;
  select * into inv from public.studio_invoices where id=p_invoice for update;
  if exists(select 1 from public.invoice_settlements where reference='invoice-stripe:'||p_session and invoice_id=p_invoice) then return to_jsonb(inv); end if;
  if inv.checkout_key is distinct from p_key or (inv.checkout_session_id is not null and inv.checkout_session_id is distinct from p_session) or inv.checkout_amount is distinct from p_amount then raise exception 'VERSION_CONFLICT: Checkout does not match the reserved invoice payment.'; end if;
  perform set_config('app.invoice_checkout_key',p_key,true);
  result:=public.settle_studio_invoice(p_invoice,p_amount,'stripe','invoice-stripe:'||p_session,null);
  perform public.release_studio_invoice_checkout(p_invoice,p_key);
  perform public.reserve_student_upcoming_credits(inv.student_id);
  return (select to_jsonb(i) from public.studio_invoices i where i.id=p_invoice);
end $$;
revoke all on function public.settle_studio_invoice_checkout(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.settle_studio_invoice_checkout(uuid,text,text,bigint) to service_role;

create or replace function public.command_change_lesson_state(
  p_lesson_id uuid,
  p_expected_version integer,
  p_action text,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_queue_calendar boolean default true
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  current_lesson public.lessons%rowtype;
  changed_lesson public.lessons%rowtype;
  linked_booking_id uuid;
  debit record;
begin
  if p_action not in ('reschedule','cancel') then
    raise exception 'VALIDATION_FAILED: Unsupported lesson change';
  end if;

  perform 1 from public.students where id in(select student_id from public.lesson_participants where lesson_id=p_lesson_id union select student_id from public.lessons where id=p_lesson_id) order by id for update;
  select * into current_lesson
  from public.lessons
  where id=p_lesson_id
  for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if current_lesson.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT:%', p_expected_version;
  end if;

  select booking_id into linked_booking_id
  from public.lesson_participants
  where lesson_id=p_lesson_id and booking_id is not null
  order by created_at
  limit 1;

  if current_lesson.invoice_payment_pending then raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.'; end if;
  if p_action='reschedule' then
    if current_lesson.status <> 'scheduled' then
      raise exception 'VALIDATION_FAILED: Only scheduled lessons can be rescheduled';
    end if;
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
      raise exception 'VALIDATION_FAILED: A valid lesson time is required';
    end if;
    if exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where e.lesson_id=p_lesson_id and p.expires_at<=p_starts_at group by p.id having sum(e.quantity)<0) then
      raise exception 'VALIDATION_FAILED: The reserved credit expires before that date. Return the credit and review coverage first.';
    end if;
    update public.lessons
      set starts_at=p_starts_at,ends_at=p_ends_at,version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    if linked_booking_id is not null then
      update public.bookings
      set starts_at=p_starts_at,ends_at=p_ends_at,reschedule_count=reschedule_count+1,
          version=version+1,updated_at=now()
      where id=linked_booking_id;
    end if;
  else
    if current_lesson.status<>'scheduled' then raise exception 'INVALID_TRANSITION'; end if;
    update public.lessons
      set status='cancelled',version=version+1,updated_at=now()
      where id=p_lesson_id
      returning * into changed_lesson;
    update public.lesson_participants set status='cancelled'
      where lesson_id=p_lesson_id and status in ('reserved','confirmed');
    if linked_booking_id is not null then
      update public.bookings
      set status='cancelled',version=version+1,updated_at=now()
      where id in (select booking_id from public.lesson_participants where lesson_id=p_lesson_id) and status not in ('cancelled','late_cancelled','completed');
    end if;
    perform public.cancel_invoice_lesson(p_lesson_id,null,false,coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    perform public.settle_lesson_credits(p_lesson_id,coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    update public.lessons set package_id=case when current_setting('app.use_credit',true)='true' then package_id else null end,
      payment_status=case when current_lesson.payment_status='paid_by_credit' then case when current_setting('app.use_credit',true)='true' then 'paid_by_credit' else 'refunded' end else payment_status end where id=p_lesson_id;
    select * into changed_lesson from public.lessons where id=p_lesson_id;
  end if;

  update public.outbox_messages
    set status='cancelled',updated_at=now()
    where status in ('draft','approved','queued','failed')
      and event_key='booking.reminder.student'
      and (lesson_id=p_lesson_id or booking_id=linked_booking_id);

  if p_queue_calendar then
    insert into public.calendar_projections(lesson_id,status,last_error,next_attempt_at)
    values(p_lesson_id,'queued',null,now())
    on conflict(lesson_id) do update
      set status='queued',last_error=null,next_attempt_at=now(),attempts=0;
  end if;

  return jsonb_build_object(
    'lesson',to_jsonb(changed_lesson),
    'bookingId',linked_booking_id,
    'action',p_action
  );
end $$;
create or replace function public.finalize_booking_cancellation(
  target_booking uuid,
  expected_version integer,
  target_status text,
  refund_reference text,
  refund_amount bigint,
  correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  b public.bookings;
  updated_booking public.bookings;
  lesson_ids uuid[] := '{}'::uuid[];
  settlement text;
  next_payment_status text;
  lid uuid;
  invoice_return bigint:=0; returned bigint;
begin
  if target_status not in ('cancelled','late_cancelled') then raise exception 'VALIDATION_FAILED'; end if;
  select * into b from public.bookings where id=target_booking for update;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status in ('cancelled','late_cancelled') then
    return jsonb_build_object('booking',to_jsonb(b),'lessonIds','[]'::jsonb,'duplicate',true);
  end if;
  if b.status<>'confirmed' then raise exception 'INVALID_TRANSITION:%',b.status; end if;
  if b.version<>expected_version then raise exception 'VERSION_CONFLICT:%',b.version; end if;

  select coalesce(array_agg(distinct p.lesson_id),'{}'::uuid[]) into lesson_ids
  from public.lesson_participants p where p.booking_id=b.id;

  update public.lessons l set status=target_status::public.lesson_status,version=l.version+1,updated_at=now()
  where l.id=any(lesson_ids) and l.status not in ('cancelled','late_cancelled')
    and not exists(select 1 from public.lesson_participants lp where lp.lesson_id=l.id and lp.booking_id<>b.id and lp.status in ('reserved','confirmed'));
  update public.lesson_participants set status='cancelled'
  where booking_id=b.id and status<>'cancelled';
  insert into public.calendar_projections(lesson_id,status,last_error)
  select unnest(lesson_ids),'queued',null
  on conflict(lesson_id) do update set status='queued',last_error=null;

  if b.offering_id is not null then
    update public.service_offerings
    set enrolled=greatest(0,enrolled-1),version=version+1,updated_at=now()
    where id=b.offering_id;
  end if;

  settlement:=case when current_setting('app.student_cancel',true)='true' then 'studio_credit' else coalesce(b.policy_snapshot->>'settlement','original_payment') end;
  next_payment_status:=b.payment_status;
  for lid in select unnest(lesson_ids) loop
    returned:=public.cancel_invoice_lesson(lid,b.student_id,current_setting('app.student_cancel',true)='true',target_status='late_cancelled' or coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean);
    invoice_return:=invoice_return+returned;
    perform public.settle_lesson_credits(lid,target_status='late_cancelled' or coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean,b.student_id);
  end loop;
  if target_status='cancelled' and b.payment_policy='credits' and not coalesce(nullif(current_setting('app.use_credit',true),''),'false')::boolean then
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='studio_credit' and b.paid_minor>invoice_return and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
    values(b.student_id,'refund',greatest(0,b.paid_minor-invoice_return),b.currency,'studio-credit:'||b.id::text,'Studio account credit for '||b.reference,true)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  elsif target_status='cancelled' and settlement='original_payment' and refund_reference is not null and coalesce(refund_amount,0)>0 and b.student_id is not null then
    insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason)
    values(b.student_id,'refund',refund_amount,b.currency,refund_reference,'Booking cancellation '||b.reference)
    on conflict(external_reference) do nothing;
    next_payment_status:='refunded';
  end if;

  update public.bookings
  set status=target_status,payment_status=next_payment_status,version=version+1,updated_at=now()
  where id=b.id and version=expected_version returning * into updated_booking;
  if updated_booking.id is null then raise exception 'VERSION_CONFLICT'; end if;

  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(b.studio_id,'booking.cancelled','booking',b.id,
    case when target_status='late_cancelled' then 'Late cancellation' else 'Permitted cancellation' end,
    correlation_id,'booking_platform',to_jsonb(b),to_jsonb(updated_booking));
  return jsonb_build_object('booking',to_jsonb(updated_booking),'lessonIds',to_jsonb(lesson_ids),'duplicate',false);
end $$;
create or replace function public.command_complete_lesson(
  lesson_id uuid, expected_version integer, reason text, idempotency_key text, correlation_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.lessons; audit_id uuid; response jsonb;
begin
  if exists(select 1 from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key) then
    return (select k.response from public.idempotency_keys k where k.key=command_complete_lesson.idempotency_key);
  end if;
  perform 1 from public.students where id in(select l.student_id from public.lessons l where l.id=command_complete_lesson.lesson_id union select lp.student_id from public.lesson_participants lp where lp.lesson_id=command_complete_lesson.lesson_id) order by id for update;
  select * into target from public.lessons where id=lesson_id for update;
  if target.id is null then raise exception 'LESSON_NOT_FOUND'; end if;
  if not public.is_studio_coach(target.studio_id) then raise exception 'FORBIDDEN'; end if;
  if target.version<>expected_version then raise exception 'VERSION_CONFLICT:%',target.version; end if;
  if target.status<>'scheduled' then raise exception 'INVALID_TRANSITION:%',target.status; end if;
  update public.lessons set status='completed',version=version+1,updated_at=now() where id=lesson_id returning * into target;
  -- A booking reservation or an explicit "use credit" action is already a debit.
  -- Only consume here when no negative ledger entry exists for this lesson.
  if target.package_id is not null and not exists(
    select 1 from public.package_credit_entries e
    where e.lesson_id=target.id group by e.package_id having sum(e.quantity)<0
  ) then
    if public.reserve_student_lesson_credit(target.id,target.student_id,target.package_id,true,reason) is null then raise exception 'CREDIT_UNAVAILABLE'; end if;
  end if;
  insert into public.recommendations(studio_id,student_id,entity_type,entity_id,reason_code,title,explanation,evidence,urgency,due_at,suggested_action,requires_confirmation,dedupe_key)
  values(target.studio_id,target.student_id,'lesson',target.id,'lesson_note_missing','Write lesson note','The lesson is complete and no follow-up note exists.',jsonb_build_array('Lesson completed','No note created'),4,now()+interval '48 hours','open_note_editor',false,'lesson_note_missing:'||target.id)
  on conflict(dedupe_key) do update set status='open',updated_at=now();
  insert into public.calendar_projections(lesson_id,projected_version,status)
  values(target.id,0,'queued') on conflict on constraint calendar_projections_lesson_id_key do update set status='queued',last_error=null;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
  values(target.studio_id,(select auth.uid()),'lesson.completed','lesson',target.id,reason,correlation_id,'coach_portal',jsonb_build_object('status','scheduled','version',expected_version),to_jsonb(target)) returning id into audit_id;
  response=jsonb_build_object('resource',to_jsonb(target),'auditEventId',audit_id,'queuedSideEffects',jsonb_build_array('calendar_projection'),'recommendations',jsonb_build_array('lesson_note_missing'));
  insert into public.idempotency_keys(key,actor_id,command,request_hash,response)
  values(command_complete_lesson.idempotency_key,(select auth.uid()),'complete_lesson',encode(extensions.digest(command_complete_lesson.idempotency_key||lesson_id::text,'sha256'),'hex'),response);
  return response;
end $$;
create or replace function public.command_create_lesson(
  target_studio uuid,target_student uuid,topic text,starts_at timestamptz,ends_at timestamptz,
  location_type text,location_label text,student_name text,student_email text,
  recurrence text,occurrence_count integer,timezone text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare created public.lessons; recurring_result jsonb;
begin
  if ends_at<=starts_at or location_type not in ('virtual','in_person') then raise exception 'VALIDATION_FAILED'; end if;
  if not exists(select 1 from public.students s where s.id=target_student and s.studio_id=target_studio and s.deleted_at is null) then raise exception 'STUDENT_NOT_FOUND'; end if;
  perform 1 from public.students where id=target_student for update;
  insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,meeting_provider,source_provider)
  values(target_studio,target_student,coalesce(nullif(trim(topic),''),'Private coaching'),starts_at,ends_at,'scheduled',location_type,
    coalesce(nullif(trim(location_label),''),case when location_type='in_person' then 'In person' else 'Google Meet' end),
    case when location_type='in_person' then 'in_person' else 'google_meet' end,'studio') returning * into created;
  insert into public.lesson_participants(lesson_id,student_id,display_name,email,status)
  values(created.id,target_student,coalesce(nullif(trim(student_name),''),'Student'),coalesce(trim(student_email),''),'confirmed');
  insert into public.calendar_projections(lesson_id,status) values(created.id,'queued');
  if recurrence in ('weekly','biweekly') and occurrence_count>1 then
    recurring_result:=public.command_make_lesson_recurring(created.id,created.version,recurrence,occurrence_count,timezone);
    select * into created from public.lessons where id=created.id;
  end if;
  perform public.reserve_student_upcoming_credits(target_student);
  select * into created from public.lessons where id=created.id;
  return jsonb_build_object('lesson',to_jsonb(created),'recurrence',coalesce(recurring_result,'{}'::jsonb));
end $$;
create or replace function public.confirm_booking(target_booking uuid,target_hold uuid,amount_paid bigint,provider_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.bookings; service public.booking_services; student public.students; series_record public.recurring_series; lesson_id uuid; occurrence_id uuid; audit_id uuid; credit_package uuid; credit_count integer:=1; occurrence_total integer; step_size interval; next_start timestamptz; next_end timestamptz;
begin
  select * into b from public.bookings where id=target_booking;
  if b.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  select * into service from public.booking_services where id=b.service_id;
  perform pg_advisory_xact_lock(hashtext(b.studio_id::text));
  select * into b from public.bookings where id=target_booking;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  if b.offering_id is null and exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(b.starts_at-make_interval(mins=>service.buffer_before_minutes),b.ends_at+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  if b.student_id is not null then
    select * into student from public.students where id=b.student_id and studio_id=b.studio_id and deleted_at is null;
  end if;
  if student.id is null then
    select * into student
    from public.students s
    where s.studio_id=b.studio_id and s.deleted_at is null and (
      (nullif(trim(b.guest_email),'') is not null and lower(s.email)=lower(b.guest_email))
      or (
        regexp_replace(lower(trim(s.full_name)),'\s+',' ','g')=regexp_replace(lower(trim(b.guest_name)),'\s+',' ','g')
        and (
          (nullif(trim(b.guardian_email),'') is not null and lower(s.guardian_email)=lower(b.guardian_email))
          or (nullif(trim(b.guest_email),'') is not null and lower(s.guardian_email)=lower(b.guest_email))
          or (nullif(trim(b.guardian_email),'') is not null and lower(s.email)=lower(b.guardian_email))
        )
      )
    )
    order by case when lower(s.email)=lower(b.guest_email) then 0 else 1 end,s.created_at limit 1;
  end if;
  if student.id is null then
    insert into public.students(studio_id,full_name,email,status,is_minor,guardian_name,guardian_email,portal_enabled)
    values(b.studio_id,b.guest_name,lower(b.guest_email),'lead',b.for_minor,b.guardian_name,b.guardian_email,true) returning * into student;
  else
    update public.students set
      guardian_name=coalesce(nullif(guardian_name,''),nullif(b.guardian_name,'')),
      guardian_email=coalesce(nullif(guardian_email,''),nullif(lower(b.guardian_email),'')),
      updated_at=now()
    where id=student.id returning * into student;
  end if;
  if b.series_id is not null then select * into series_record from public.recurring_series where id=b.series_id; credit_count=case when series_record.kind='ongoing' then 1 else coalesce(series_record.occurrence_count,1) end; end if;
  perform 1 from public.students where id=student.id for update;
  select * into b from public.bookings where id=target_booking for update;
  if b.status='confirmed' then return jsonb_build_object('bookingId',b.id,'studentId',b.student_id,'duplicate',true); end if;
  update public.bookings set student_id=student.id,status='confirmed',payment_status=case when payment_policy='credits' then 'paid' when amount_paid>=total_minor then 'paid' when amount_paid>0 then 'partially_paid' when payment_policy='pay_later' then 'due' else payment_status end,paid_minor=amount_paid,version=version+1,updated_at=now() where id=b.id returning * into b;
  update public.booking_holds set status='converted' where id=target_hold or id=any(b.hold_ids);
  if b.offering_id is null then
    insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
    values(b.studio_id,student.id,service.name,b.starts_at,b.ends_at,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into lesson_id;
    insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(lesson_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
    insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(lesson_id,0,'queued',case when b.location='google_meet' then 'meet-'||lesson_id::text else null end);
    if b.series_id is not null then
      select * into series_record from public.recurring_series where id=b.series_id;
      occurrence_total=case when series_record.kind='ongoing' then 12 else coalesce(series_record.occurrence_count,6) end;
      step_size=case when series_record.cadence='biweekly' then interval '14 days' else interval '7 days' end;
      for idx in 1..occurrence_total-1 loop
        next_start=((b.starts_at at time zone b.timezone)+idx*step_size) at time zone b.timezone;
        next_end=next_start+(b.ends_at-b.starts_at);
        if exists(select 1 from public.lessons l where l.studio_id=b.studio_id and l.status='scheduled' and tstzrange(l.starts_at,l.ends_at,'[)') && tstzrange(next_start-make_interval(mins=>service.buffer_before_minutes),next_end+make_interval(mins=>service.buffer_after_minutes),'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
        insert into public.lessons(studio_id,student_id,topic,starts_at,ends_at,status,location_type,location_label,service_id,series_id,meeting_provider,capacity,source_provider)
        values(b.studio_id,student.id,service.name,next_start,next_end,'scheduled',case when b.location='in_person' then 'in_person' else 'virtual' end,case when b.location='in_person' then 'Studio' else 'Google Meet' end,b.service_id,b.series_id,b.location,1,'studio') returning id into occurrence_id;
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed');
        insert into public.calendar_projections(lesson_id,projected_version,status,conference_request_id) values(occurrence_id,0,'queued',case when b.location='google_meet' then 'meet-'||occurrence_id::text else null end);
      end loop;
    end if;
  else
    update public.service_offerings set enrolled=enrolled+1,version=version+1,updated_at=now() where id=b.offering_id and enrolled<capacity returning lesson_ids[1] into lesson_id;
    if lesson_id is null then raise exception 'OFFERING_FULL'; end if;
    foreach occurrence_id in array (select lesson_ids from public.service_offerings where id=b.offering_id) loop
      insert into public.lesson_participants(lesson_id,booking_id,student_id,display_name,email,status) values(occurrence_id,b.id,student.id,b.guest_name,b.guest_email,'confirmed') on conflict on constraint lesson_participants_lesson_id_email_key do nothing;
    end loop;
  end if;
  for occurrence_id in select lp.lesson_id from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id where lp.booking_id=b.id order by l.starts_at,l.id loop
    if b.payment_policy='credits' and (series_record.kind is distinct from 'ongoing' or occurrence_id=lesson_id) then
      credit_package:=public.reserve_student_lesson_credit(occurrence_id,student.id,null,true,'Booking reservation '||b.reference);
      if credit_package is null then raise exception 'CREDIT_UNAVAILABLE: Not enough valid credits for the booked lessons.'; end if;
    elsif b.payment_policy in ('credits','pay_later') then
      perform public.reserve_student_lesson_credit(occurrence_id,student.id);
    end if;
  end loop;
  if amount_paid>0 then insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason) values(student.id,'payment',amount_paid,b.currency,provider_reference,'Booking payment '||b.reference) on conflict(external_reference) do nothing; end if;
  insert into public.audit_events(studio_id,action,entity_type,entity_id,reason,correlation_id,source,after_state)
  values(b.studio_id,'booking.confirmed','booking',b.id,'Payment or policy requirement satisfied',coalesce(provider_reference,b.reference),'booking_platform',to_jsonb(b)) returning id into audit_id;
  return jsonb_build_object('bookingId',b.id,'studentId',student.id,'lessonId',lesson_id,'auditEventId',audit_id,'duplicate',false);
end $$;

-- Cancellation retains issued documents and their payment history. Only unpaid linked
-- charges are waived; timely student cancellations return actual settled money once.
create function public.cancel_invoice_lesson(p_lesson uuid,p_student uuid,p_student_action boolean,p_use boolean) returns bigint
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; new_items jsonb; waived bigint; money bigint; returned bigint:=0; refund_key text;
begin
  for inv in select i.* from public.studio_invoices i where i.status not in ('draft','void') and (p_student is null or i.student_id=p_student)
    and exists(select 1 from jsonb_array_elements(i.items) x where x->'lessonIds' @> to_jsonb(array[p_lesson::text])) order by i.student_id,i.id for update loop
    if inv.checkout_key is not null then raise exception 'INVALID_TRANSITION: Check or cancel the pending online invoice payment first.'; end if;
    new_items:='[]';waived:=0;
    for item in select value from jsonb_array_elements(inv.items) loop
      if item->'lessonIds' @> to_jsonb(array[p_lesson::text]) and not coalesce((item->>'cancelled')::boolean,false) then
        money:=coalesce((item->>'paidMinor')::bigint,0);
        if not p_use then
          waived:=greatest(0,(item->>'quantity')::bigint*(item->>'unitMinor')::bigint-money-coalesce((item->>'creditMinor')::bigint,0));
          item:=jsonb_set(item,'{waivedMinor}',to_jsonb(waived));
          if p_student_action and money>0 then
            refund_key:='invoice-cancel:'||inv.id::text||':'||(item->>'id');
            insert into public.payment_entries(student_id,kind,amount_minor,currency,external_reference,reason,account_credit)
              values(inv.student_id,'refund',money,inv.currency,refund_key,'Dollar credit for cancelled invoice lesson · '||inv.number,true) on conflict(external_reference) do nothing;
            returned:=returned+money;
            item:=jsonb_set(item,'{returnedMinor}',to_jsonb(money));
          end if;
        end if;
        item:=jsonb_set(item,'{cancelled}',to_jsonb(true));
      end if;
      new_items:=new_items||jsonb_build_array(item);
    end loop;
    update public.studio_invoices set items=new_items,waived_minor=waived_minor+waived,version=version+1,updated_at=now(),
      status=case when paid_minor+credit_minor+waived_minor+waived=total_minor then 'paid' else status end where id=inv.id;
  end loop;
  return returned;
end $$;
revoke all on function public.cancel_invoice_lesson(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.cancel_invoice_lesson(uuid,uuid,boolean,boolean) to service_role;

-- Coach-reviewed, append-only normalization of older series reservations. Ambiguous
-- relationships abort the transaction rather than guessing or changing the balance.
create function public.reconcile_student_credit_reservations(p_student uuid,p_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old record; booking uuid; ids uuid[]; lid uuid; quantity integer; changed integer:=0;
begin
  perform 1 from public.students where id=p_student for update;
  if (public.student_credit_summary(p_student)->>'version')::integer<>p_version then raise exception 'VERSION_CONFLICT'; end if;
  if exists(select 1 from public.packages p where p.student_id=p_student and public.package_credit_balance(p.id)<0) or
    exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where p.student_id=p_student and e.lesson_id is null and e.quantity<0 and e.kind in ('reservation','consumption')) then
    raise exception 'INVALID_TRANSITION: This legacy balance requires a ledger review. No credits were changed.';
  end if;
  for old in select e.package_id,e.lesson_id,-sum(e.quantity)::integer qty from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where p.student_id=p_student and e.lesson_id is not null group by e.package_id,e.lesson_id having sum(e.quantity)<-1 order by e.lesson_id loop
    select lp.booking_id into booking from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
      where lp.lesson_id=old.lesson_id and b.student_id=p_student and b.status='confirmed' and b.payment_policy='credits';
    if booking is null then raise exception 'INVALID_TRANSITION: The older reservation has no confirmed credit booking. No credits were changed.'; end if;
    select array_agg(distinct lp.lesson_id) into ids from public.lesson_participants lp join public.lessons l on l.id=lp.lesson_id
      where lp.booking_id=booking and lp.student_id=p_student and lp.status in ('confirmed','reserved','attended') and l.status in ('scheduled','completed');
    if cardinality(ids) is distinct from old.qty or exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
      where e.lesson_id=any(ids) and e.lesson_id<>old.lesson_id and p.student_id=p_student group by e.lesson_id having sum(e.quantity)<>0) then
      raise exception 'INVALID_TRANSITION: The reservation does not match the linked series. No credits were changed.';
    end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason) values(old.package_id,old.lesson_id,'release',old.qty,'Coach reviewed legacy series reservation');
    foreach lid in array ids loop
      insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason) values(old.package_id,lid,'reservation',-1,'Legacy series credit assigned to its lesson');
      update public.lessons set package_id=old.package_id,payment_status='paid_by_credit',version=version+1,updated_at=now() where id=lid and student_id=p_student;
    end loop;
    changed:=changed+1;
  end loop;
  if changed=0 then raise exception 'INVALID_TRANSITION: No safely matched legacy series reservation was found.'; end if;
  return public.student_credit_summary(p_student)||jsonb_build_object('reconciled',changed);
end $$;
revoke all on function public.reconcile_student_credit_reservations(uuid,integer) from public,anon,authenticated;
grant execute on function public.reconcile_student_credit_reservations(uuid,integer) to service_role;

create function public.reserve_student_upcoming_credits(p_student uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare lid uuid; applied integer:=0;
begin
  perform 1 from public.students where id=p_student for update;
  for lid in select l.id from public.lessons l where l.status='scheduled' and l.starts_at>=now() and (l.student_id=p_student or exists(select 1 from public.lesson_participants where lesson_id=l.id and student_id=p_student and status in ('reserved','confirmed'))) order by l.starts_at,l.id loop
    if public.reserve_student_lesson_credit(lid,p_student) is not null then applied:=applied+1; end if;
  end loop;
  return public.student_credit_summary(p_student)||jsonb_build_object('applied',applied);
end $$;
revoke all on function public.reserve_student_upcoming_credits(uuid) from public,anon,authenticated;
grant execute on function public.reserve_student_upcoming_credits(uuid) to service_role;
