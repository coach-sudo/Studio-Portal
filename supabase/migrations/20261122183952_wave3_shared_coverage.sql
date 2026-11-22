
-- A package retains its historic owner and one ledger. Beneficiary membership
-- authorizes future reservations only; each debit records who used it.
create table credit_internal.package_beneficiaries (
  package_id uuid not null references public.packages(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  primary key (package_id, student_id)
);
alter table credit_internal.package_beneficiaries enable row level security;
revoke all on credit_internal.package_beneficiaries from public,anon,authenticated,service_role;
create index package_beneficiaries_student_idx on credit_internal.package_beneficiaries(student_id, package_id);

alter table public.package_credit_entries add column covered_student_id uuid references public.students(id) on delete restrict;
create index package_credit_entries_covered_student_idx on public.package_credit_entries(covered_student_id,lesson_id)
  where covered_student_id is not null;

create function credit_internal.has_shared_package_payer(p_owner uuid,p_student uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from public.students owner
    join public.students member on member.id=p_student and member.studio_id=owner.studio_id
    join public.linked_contacts a on a.student_id=owner.id and a.user_id is not null
    where owner.id=p_owner and owner.deleted_at is null and member.deleted_at is null
      and training_internal.is_lesson_payer(a.user_id,owner.id)
      and training_internal.is_lesson_payer(a.user_id,member.id)
  )
$$;
revoke all on function credit_internal.has_shared_package_payer(uuid,uuid) from public,anon,authenticated,service_role;

create function credit_internal.package_covers_student(p_package uuid,p_owner uuid,p_student uuid)
returns boolean language sql stable set search_path='' as $$
  select p_owner=p_student or (
    exists(select 1 from credit_internal.package_beneficiaries where package_id=p_package and student_id=p_student)
    and credit_internal.has_shared_package_payer(p_owner,p_student)
  )
$$;
revoke all on function credit_internal.package_covers_student(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function credit_internal.package_matches_issued_terms(p_package uuid,p_service uuid,p_duration interval)
returns boolean language sql stable set search_path='' as $$
  select coalesce(p_service=any(t.service_ids) and p_duration=make_interval(mins=>t.duration_minutes),false)
  from credit_internal.package_credit_terms t
  where t.package_id=p_package and t.original_definition_id is not null
$$;
revoke all on function credit_internal.package_matches_issued_terms(uuid,uuid,interval) from public,anon,authenticated,service_role;

create function credit_internal.shared_package_options(p_owner uuid,p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('packageId',p.id,
    'verifiedTerms',exists(select 1 from credit_internal.package_credit_terms t where t.package_id=p.id
      and t.original_definition_id is not null and t.duration_minutes>0 and cardinality(t.service_ids)>0
      and t.issuance_entry_id is not null),
    'selected',coalesce((select jsonb_agg(b.student_id order by b.student_id)
      from credit_internal.package_beneficiaries b where b.package_id=p.id),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name,'eligible',
      credit_internal.has_shared_package_payer(p_owner,s.id)) order by s.full_name,s.id)
      from public.students s where s.studio_id=o.studio_id and s.id<>p_owner and s.deleted_at is null
        and (credit_internal.has_shared_package_payer(p_owner,s.id) or exists(
          select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id and b.student_id=s.id))),
      '[]'::jsonb))
  from public.packages p join public.students o on o.id=p.student_id
  where p.id=p_package and p.student_id=p_owner
$$;
revoke all on function credit_internal.shared_package_options(uuid,uuid) from public,anon,authenticated,service_role;

create function credit_internal.set_shared_package_beneficiaries(p_owner uuid,p_value jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  pkg_id uuid:=(p_value->>'packageId')::uuid;
  ids uuid[];
  previous jsonb;
begin
  if jsonb_typeof(p_value->'studentIds') is distinct from 'array'
    or jsonb_array_length(p_value->'studentIds')>50
    or coalesce(length(trim(p_value->>'reason')),0) not between 3 and 500 then
    raise exception 'VALIDATION_FAILED: Review a roster and enter a reason.';
  end if;
  select array_agg(distinct x::uuid order by x::uuid) into ids
    from jsonb_array_elements_text(p_value->'studentIds') s(x);
  perform 1 from public.packages where id=pkg_id and student_id=p_owner for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  previous:=credit_internal.shared_package_options(p_owner,pkg_id);
  if previous->'selected' is distinct from p_value->'reviewedStudentIds' then
    raise exception 'VERSION_CONFLICT: Review the current shared roster again.';
  end if;
  if coalesce(cardinality(ids),0)>0 and previous->>'verifiedTerms'<>'true' then
    raise exception 'INVALID_TRANSITION: Verify the issued package terms before sharing.';
  end if;
  if exists(select 1 from unnest(ids) s(id) where s.id is null or s.id=p_owner
    or not credit_internal.has_shared_package_payer(p_owner,s.id)) then
    raise exception 'FORBIDDEN: Select students with the same authorized household payer.';
  end if;
  delete from credit_internal.package_beneficiaries
    where package_id=pkg_id and not (student_id=any(coalesce(ids,'{}')));
  insert into credit_internal.package_beneficiaries(package_id,student_id)
    select pkg_id,id from unnest(ids) s(id) on conflict do nothing;
  return jsonb_build_object('before',previous,'roster',credit_internal.shared_package_options(p_owner,pkg_id));
end $$;
revoke all on function credit_internal.set_shared_package_beneficiaries(uuid,jsonb) from public,anon,authenticated,service_role;

-- Sharing uses only explicitly assigned, verified and one-student coverage.
-- Issued invoices keep their cash path; manual reconciliation handles overlap.
create function credit_internal.shared_lesson_can_use_package(p_lesson public.lessons,p_student uuid)
returns boolean language sql stable set search_path='' as $$
  select p_lesson.student_id=p_student and coalesce(p_lesson.capacity,1)=1 and p_lesson.offering_id is null
    and not exists(select 1 from public.lesson_participants where lesson_id=p_lesson.id
      and student_id<>p_student and status in ('reserved','confirmed'))
    and not exists(select 1 from public.studio_invoices i cross join lateral jsonb_array_elements(i.items) x
      where i.student_id=p_student and i.status not in ('draft','void')
        and x->'lessonIds' @> to_jsonb(array[p_lesson.id::text]))
$$;
revoke all on function credit_internal.shared_lesson_can_use_package(public.lessons,uuid) from public,anon,authenticated,service_role;


create or replace function credit_internal.evaluate_student_lesson_credit(
  p_student uuid, p_lesson uuid, p_mode text default 'automatic',
  p_allocated jsonb default '{}'::jsonb, p_package uuid default null,
  p_needs_review boolean default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  l public.lessons;
  pkg public.packages;
  enabled boolean;
  reason text;
  state text := 'ineligible';
  reservation_count integer;
  reserved_package uuid;
  matching_lots integer;
  includes_shared boolean;
begin
  if p_mode not in ('automatic', 'enable_preview', 'manual')
     or jsonb_typeof(p_allocated) is distinct from 'object' then
    raise exception 'VALIDATION_FAILED: Invalid coverage evaluation mode.' using errcode = '22023';
  end if;
  select x.* into l from public.lessons x join public.students s on s.id = p_student
    where x.id = p_lesson and x.studio_id = s.studio_id
      and (x.student_id = p_student or exists(
        select 1 from public.lesson_participants lp where lp.lesson_id = x.id
          and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')));
  if l.id is null then
    return jsonb_build_object('state', 'ineligible', 'reasonCode', 'lesson_ineligible', 'eligible', false);
  end if;
  select coalesce(sum(t.qty), 0)::integer, (array_agg(t.package_id order by t.package_id))[1]
    into reservation_count, reserved_package
    from (select e.package_id, greatest(0, -sum(e.quantity))::integer qty
      from public.package_credit_entries e join public.packages p on p.id = e.package_id
      where e.lesson_id = l.id and coalesce(e.covered_student_id,p.student_id) = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
  end if;
  if l.status <> 'scheduled' and not (p_mode = 'manual' and l.status = 'completed') then
    reason := 'lesson_ineligible';
  elsif l.invoice_payment_pending or l.direct_checkout_id is not null or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.student_id = p_student and i.checkout_key is not null
      and x->'lessonIds' @> to_jsonb(array[l.id::text])) then
    reason := 'payment_pending';
    if reservation_count > 0 then state := 'review_required'; end if;
  elsif reservation_count > 1 then
    select * into pkg from public.packages where id = reserved_package;
    return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif reservation_count = 1 then
    select * into pkg from public.packages where id = reserved_package;
    if l.status = 'scheduled' and pkg.expires_at <= greatest(now(), l.starts_at) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'expires_before_lesson',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    if (l.student_id = p_student and (l.paid_minor > 0 or l.payment_status in ('paid', 'partially_paid', 'waived', 'refunded')))
       or exists(select 1 from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
         where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
           and b.payment_status in ('paid', 'partially_paid', 'processing')) then
      return jsonb_build_object('state', 'review_required', 'reasonCode', 'reconciliation_required',
        'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
    end if;
    return jsonb_build_object('state', 'covered', 'reasonCode', 'already_reserved',
      'eligible', false, 'existingReservation', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
  elsif coalesce(p_needs_review, (public.student_credit_summary(p_student)->>'needsReview')::boolean) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where p.student_id=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
    reason := 'reconciliation_required'; state := 'review_required';
  elsif l.student_id = p_student and l.payment_status = 'partially_paid' then
    reason := 'partially_paid';
  elsif l.student_id = p_student and (l.payment_status = 'paid' or l.paid_minor > 0) then
    reason := 'cash_paid';
  elsif l.student_id = p_student and l.payment_status in ('waived', 'refunded') then
    reason := 'lesson_ineligible';
  else
    select case when b.payment_status = 'processing' then 'payment_pending'
        when b.payment_status = 'partially_paid' then 'partially_paid' else 'cash_paid' end
      into reason from public.lesson_participants lp join public.bookings b on b.id = lp.booking_id
      where lp.lesson_id = l.id and b.student_id = p_student and b.payment_policy <> 'credits'
        and b.payment_status in ('paid', 'partially_paid', 'processing')
      order by case b.payment_status when 'processing' then 0 when 'partially_paid' then 1 else 2 end, b.id
      limit 1;
    if reason is null then
      select case when exists(select 1 from public.student_credit_accounts where student_id=p_student)
        then (select auto_apply from public.student_credit_accounts where student_id=p_student) else false end into enabled;
      if p_mode <> 'manual' and l.source_provider is not null and l.source_provider not in ('studio','public_booking') then
        reason := 'reconciliation_required'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled is null then
        reason := 'mixed_settings_review'; state := 'review_required';
      elsif p_mode = 'automatic' and enabled = false then
        reason := 'auto_disabled';
      else
        select p.* into pkg from public.packages p
          where credit_internal.package_covers_student(p.id,p.student_id,p_student)
            and (p_package is null or p.id = p_package)
            and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is not false
            and (not exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id)
              or credit_internal.shared_lesson_can_use_package(l,p_student))
            and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0
          order by p.expires_at nulls last, p.created_at, p.id limit 1;
        if pkg.id is not null and p_package is null then
          select count(*),bool_or(exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id))
            into matching_lots,includes_shared
          from public.packages p where credit_internal.package_covers_student(p.id,p.student_id,p_student)
            and (p_mode<>'automatic' or coalesce(enabled,p.auto_apply))
            and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
            and public.package_credit_balance(p.id)-coalesce((p_allocated->>p.id::text)::integer,0)>0
            and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is not false
            and (not exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id)
              or credit_internal.shared_lesson_can_use_package(l,p_student));
          if matching_lots>1 and includes_shared then
            return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false);
          end if;
        end if;
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where credit_internal.package_covers_student(p.id,p.student_id,p_student) and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is not false
            and (not exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id)
              or credit_internal.shared_lesson_can_use_package(l,p_student))
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where credit_internal.package_covers_student(p.id,p.student_id,p_student)
          and (p_package is null or p.id = p_package)
            and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is not false
            and (not exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id)
              or credit_internal.shared_lesson_can_use_package(l,p_student))
          and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
          and p.expires_at > now() and p.expires_at <= l.starts_at
          and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'expires_before_lesson';
        else
          reason := 'no_available_credits';
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', state, 'reasonCode', reason, 'eligible', false);
end;
$$;

create or replace function public.reserve_student_lesson_credit(
  p_lesson_id uuid, p_student uuid, p_package_id uuid default null,
  p_manual boolean default false, p_reason text default 'Credit reserved for upcoming lesson'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.lessons;
  decision jsonb;
  credit_package uuid;
begin
  select * into l from public.lessons where id = p_lesson_id;
  if l.id is null or not exists(select 1 from public.students s where s.id = p_student and s.studio_id = l.studio_id) then return null; end if;
  if l.student_id is distinct from p_student and not exists(select 1 from public.lesson_participants
    where lesson_id = l.id and student_id = p_student and status in ('confirmed','reserved')) then return null; end if;
  perform 1 from public.students where id = p_student for update;
  select * into l from public.lessons where id = p_lesson_id for update;
  decision := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
    case when p_manual then 'manual' else 'automatic' end, '{}'::jsonb, p_package_id);
  credit_package := (decision->>'packageId')::uuid;
  if coalesce((decision->>'existingReservation')::boolean, false) then return credit_package; end if;
  if not (decision->>'eligible')::boolean then return null; end if;
  perform 1 from public.packages where id = credit_package for update;
  if not found then return null; end if;
  -- Recheck after waiting for a lot lock so a concurrent expiry/balance edit
  -- cannot make the earlier read actionable. Student locks serialize normal
  -- reservations; the lot lock also protects less common package edits.
  decision := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
    case when p_manual then 'manual' else 'automatic' end, '{}'::jsonb, p_package_id);
  if not (decision->>'eligible')::boolean or (decision->>'packageId')::uuid is distinct from credit_package then return null; end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,covered_student_id)
    values(credit_package,l.id,case when l.status = 'completed' then 'consumption'::public.credit_entry_kind
      else 'reservation'::public.credit_entry_kind end,-1,p_reason,p_student);
  update public.bookings b set payment_policy = 'credits',payment_status = 'paid',version = b.version+1,updated_at = now()
    where b.student_id = p_student and b.paid_minor = 0
      and b.id in(select booking_id from public.lesson_participants where lesson_id = l.id and student_id = p_student);
  update public.lessons set package_id = credit_package,
    payment_status = 'paid_by_credit',version = version+1,updated_at = now() where id = l.id and student_id = p_student;
  perform public.sync_invoice_lesson_credit(l.id,p_student);
  return credit_package;
end;
$$;

create or replace function public.settle_lesson_credits(p_lesson uuid,p_use boolean,p_student uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare lot record; restored uuid; quantity integer;
begin
  if p_use then return; end if;
  perform 1 from public.students where id in(select p.student_id from public.packages p join public.package_credit_entries e on e.package_id=p.id where e.lesson_id=p_lesson and (p_student is null or coalesce(e.covered_student_id,p.student_id)=p_student)) order by id for update;
  for lot in select p.id,p.student_id,p.expires_at from public.packages p
    where exists(select 1 from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=p.id and (p_student is null or coalesce(e.covered_student_id,p.student_id)=p_student))
    order by p.student_id,p.id for update
  loop
    perform 1 from public.students where id=lot.student_id for update;
    select greatest(0,-coalesce(sum(e.quantity),0))::integer into quantity from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=lot.id and (p_student is null or coalesce(e.covered_student_id,lot.student_id)=p_student);
    if quantity=0 then continue; end if;
    insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,covered_student_id)
      values(lot.id,p_lesson,'release',quantity,'Credit returned after cancellation',coalesce(p_student,(select e.covered_student_id from public.package_credit_entries e where e.package_id=lot.id and e.lesson_id=p_lesson and e.quantity<0 order by e.id limit 1),lot.student_id));
    if lot.expires_at is not null and lot.expires_at<=now() and not exists(select 1 from public.package_credit_entries e where e.package_id=lot.id and e.lesson_id=p_lesson and e.quantity<0 and coalesce(e.covered_student_id,lot.student_id)<>lot.student_id) then
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(lot.id,'adjustment',-quantity,'Returned credit transferred to 30-day balance');
      insert into public.packages(student_id,name,expires_at) values(lot.student_id,'Returned lesson credits',now()+interval '30 days') returning id into restored;
      insert into public.package_credit_entries(package_id,kind,quantity,reason) values(restored,'adjustment',quantity,'Cancelled lesson credit available for 30 days');
    end if;
  end loop;
end $$;

create or replace function lesson_ops.payment_context(p_actor uuid,p_lesson uuid,p_direct boolean,p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; b public.bookings; participant public.lesson_participants; reason text; money_currency text; count_participants bigint; paid bigint; result jsonb;
begin
 select * into l from public.lessons where id=p_lesson;
  if p_actor is null or l.id is null or
   (not p_direct and not exists(select 1 from public.memberships where user_id=p_actor and studio_id=l.studio_id and role='coach')) or
   (p_direct and p_attempt is null and not training_internal.is_lesson_payer(p_actor,l.student_id)) or
   (p_direct and p_attempt is not null and l.direct_checkout_id is distinct from p_attempt)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select count(*) into count_participants from public.lesson_participants where lesson_id=l.id;
 if count_participants=1 then select * into participant from public.lesson_participants where lesson_id=l.id; end if;
 if participant.booking_id is not null then select * into b from public.bookings where id=participant.booking_id; end if;
 select coalesce(sum(r.amount_minor),0) into paid from lesson_ops.payment_receipts r join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id;
 select coalesce(nullif(b.currency,''),nullif(s.settings->>'currency','')) into money_currency from public.studios s where s.id=l.studio_id;
 if not exists(select 1 from public.students where id=l.student_id and studio_id=l.studio_id and deleted_at is null) then reason:='student_unavailable';
 elsif l.invoice_id is not null or exists(select 1 from public.studio_invoices i where i.status<>'void' and exists(select 1 from jsonb_array_elements(i.items) item where item->'lessonIds' @> to_jsonb(array[l.id::text]))) then reason:='use_invoice';
 elsif l.invoice_payment_pending and p_attempt is null then reason:='checkout_pending';
  elsif p_direct and (l.source_provider is distinct from 'studio' or l.payment_needs_review or l.service_id is null) then reason:='price_or_status_review';
 elsif l.status not in ('scheduled','completed') then reason:='outcome_review';
 elsif coalesce(l.capacity,1)>1 or l.offering_id is not null or l.series_id is not null or count_participants>1 or (count_participants=1 and participant.student_id is distinct from l.student_id) then reason:='allocation_review';
 elsif l.package_id is not null or exists(select 1 from public.package_credit_entries where lesson_id=l.id) then reason:='credit_review';
 elsif p_direct and p_attempt is null and exists(
   select 1 from credit_internal.package_beneficiaries member join public.packages p on p.id=member.package_id
   where credit_internal.package_covers_student(p.id,p.student_id,l.student_id)
     and credit_internal.package_matches_issued_terms(p.id,l.service_id,l.ends_at-l.starts_at) is true
     and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
     and public.package_credit_balance(p.id)>0
 ) and ((credit_internal.evaluate_student_lesson_credit(l.student_id,l.id,'automatic')->>'eligible')::boolean
   or credit_internal.evaluate_student_lesson_credit(l.student_id,l.id,'manual')->>'state'='review_required')
 then reason:='credit_review';
 elsif exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id and c.financial_review_required and not exists(select 1 from lesson_ops.datetime_correction_reviews r where r.correction_id=c.id and r.kind='financial')) then reason:='correction_review';
 elsif b.id is not null and (b.studio_id<>l.studio_id or b.student_id is distinct from l.student_id or b.series_id is not null or b.offering_id is not null or b.status not in ('confirmed','completed') or exists(select 1 from public.lesson_participants where booking_id=b.id and lesson_id<>l.id)) then reason:='allocation_review';
 elsif b.id is not null and (b.payment_policy<>'pay_later' or b.stripe_checkout_session_id is not null or b.stripe_subscription_id is not null or b.payment_status in ('processing','refunded','past_due','failed')) then reason:='provider_review';
 elsif p_direct and b.id is not null and (
   b.admin_override->'createdByCoach' is distinct from 'true'::jsonb
   or b.service_id is distinct from l.service_id
   or b.auto_charge_balance or b.payment_status not in ('due','partially_paid')
   or participant.status not in ('confirmed','attended')) then reason:='provider_review';
 elsif p_direct and not exists(select 1 from public.booking_services svc where svc.id=l.service_id
   and svc.studio_id=l.studio_id and svc.currency=money_currency) then reason:='price_or_status_review';
 elsif money_currency is null or money_currency!~'^[A-Z]{3}$' then reason:='currency_review';
 elsif l.price_minor is null or l.price_minor<=0 or l.price_minor>9007199254740991 or l.payment_status not in ('due','partially_paid') then reason:='price_or_status_review';
 elsif exists(select 1 from lesson_ops.payment_receipts r left join public.payment_entries e on e.id=r.payment_entry_id and e.student_id=r.student_id and e.kind='payment' and e.amount_minor=r.amount_minor and e.currency=r.currency where r.lesson_id=l.id and (e.id is null or r.student_id<>l.student_id or r.studio_id<>l.studio_id or r.currency is distinct from money_currency)) then reason:='historical_totals_review';
 elsif coalesce(l.paid_minor,0)<>paid or (b.id is not null and (b.paid_minor<>paid or b.total_minor is distinct from l.price_minor)) then reason:='historical_totals_review';
 elsif paid>=l.price_minor then reason:='no_balance';
 end if;
 result:=jsonb_build_object('lessonId',l.id,'version',l.version,'studentId',l.student_id,'participantId',participant.id,'bookingId',b.id,'bookingVersion',b.version,'currency',money_currency,'priceMinor',l.price_minor,'paidMinor',coalesce(l.paid_minor,0),'remainingMinor',greatest(0,coalesce(l.price_minor,0)-coalesce(l.paid_minor,0)),'eligible',reason is null,'reasonCode',reason);
 return result||jsonb_build_object('reviewToken',encode(extensions.digest(jsonb_build_object('actor',p_actor,'context',result)::text,'sha256'),'hex'));
end $$;

create or replace function credit_internal.package_credit_review(p_student uuid, p_package uuid)
returns jsonb language sql stable set search_path='' as $$
  with lot as (
    select p.*,
      case when t.package_id is not null then t.duration_minutes else d.session_duration_minutes end session_duration_minutes,
      case when t.package_id is not null then t.service_ids else d.eligible_service_ids end eligible_service_ids,
      t.package_id is not null captured,
      t.original_student_id,t.original_definition_id,t.original_name,t.original_expires_at,t.issuance_entry_id
    from public.packages p
    join public.students s on s.id=p.student_id
    left join credit_internal.package_credit_terms t on t.package_id=p.id
    left join public.package_definitions d on d.id=p.definition_id and d.studio_id=s.studio_id
    where p.id=p_package and p.student_id=p_student
  ), debits as (
    select e.lesson_id, sum(e.quantity)::integer net, l.status, l.starts_at, l.ends_at,
      l.service_id, l.topic, l.student_id,
      (l.student_id=p_student or bool_or(e.covered_student_id=l.student_id) or exists(select 1 from public.lesson_participants lp
        where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed'))) participant
    from public.package_credit_entries e
    join lot p on p.id=e.package_id
    left join public.lessons l on l.id=e.lesson_id
    where e.lesson_id is not null or e.kind in ('reservation','consumption')
    group by e.lesson_id,l.id
    having sum(e.quantity) < 0
  ), totals as (
    select coalesce(sum(-net) filter (where status='scheduled'),0)::integer held,
      coalesce(sum(-net) filter (where status in ('completed','late_cancelled','no_show')),0)::integer consumed
    from debits
  ), ledger as (
    select coalesce(sum(e.quantity),0)::integer net,
      coalesce(sum(e.quantity) filter (where e.kind='purchase' and e.quantity>0),0)::integer purchased,
      coalesce(sum(e.quantity) filter (where e.kind in ('purchase','adjustment') and e.quantity>0 and e.lesson_id is null and e.reverses_entry_id is null),0)::integer issued
    from lot p join public.package_credit_entries e on e.package_id=p.id
  )
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'studentId', p.student_id,
    'durationMinutes', p.session_duration_minutes, 'serviceIds', coalesce(p.eligible_service_ids,'{}'),
    'services', coalesce((select jsonb_agg(b.name order by b.name,b.id)
      from public.booking_services b join public.students s on s.id=p.student_id
      where b.studio_id=s.studio_id and b.id=any(p.eligible_service_ids)),'[]'::jsonb),
    'terms', case when p.captured then jsonb_build_object(
      'originalStudentId',p.original_student_id,'originalDefinitionId',p.original_definition_id,
      'originalName',p.original_name,'originalExpiresAt',p.original_expires_at,'issuanceEntryId',p.issuance_entry_id) end,
    'expiresAt', p.expires_at, 'issued', ledger.issued, 'purchased', ledger.purchased,
    'ledgerBalance', ledger.net, 'consumed', totals.consumed,
    'held', totals.held,
    'reserved', case when p.expires_at<=now() then 0 else totals.held end,
    'unused', case when p.expires_at<=now() then 0 else ledger.net+totals.held end,
    'available', case when p.expires_at<=now() then 0 else ledger.net end,
    'issues', to_jsonb(array_remove(array[
      case when not p.captured then 'legacy_terms_unverified' end,
      case when p.session_duration_minutes is null or coalesce(cardinality(p.eligible_service_ids),0)=0 then 'eligibility_unverified' end,
      case when ledger.net<0 then 'negative_ledger' end,
      case when ledger.purchased>0 and exists (
        select 1 from public.package_credit_entries e where e.package_id=p.id and e.kind='purchase'
          and e.quantity>0 and e.idempotency_key is null) then 'purchase_source_unverified' end,
      case when exists (
        select 1 from public.package_credit_entries e where e.package_id=p.id and e.kind='purchase'
          and e.quantity>0 and e.idempotency_key is not null
        group by e.reason,e.quantity having count(*)>1) then 'repeated_purchase_description' end,
      case when exists(select 1 from debits b join public.lessons l on l.id=b.lesson_id
        where l.student_id=p_student and l.package_id is not null and l.package_id<>p.id)
        then 'lesson_package_mismatch' end,
      case when ledger.issued=0 and (ledger.net<>0 or exists(select 1 from debits)
        or exists(select 1 from public.payment_entries e where e.package_id=p.id and e.student_id=p_student and e.kind='payment'))
        then 'missing_issuance' end,
      case when exists(select 1 from debits b join public.lessons l on l.id=b.lesson_id
        where l.paid_minor>0 or l.payment_status in ('paid','partially_paid')) then 'cash_credit_overlap' end,
      case when exists(select 1 from debits where status is null or (status='scheduled' and participant is not true)) then 'orphaned_debit' end,
      case when exists(select 1 from debits where status='cancelled') then 'cancelled_lesson_debit' end,
      case when exists(select 1 from debits where net < -1) then 'duplicate_lesson_debit' end,
      case when exists(select 1 from debits where status='scheduled' and p.expires_at<=greatest(now(),starts_at)) then 'expired_reservation' end,
      case when exists(select 1 from debits where status='scheduled' and
        (service_id=any(p.eligible_service_ids) and ends_at-starts_at=make_interval(mins=>p.session_duration_minutes)) is not true)
        then 'unverified_reservation_eligibility' end,
      case when exists(select 1 from debits b where b.lesson_id is not null and exists (
        select 1 from public.package_credit_entries e join public.packages other on other.id=e.package_id
        where e.lesson_id=b.lesson_id and other.student_id=p_student and other.id<>p.id
        group by other.id having sum(e.quantity)<0)) then 'conflicting_package_allocations' end
    ],null)),
    'purchaseReferences', coalesce((select jsonb_agg(r.external_reference) from
      (select external_reference from public.payment_entries where package_id=p.id and student_id=p_student
        and kind='payment' and external_reference is not null order by created_at desc,id limit 25) r),'[]'::jsonb))
  from lot p cross join totals cross join ledger
$$;

create or replace function public.command_student_credit_settings(
  p_student uuid,p_command text,p_value jsonb,p_version integer,p_key text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.students; prior credit_internal.credit_command_receipts; result jsonb; audit_id uuid; before_balance jsonb;
  request jsonb:=jsonb_build_object('command',p_command,'value',p_value,'version',p_version);
begin
  select * into s from public.students where id=p_student and deleted_at is null for update;
  if s.id is null or p_actor is null or not exists(select 1 from public.memberships
    where user_id=p_actor and studio_id=s.studio_id and role='coach') then raise exception 'FORBIDDEN'; end if;
  if p_command='sharing_options' then
    result:=credit_internal.shared_package_options(p_student,(p_value->>'packageId')::uuid);
    if result is null then raise exception 'FORBIDDEN'; end if;
    return result;
  end if;
  if p_command='package_review' then
    result:=credit_internal.review_student_package_credits(p_student,p_value);
    if p_value->>'packageId' is not null then
      result:=result||jsonb_build_object('cases',credit_internal.sync_reconciliation_cases(
        p_student,(p_value->>'packageId')::uuid,p_actor));
    end if;
    return result;
  end if;
  if p_key is null or length(p_key)<3 or length(p_key)>250 then raise exception 'VALIDATION_FAILED'; end if;
  select * into prior from credit_internal.credit_command_receipts where key=p_key;
  if prior.key is not null then
    if prior.student_id<>p_student or prior.actor_id is distinct from p_actor or prior.request<>request then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  if p_command='set_sharing' then
    result:=credit_internal.set_shared_package_beneficiaries(p_student,p_value);
    before_balance:=result->'before';
  elsif p_command='case_decide' then
    result:=credit_internal.decide_reconciliation_case(p_student,p_value,p_actor,p_version);
    before_balance:=result->'before';
  elsif p_command='package_correct' then
    result:=credit_internal.correct_student_package_credit(p_student,p_value,p_actor,p_key,p_version);
    before_balance:=result->'before';
  elsif p_command='set_total' then
    select jsonb_build_object('remaining', summary->'remaining',
      'available', summary->'available', 'reserved', summary->'reserved')
      into before_balance from public.student_credit_summary(p_student) summary;
    if p_value ? 'reviewedBalance' and
      (select count(*) from public.packages where student_id=p_student and (expires_at is null or expires_at>now()))>1 then
      raise exception 'INVALID_TRANSITION: Select the exact package to adjust.';
    end if;
    if p_value ? 'reviewedBalance' and (p_value->>'total')::integer>(before_balance->>'remaining')::integer
      and exists(select 1 from public.packages where student_id=p_student
        and (expires_at is null or expires_at>now())
        and (definition_id is not null or name<>'Studio lesson credits' or expires_at is not null)) then
      raise exception 'INVALID_TRANSITION: Select the exact package to add credits to.';
    end if;
    if p_value ? 'reviewedBalance' and p_value->'reviewedBalance' is distinct from before_balance then
      raise exception 'VERSION_CONFLICT: Review the current credit balance again.';
    end if;
    result:=public.set_student_credit_total(p_student,(p_value->>'total')::integer,p_version,p_value->>'reason','credit-total:'||p_key);
  elsif p_command='set_auto' then
    if jsonb_typeof(p_value->'enabled') is distinct from 'boolean' then raise exception 'VALIDATION_FAILED'; end if;
    if (p_value->>'enabled')::boolean=false then
      update credit_internal.credit_coverage_jobs set manual_requested=false where student_id=p_student;
    end if;
    result:=public.set_student_credit_auto(p_student,(p_value->>'enabled')::boolean,p_version);
  elsif p_command='apply_upcoming' then
    if coalesce((select version from public.student_credit_accounts where student_id=p_student),1)<>p_version then raise exception 'VERSION_CONFLICT'; end if;
    result:=credit_internal.request_coverage(p_student,true);
  else raise exception 'VALIDATION_FAILED'; end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(s.studio_id,p_actor,'credits.'||p_command,case when p_command='case_decide' then 'credit_case' else 'student' end,
      case when p_command='case_decide' then (result->'case'->>'id')::uuid else s.id end,coalesce(p_value->>'reason','Coach reviewed credit coverage'),p_key,'coach_portal',before_balance,result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response) values(p_key,s.id,p_actor,request,result);
  return result;
end $$;

-- The original permission for the package owner remains in force. A shared
-- entry also requires finance access to the student attributed on that entry.
alter policy credits_finance_access on public.package_credit_entries to authenticated using (
  exists(select 1 from public.packages p where p.id=package_id and public.can_view_student_finance(p.student_id))
  and (covered_student_id is null or public.can_view_student_finance(covered_student_id))
);

create function credit_internal.guard_wave3_typed_hold()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'scheduled' or new.status not in ('scheduled','completed')
    or (new.status,new.starts_at,new.ends_at,new.service_id)
       is not distinct from (old.status,old.starts_at,old.ends_at,old.service_id) then return new; end if;
  if exists(
    select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=old.id
      and (credit_internal.package_matches_issued_terms(p.id,new.service_id,new.ends_at-new.starts_at) is false
        or (credit_internal.package_matches_issued_terms(p.id,new.service_id,new.ends_at-new.starts_at) is true
          and p.expires_at<=new.starts_at))
    group by p.id having sum(e.quantity)<0
  ) then raise exception 'INVALID_TRANSITION: Review package coverage before changing this lesson.'; end if;
  return new;
end $$;
revoke all on function credit_internal.guard_wave3_typed_hold() from public,anon,authenticated,service_role;
create trigger guard_wave3_typed_hold before update of status,starts_at,ends_at,service_id on public.lessons
  for each row execute function credit_internal.guard_wave3_typed_hold();

create or replace function credit_internal.read_student_credit_history(p_student uuid,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page not between 1 and 1000000 then raise exception 'VALIDATION_FAILED'; end if;
  return jsonb_build_object('studentId',p_student,'page',p_page,'total',(select count(*) from public.package_credit_entries e join public.packages p on p.id=e.package_id where coalesce(e.covered_student_id,p.student_id)=p_student),
    'items',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id) from (
      select e.created_at,e.id,jsonb_build_object('id',e.id,'quantity',e.quantity,'kind',e.kind,'createdAt',e.created_at,'packageName',p.name,'reason',case when exists(select 1 from public.students s where s.id=p_student and public.is_studio_coach(s.studio_id)) then e.reason else null end) item
      from public.package_credit_entries e join public.packages p on p.id=e.package_id where coalesce(e.covered_student_id,p.student_id)=p_student
      order by e.created_at desc,e.id limit 25 offset (p_page-1)*25
    )x),'[]'::jsonb));
end $$;

create or replace function credit_internal.correct_student_package_credit(
  p_student uuid,p_value jsonb,p_actor uuid,p_key text,p_version integer
) returns jsonb language plpgsql set search_path='' as $$
declare
  pkg public.packages;
  source public.package_credit_entries;
  before_lot jsonb;
  operation text:=p_value->>'operation';
  explanation text:=trim(p_value->>'reason');
  reviewed jsonb:=p_value->'reviewedLot';
  delta integer;
  lesson_to_restore uuid;
  inserted uuid;
  requested integer;
begin
  if operation is null or operation not in ('add','remove','set','reverse','restore')
    or explanation is null or char_length(explanation) not between 3 and 500 then
    raise exception 'VALIDATION_FAILED: Select a correction and enter a reason.';
  end if;
  select * into pkg from public.packages where id=(p_value->>'packageId')::uuid
    and student_id=p_student for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  before_lot:=credit_internal.package_credit_review(p_student,pkg.id);
  if reviewed is distinct from before_lot or p_version is distinct from
    coalesce((select version from public.student_credit_accounts where student_id=p_student),1) then
    raise exception 'VERSION_CONFLICT: Review the current package balance again.';
  end if;
  if pkg.expires_at<=now() then
    raise exception 'INVALID_TRANSITION: Review the expiry before correcting this package.';
  end if;
  if operation in ('reverse','restore') then
    select * into source from public.package_credit_entries
      where id=(p_value->>'sourceEntryId')::uuid and package_id=pkg.id;
    if not found then raise exception 'FORBIDDEN'; end if;
    if source.reverses_entry_id is not null or exists(select 1 from public.package_credit_entries
      where reverses_entry_id=source.id) then
      raise exception 'INVALID_TRANSITION: This entry already has a linked correction.';
    end if;
    if operation='reverse' then
      if source.kind='purchase' and not exists(
        select 1 from jsonb_array_elements(credit_internal.checkout_credit_duplicates(p_student,pkg.id)) as d
        where d->>'entryId'=source.id::text
      ) then raise exception 'INVALID_TRANSITION: Verify the duplicate purchase before reversing its credits.'; end if;
      if source.lesson_id is not null or source.kind not in ('purchase','adjustment')
        or (source.quantity>0 and exists(select 1 from public.package_credit_entries e
          where e.package_id=pkg.id and e.id<>source.id and e.quantity<0 and e.created_at>=source.created_at)) then
        raise exception 'INVALID_TRANSITION: Reconcile subsequent debits before reversing this grant.';
      end if;
    else
      select l.id into lesson_to_restore from public.lessons l
        where l.id=source.lesson_id and l.status='completed'
          and (l.student_id=coalesce(source.covered_student_id,p_student) or exists(select 1 from public.lesson_participants lp
            where lp.lesson_id=l.id and lp.student_id=p_student and lp.status in ('reserved','confirmed')))
        for update;
      if lesson_to_restore is null or source.kind not in ('reservation','consumption') or source.quantity<>-1
        or (select sum(quantity) from public.package_credit_entries where package_id=pkg.id and lesson_id=source.lesson_id)<>-1
        or (select count(*) from public.package_credit_entries where package_id=pkg.id and lesson_id=source.lesson_id and quantity<0)<>1 then
        raise exception 'INVALID_TRANSITION: The lesson debit is ambiguous or already restored.';
      end if;
    end if;
    delta:=-source.quantity;
  else
    if jsonb_typeof(p_value->'quantity') is distinct from 'number' then raise exception 'VALIDATION_FAILED'; end if;
    requested:=(p_value->>'quantity')::integer;
    if requested not between (case when operation='set' then 0 else 1 end) and 100000 then
      raise exception 'VALIDATION_FAILED';
    end if;
    delta:=case operation when 'add' then requested when 'remove' then -requested
      else requested-(before_lot->>'unused')::integer end;
  end if;
  if delta=0 then raise exception 'VALIDATION_FAILED: The proposed balance is unchanged.'; end if;
  if delta<0 and (before_lot->>'available')::integer+delta<0 then
    raise exception 'CREDIT_UNAVAILABLE: Resolve reserved lesson credits before reducing this package.';
  end if;
  if operation<>'restore' and (before_lot->'issues') ?| array[
    'negative_ledger','missing_issuance','orphaned_debit','cancelled_lesson_debit',
    'duplicate_lesson_debit','expired_reservation','conflicting_package_allocations'] then
    raise exception 'INVALID_TRANSITION: Reconcile the package ledger before changing the balance.';
  end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,idempotency_key,created_by,reverses_entry_id,covered_student_id)
    values(pkg.id,lesson_to_restore,
      case when operation='restore' then 'release'::public.credit_entry_kind else 'adjustment'::public.credit_entry_kind end,
      delta,explanation,'package-correction:'||p_key,p_actor,source.id,case when operation='restore' then source.covered_student_id end)
    returning id into inserted;
  return jsonb_build_object('entryId',inserted,'sourceEntryId',source.id,'before',before_lot,
    'after',credit_internal.package_credit_review(p_student,pkg.id));
end $$;

-- Reuse provider settlement and add a same-intent guard across session IDs.
create or replace function public.process_stripe_checkout(event_id text,event_type text,event_payload jsonb,session_id text,student_id uuid,package_id uuid,amount_minor bigint,currency text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare coverage jsonb; pkg public.packages; payment_id uuid; duplicate boolean:=false; prior_status text;
  intent text:=event_payload #>> '{data,object,payment_intent}';
begin
  perform 1 from public.students where id=student_id and deleted_at is null for update;
  if not found then raise exception 'STUDENT_NOT_FOUND'; end if;
  perform credit_internal.lock_upcoming(student_id);
  select status into prior_status from public.webhook_events where id=event_id for update;
  if prior_status='processed' then return jsonb_build_object('duplicate',true,'eventId',event_id); end if;
  insert into public.webhook_events(id,provider,event_type,payload,status) values(event_id,'stripe',event_type,event_payload,'processing')
  on conflict(id) do update set event_type=excluded.event_type,payload=excluded.payload,status='processing',error=null,processed_at=null;
  select * into pkg from public.packages where id=package_id and packages.student_id=process_stripe_checkout.student_id for update;
  if pkg.id is null then update public.webhook_events set status='failed',error='Package not found',processed_at=now() where id=event_id; raise exception 'PACKAGE_NOT_FOUND'; end if;
  if intent ~ '^pi_[A-Za-z0-9_]+$' and event_payload #>> '{data,object,id}'=session_id then
    perform pg_advisory_xact_lock(hashtextextended('stripe-package-intent:'||intent,0));
    if exists(select 1 from public.webhook_events w join public.package_credit_entries e
      on e.idempotency_key='stripe-credit:'||(w.payload #>> '{data,object,id}')
      where w.provider='stripe' and w.status='processed'
        and w.payload #>> '{data,object,payment_intent}'=intent
        and w.payload #>> '{data,object,id}'<>session_id and e.kind='purchase' and e.quantity>0) then
      update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
      return jsonb_build_object('duplicate',true,'eventId',event_id,'duplicateEvidence','stripe_payment_intent');
    end if;
  end if;
  insert into public.payment_entries(student_id,package_id,kind,amount_minor,currency,external_reference,reason)
  values(student_id,package_id,'payment',amount_minor,upper(currency),session_id,'Stripe Checkout payment')
  on conflict(external_reference) do nothing returning id into payment_id;
  if payment_id is not null then
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key)
    values(package_id,'purchase',pkg.credit_quantity,'Stripe Checkout purchase','stripe-credit:'||session_id) on conflict(idempotency_key) do nothing;
  else duplicate:=true; end if;
  coverage:=credit_internal.request_coverage(student_id);
  update public.webhook_events set status='processed',processed_at=now(),error=null where id=event_id;
  return jsonb_build_object('creditCoverage',coverage,'duplicate',duplicate,'eventId',event_id,'paymentId',payment_id);
exception when others then update public.webhook_events set status='failed',error=sqlerrm,processed_at=now() where id=event_id; raise;
end $$;

-- A public booking preflight is advisory. The existing booking transaction
-- still calls the locked reservation for every occurrence.
create function public.wave3_booking_credit_check(
  p_actor uuid,p_student uuid,p_service uuid,p_starts timestamptz[],p_offering uuid
) returns text language plpgsql stable security definer set search_path='' as $$
declare svc public.booking_services; starts_at timestamptz; n integer; has_shared boolean;
begin
  if not training_internal.is_lesson_payer(p_actor,p_student) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if coalesce(cardinality(p_starts),0) not between 1 and 50
    or exists(select 1 from unnest(p_starts) x where x is null) then
    raise exception 'VALIDATION_FAILED';
  end if;
  select b.* into svc from public.booking_services b join public.students s on s.studio_id=b.studio_id
    where s.id=p_student and b.id=p_service;
  if svc.id is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select max(t) into starts_at from unnest(p_starts) t;
  select count(*),bool_or(shared) into n,has_shared from (
    select p.id, exists(select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id) shared
    from public.packages p
    where credit_internal.package_covers_student(p.id,p.student_id,p_student)
      and (p.expires_at is null or p.expires_at>greatest(now(),starts_at))
      and public.package_credit_balance(p.id)>=cardinality(p_starts)
      and credit_internal.package_matches_issued_terms(p.id,svc.id,make_interval(mins=>svc.duration_minutes)) is not false
  ) matches where not shared or p_offering is null;
  if n>1 and has_shared then return 'review'; end if;
  return case when n>0 then 'eligible' else 'unavailable' end;
end $$;
revoke all on function public.wave3_booking_credit_check(uuid,uuid,uuid,timestamptz[],uuid) from public,anon,authenticated;
grant execute on function public.wave3_booking_credit_check(uuid,uuid,uuid,timestamptz[],uuid) to service_role;
