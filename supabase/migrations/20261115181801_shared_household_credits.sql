-- Household ownership is explicit and independent of guardian/contact links.
create table credit_internal.credit_households (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id),
  name text not null check (char_length(trim(name)) between 1 and 120)
);
create table credit_internal.credit_household_members (
  household_id uuid not null references credit_internal.credit_households(id),
  student_id uuid not null unique references public.students(id),
  primary key (household_id,student_id)
);
alter table public.packages alter column student_id drop not null,
  add column household_id uuid references credit_internal.credit_households(id),
  add column transferred_from_package_id uuid references public.packages(id),
  add constraint credit_package_owner check (num_nonnulls(student_id,household_id)=1),
  add constraint credit_package_transfer_source check (transferred_from_package_id is distinct from id);
create unique index credit_package_household_key on public.packages(id,household_id);
create index credit_package_household_idx on public.packages(household_id) where household_id is not null;
create table credit_internal.credit_pool_members (
  package_id uuid not null,
  household_id uuid not null,
  student_id uuid not null,
  primary key (package_id,student_id),
  foreign key (package_id,household_id) references public.packages(id,household_id),
  foreign key (household_id,student_id) references credit_internal.credit_household_members(household_id,student_id)
);
create index credit_pool_member_student_idx on credit_internal.credit_pool_members(student_id,package_id);
alter table credit_internal.credit_households enable row level security;
alter table credit_internal.credit_household_members enable row level security;
alter table credit_internal.credit_pool_members enable row level security;
revoke all on credit_internal.credit_households,credit_internal.credit_household_members,credit_internal.credit_pool_members
  from public,anon,authenticated,service_role;

alter table public.package_definitions
  add column allow_household_credits boolean not null default false,
  add column allow_credit_transfer boolean not null default false;
alter table credit_internal.package_credit_terms
  alter column original_student_id drop not null,
  add column original_household_id uuid references credit_internal.credit_households(id),
  add column allow_household_credits boolean not null default false,
  add column allow_credit_transfer boolean not null default false,
  add constraint credit_terms_owner check (num_nonnulls(original_student_id,original_household_id)=1);

alter table public.package_credit_entries
  add column used_by_student_id uuid references public.students(id),
  add column settles_entry_id uuid unique references public.package_credit_entries(id);
create index credit_shared_usage_idx on public.package_credit_entries(package_id,lesson_id,used_by_student_id)
  where used_by_student_id is not null;

create or replace function credit_internal.capture_package_credit_terms()
returns trigger language plpgsql security definer set search_path='' as $$
declare definition public.package_definitions; original credit_internal.package_credit_terms; studio uuid;
begin
  studio:=coalesce((select studio_id from public.students where id=new.student_id),
    (select studio_id from credit_internal.credit_households where id=new.household_id));
  if new.transferred_from_package_id is not null then
    select * into strict original from credit_internal.package_credit_terms where package_id=new.transferred_from_package_id;
    insert into credit_internal.package_credit_terms(package_id,original_student_id,original_household_id,
      original_definition_id,original_name,original_expires_at,service_ids,duration_minutes,
      issuance_entry_id,allow_household_credits,allow_credit_transfer)
    values(new.id,original.original_student_id,original.original_household_id,original.original_definition_id,
      original.original_name,original.original_expires_at,original.service_ids,original.duration_minutes,
      original.issuance_entry_id,original.allow_household_credits,original.allow_credit_transfer);
    return new;
  end if;
  select d.* into definition from public.package_definitions d
    where d.id=new.definition_id and d.studio_id=studio;
  if new.household_id is not null and (not coalesce(definition.allow_household_credits,false)
      or cardinality(definition.eligible_service_ids)=0) then
    raise exception 'INVALID_TRANSITION: This package has no approved shared credit terms.';
  end if;
  insert into credit_internal.package_credit_terms(package_id,original_student_id,original_household_id,
    original_definition_id,original_name,original_expires_at,service_ids,duration_minutes,
    allow_household_credits,allow_credit_transfer)
  values(new.id,new.student_id,new.household_id,new.definition_id,new.name,new.expires_at,
    coalesce(definition.eligible_service_ids,'{}'),definition.session_duration_minutes,
    coalesce(definition.allow_household_credits,false),coalesce(definition.allow_credit_transfer,false));
  return new;
end $$;

create or replace function credit_internal.package_terms_match(
  p_package uuid,p_studio uuid,p_service uuid,p_duration interval
) returns boolean language sql stable set search_path='' as $$
  select case
    when t.package_id is not null and t.original_definition_id is not null then
      coalesce(p_service=any(t.service_ids) and p_duration=make_interval(mins=>t.duration_minutes),false)
    when p.household_id is not null then false
    when t.package_id is not null or p.definition_id is null then null
    else coalesce(p_service=any(d.eligible_service_ids) and
      p_duration=make_interval(mins=>d.session_duration_minutes),false)
  end
  from public.packages p
  left join public.students s on s.id=p.student_id
  left join credit_internal.credit_households h on h.id=p.household_id
  left join credit_internal.package_credit_terms t on t.package_id=p.id
  left join public.package_definitions d on d.id=p.definition_id and d.studio_id=p_studio
  where p.id=p_package and coalesce(s.studio_id,h.studio_id)=p_studio
$$;

create function credit_internal.student_may_spend_pool(p_package uuid,p_student uuid)
returns boolean language sql stable set search_path='' as $$
  select exists(select 1 from public.packages p join public.students s on s.id=p_student and s.deleted_at is null
    where p.id=p_package and (p.student_id=p_student or exists(
      select 1 from credit_internal.credit_pool_members m join credit_internal.credit_households h
      on h.id=m.household_id and h.studio_id=s.studio_id
      where m.package_id=p.id and m.student_id=p_student)))
$$;

create or replace function credit_internal.available_lesson_package(
  p_student uuid,p_studio uuid,p_service uuid,p_duration interval,p_start timestamptz,
  p_allocated jsonb,p_package uuid,p_automatic boolean
) returns uuid language sql stable set search_path='' as $$
  select p.id
  from (select id from public.packages where student_id=p_student union all
        select package_id from credit_internal.credit_pool_members where student_id=p_student) eligible
  join public.packages p on p.id=eligible.id
  where (p_package is null or p.id=p_package)
    and credit_internal.student_may_spend_pool(p.id,p_student)
    and (not p_automatic or p.auto_apply)
    and credit_internal.package_terms_match(p.id,p_studio,p_service,p_duration) is not false
    and (p.expires_at is null or p.expires_at>greatest(now(),p_start))
    and public.package_credit_balance(p.id)>coalesce((p_allocated->>p.id::text)::integer,0)
  order by p.expires_at nulls last,p.household_id is not null,p.created_at,p.id limit 1
$$;

create function credit_internal.guard_household_credit_entry()
returns trigger language plpgsql security definer set search_path='' as $$
declare pkg public.packages; lesson public.lessons; net integer;
begin
  select * into pkg from public.packages where id=new.package_id;
  if pkg.household_id is null then return new; end if;
  select * into pkg from public.packages where id=new.package_id for update;
  if new.lesson_id is null then
    if new.used_by_student_id is not null then raise exception 'VALIDATION_FAILED'; end if;
    if new.quantity<0 and public.package_credit_balance(pkg.id)<-new.quantity then
      raise exception 'CREDIT_UNAVAILABLE';
    end if;
    return new;
  end if;
  if new.used_by_student_id is null then raise exception 'VALIDATION_FAILED: Shared credit usage requires a student.'; end if;
  select * into lesson from public.lessons where id=new.lesson_id;
  select coalesce(sum(quantity),0)::integer into net from public.package_credit_entries
    where package_id=pkg.id and lesson_id=new.lesson_id and used_by_student_id=new.used_by_student_id;
  if new.settles_entry_id is not null then
    if new.kind<>'consumption' or new.quantity<>-1 or net<>0 or not exists (
      select 1 from public.package_credit_entries e
      join public.package_credit_entries r on r.idempotency_key='shared-settlement:'||e.id::text
      where e.id=new.settles_entry_id and e.package_id=pkg.id and e.lesson_id=new.lesson_id
        and e.used_by_student_id=new.used_by_student_id and e.kind='reservation' and e.quantity=-1
    ) then raise exception 'INVALID_TRANSITION: Shared settlement requires its original reservation.'; end if;
    return new;
  end if;
  if new.quantity<0 then
    if new.quantity<>-1 or net<>0 or not credit_internal.student_may_spend_pool(pkg.id,new.used_by_student_id)
      or (lesson.student_id is distinct from new.used_by_student_id and not exists(
        select 1 from public.lesson_participants lp where lp.lesson_id=lesson.id
          and lp.student_id=new.used_by_student_id and lp.status in ('reserved','confirmed')))
      or credit_internal.package_lesson_matches(pkg.id,lesson.id) is distinct from true
      or pkg.expires_at<=greatest(now(),lesson.starts_at) or public.package_credit_balance(pkg.id)<1 then
      raise exception 'CREDIT_UNAVAILABLE';
    end if;
  elsif new.kind<>'release' or new.quantity<>-net then
    raise exception 'INVALID_TRANSITION: Review the shared credit reservation before releasing it.';
  end if;
  return new;
end $$;
create trigger guard_household_credit_entry before insert on public.package_credit_entries
  for each row execute function credit_internal.guard_household_credit_entry();

revoke all on function credit_internal.student_may_spend_pool(uuid,uuid),
  credit_internal.guard_household_credit_entry() from public,anon,authenticated;



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
      where e.lesson_id = l.id and coalesce(e.used_by_student_id,p.student_id) = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

  -- A date correction preserves accounting. Only an explicit manual credit
  -- command may allocate coverage to a corrected record afterward.
  if p_mode<>'manual' and exists(select 1 from lesson_ops.datetime_corrections c where c.lesson_id=l.id) then
    return jsonb_build_object('state','review_required','reasonCode','reconciliation_required','eligible',false,'existingReservation',reservation_count>0);
  end if;
  if l.status <> 'scheduled' and not (p_mode = 'manual' and l.status = 'completed') then
    reason := 'lesson_ineligible';
  elsif exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
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
    if credit_internal.package_lesson_matches(pkg.id,l.id) is false then
      return jsonb_build_object('state','review_required','reasonCode','reconciliation_required',
        'eligible',false,'existingReservation',true,'packageId',pkg.id,'expiresAt',pkg.expires_at);
    end if;
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
    where coalesce(e.used_by_student_id,p.student_id)=p_student and e.lesson_id=l.id group by e.lesson_id having sum(e.quantity)>0) then
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
        select p.* into pkg from public.packages p where p.id=credit_internal.available_lesson_package(
          p_student,l.studio_id,l.service_id,l.ends_at-l.starts_at,l.starts_at,p_allocated,p_package,
          p_mode='automatic' and enabled is distinct from true);
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student) and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and credit_internal.package_lesson_matches(p.id,l.id) is not false
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id=p_student
          and (p_package is null or p.id=p_package)
          and (p.expires_at is null or p.expires_at>greatest(now(),l.starts_at))
          and public.package_credit_balance(p.id)>0
          and credit_internal.package_lesson_matches(p.id,l.id) is false) then
          reason := 'reconciliation_required'; state := 'review_required';
        elsif exists(select 1 from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student)
          and (p_package is null or p.id = p_package)
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
  -- The common sorted order serializes contenders from different students.
  perform p.id from public.packages p where credit_internal.student_may_spend_pool(p.id,p_student)
    and (p_package_id is null or p.id=p_package_id)
    order by p.id for update;
  decision := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
    case when p_manual then 'manual' else 'automatic' end, '{}'::jsonb, p_package_id);
  credit_package := (decision->>'packageId')::uuid;
  if coalesce((decision->>'existingReservation')::boolean, false) then return credit_package; end if;
  if not (decision->>'eligible')::boolean then return null; end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason,used_by_student_id)
    select credit_package,l.id,case when l.status='completed' then 'consumption'::public.credit_entry_kind
      else 'reservation'::public.credit_entry_kind end,-1,p_reason,
      case when p.household_id is not null then p_student end
    from public.packages p where p.id=credit_package;
  update public.bookings b set payment_policy = 'credits',payment_status = 'paid',version = b.version+1,updated_at = now()
    where b.student_id = p_student and b.paid_minor = 0
      and b.id in(select booking_id from public.lesson_participants where lesson_id = l.id and student_id = p_student);
  update public.lessons set package_id = credit_package,
    payment_status = 'paid_by_credit',version = version+1,updated_at = now() where id = l.id and student_id = p_student;
  perform public.sync_invoice_lesson_credit(l.id,p_student);
  return credit_package;
end;
$$;

-- Convert a held unit into a consumed unit without changing the lot balance.
-- Cancellation can settle one participant of a group lesson independently.
create function credit_internal.settle_shared_credit(p_lesson uuid,p_use boolean,p_student uuid)
returns void language plpgsql security definer set search_path='' as $$
declare hold record;
begin
  perform p.id from public.packages p
    where p.household_id is not null and exists(select 1 from public.package_credit_entries e
      where e.package_id=p.id and e.lesson_id=p_lesson
        and (p_student is null or e.used_by_student_id=p_student))
    order by p.id for update;
  for hold in
    select distinct on (e.package_id,e.used_by_student_id) e.*
    from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where p.household_id is not null and e.lesson_id=p_lesson and e.kind='reservation'
      and (p_student is null or e.used_by_student_id=p_student)
      and not exists(select 1 from public.package_credit_entries c where c.settles_entry_id=e.id)
      and (select sum(x.quantity) from public.package_credit_entries x where x.lesson_id=e.lesson_id
        and x.package_id=e.package_id and x.used_by_student_id=e.used_by_student_id)<0
    order by e.package_id,e.used_by_student_id,e.created_at desc,e.id desc
  loop
    insert into public.package_credit_entries(package_id,lesson_id,used_by_student_id,kind,quantity,reason,idempotency_key)
      values(hold.package_id,p_lesson,hold.used_by_student_id,'release',1,
        case when p_use then 'Shared reservation settled' else 'Shared credit returned after cancellation' end,
        (case when p_use then 'shared-settlement:' else 'shared-cancellation:' end)||hold.id::text);
    if p_use then
      insert into public.package_credit_entries(package_id,lesson_id,used_by_student_id,kind,quantity,reason,settles_entry_id)
        values(hold.package_id,p_lesson,hold.used_by_student_id,'consumption',-1,'Shared credit used',hold.id);
    end if;
  end loop;
end $$;

create function credit_internal.complete_shared_credit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform credit_internal.settle_shared_credit(new.id,true,null);
  return new;
end $$;
create trigger complete_shared_credit after update of status on public.lessons
  for each row when (old.status='scheduled' and new.status='completed')
  execute function credit_internal.complete_shared_credit();

revoke all on function credit_internal.settle_shared_credit(uuid,boolean,uuid),
  credit_internal.complete_shared_credit() from public,anon,authenticated;

create function credit_internal.shared_pool_usage(p_package uuid)
returns table (student_id uuid, lesson_id uuid, reserved integer, consumed integer)
language sql stable set search_path='' as $$
  select e.used_by_student_id,e.lesson_id,
    case when l.status='scheduled' and not bool_or(e.kind='consumption')
      then greatest(0,-sum(e.quantity))::integer else 0 end,
    case when bool_or(e.kind='consumption') then greatest(0,-sum(e.quantity))::integer else 0 end
  from public.package_credit_entries e join public.lessons l on l.id=e.lesson_id
  where e.package_id=p_package and e.used_by_student_id is not null
  group by e.used_by_student_id,e.lesson_id,l.status having sum(e.quantity)<0
$$;

create function credit_internal.shared_pool_projection(p_package uuid,p_authorized_students uuid[],p_staff boolean)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p.id,'name',p.name,'householdId',h.id,'householdName',h.name,
    'durationMinutes',t.duration_minutes,'expiresAt',p.expires_at,'services',
      coalesce((select jsonb_agg(s.name order by s.name,s.id) from public.booking_services s where s.id=any(t.service_ids)),'[]'),
    'available',case when p.expires_at<=now() then 0 else public.package_credit_balance(p.id) end,
    'reserved',case when p.expires_at<=now() then 0 else u.reserved end,'unused',case when p.expires_at<=now() then 0
      else public.package_credit_balance(p.id)+u.reserved end,'consumed',u.consumed,
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name) order by s.full_name,s.id),'[]')
       from credit_internal.credit_pool_members m join public.students s on s.id=m.student_id
       where m.package_id=p.id and (p_staff or s.id=any(p_authorized_students))),
    'usage', coalesce((select jsonb_agg(x order by x->>'startsAt',x->>'lessonId') from (
      select jsonb_build_object('studentId',s.id,'studentName',s.full_name,'lessonId',l.id,
        'topic',l.topic,'startsAt',l.starts_at,'reserved',v.reserved,'consumed',v.consumed) x
      from credit_internal.shared_pool_usage(p.id) v join public.lessons l on l.id=v.lesson_id
      join public.students s on s.id=v.student_id
      where p_staff or (s.id=any(p_authorized_students) and public.can_view_student_schedule(s.id))
      order by l.starts_at desc,l.id desc limit 30
    ) visible),'[]'))
  from public.packages p join credit_internal.credit_households h on h.id=p.household_id
  join credit_internal.package_credit_terms t on t.package_id=p.id
  cross join lateral (select coalesce(sum(reserved),0) reserved,coalesce(sum(consumed),0) consumed
    from credit_internal.shared_pool_usage(p.id)) u
  where p.id=p_package
$$;

revoke all on function credit_internal.shared_pool_usage(uuid),
  credit_internal.shared_pool_projection(uuid,uuid[],boolean) from public,anon,authenticated;



create or replace function public.settle_lesson_credits(p_lesson uuid,p_use boolean,p_student uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare lot record; restored uuid; quantity integer;
begin
  if p_use then
    perform credit_internal.settle_shared_credit(p_lesson,true,p_student);
    return;
  end if;
  perform 1 from public.students where id in(select p.student_id from public.packages p join public.package_credit_entries e on e.package_id=p.id where e.lesson_id=p_lesson and (p_student is null or p.student_id=p_student)) order by id for update;
  perform p.id from public.packages p where exists(select 1 from public.package_credit_entries e
    where e.package_id=p.id and e.lesson_id=p_lesson
      and (p_student is null or coalesce(e.used_by_student_id,p.student_id)=p_student))
    order by p.id for update;
  for lot in select p.id,p.student_id,p.expires_at from public.packages p
    where p.household_id is null and (p_student is null or p.student_id=p_student) and exists(select 1 from public.package_credit_entries e where e.lesson_id=p_lesson and e.package_id=p.id)
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
  perform credit_internal.settle_shared_credit(p_lesson,false,p_student);
end $$;

create function credit_internal.household_credit_access(p_student uuid,p_action text,p_value jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); studio uuid; household uuid; selected_students uuid[];
  member uuid; source public.packages; terms credit_internal.package_credit_terms;
  definition public.package_definitions; result jsonb; action_preview jsonb;
  pool uuid; reason_text text:=trim(p_value->>'reason'); request_key text:=p_value->>'key';
  prior credit_internal.credit_command_receipts; qty integer; remaining integer;
  has_target boolean; can_apply boolean; audit_id uuid; source_entry uuid; destination_entry uuid;
begin
  if p_action='portal' then
    select array_agg(distinct x::uuid) into selected_students
      from jsonb_array_elements_text(coalesce(p_value->'studentIds',jsonb_build_array(p_student))) x;
    if coalesce(cardinality(selected_students),0) not between 1 and 50 then
      raise exception 'VALIDATION_FAILED';
    end if;
    foreach member in array selected_students loop
      perform credit_internal.require_student_finance(member);
    end loop;
    return coalesce((select jsonb_agg(credit_internal.shared_pool_projection(p.id,selected_students,false)
      order by p.household_id,p.created_at,p.id)
      from public.packages p where p.household_id is not null and exists(
        select 1 from credit_internal.credit_pool_members m where m.package_id=p.id and m.student_id=any(selected_students))
    ),'[]');
  end if;

  select studio_id into studio from public.students where id=p_student and deleted_at is null;
  if studio is null or actor is null or not public.is_studio_coach(studio) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_action='coach' then
    return jsonb_build_object('households',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'name',h.name,'members',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.full_name) order by s.full_name,s.id),'[]')
        from credit_internal.credit_household_members m join public.students s on s.id=m.student_id
        where m.household_id=h.id and s.deleted_at is null),
      'pools',(select coalesce(jsonb_agg(credit_internal.shared_pool_projection(p.id,'{}',true)
        order by p.created_at,p.id),'[]') from public.packages p where p.household_id=h.id)
    ) order by h.name,h.id) from credit_internal.credit_households h where h.studio_id=studio),'[]'),
      'students',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.full_name)
        order by s.full_name,s.id),'[]') from public.students s where s.studio_id=studio and s.deleted_at is null),
      'definitions',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,
        'shared',d.allow_household_credits,'transfer',d.allow_credit_transfer)
        order by d.name,d.id),'[]') from public.package_definitions d where d.studio_id=studio and d.active),
      'transferLots',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,
        'studentId',p.student_id,'householdId',p.household_id)
        order by p.name,p.id),'[]') from public.packages p
        join credit_internal.package_credit_terms t on t.package_id=p.id and t.allow_credit_transfer
        where exists(select 1 from public.students s where s.id=p.student_id and s.studio_id=studio and s.deleted_at is null)
          or exists(select 1 from credit_internal.credit_households h
          where h.id=p.household_id and h.studio_id=studio)));
  end if;
  if p_action not in ('membership_preview','transfer_preview') then
    if reason_text is null or char_length(reason_text) not between 3 and 500
      or request_key is null or char_length(request_key) not between 8 and 120 then
      raise exception 'VALIDATION_FAILED: Enter a reason and confirm the change.';
    end if;
    -- All writes use the existing receipt table. Lock replay attempts before
    -- looking up the receipt so a retry in a different session sees the result.
    request_key:='household-credit:'||request_key;
    perform pg_advisory_xact_lock(hashtextextended(request_key,0));
    select * into prior from credit_internal.credit_command_receipts where key=request_key;
    if found then
      if prior.student_id<>p_student or prior.actor_id is distinct from actor
         or prior.request is distinct from jsonb_build_object('action',p_action,'value',p_value) then
        raise exception 'IDEMPOTENCY_CONFLICT';
      end if;
      return prior.response;
    end if;
  end if;

  household:=(p_value->>'householdId')::uuid;
  if household is not null and not exists(select 1 from credit_internal.credit_households h
      where h.id=household and h.studio_id=studio) then raise exception 'FORBIDDEN'; end if;
  member:=(p_value->>'studentId')::uuid;
  if member is not null and not exists(select 1 from public.students s
      where s.id=member and s.studio_id=studio and s.deleted_at is null) then raise exception 'FORBIDDEN'; end if;

  if p_action='create_household' then
    select array_agg(distinct x::uuid) into selected_students
      from jsonb_array_elements_text(p_value->'members') x;
    if coalesce(cardinality(selected_students),0) not between 1 and 50 then raise exception 'VALIDATION_FAILED'; end if;
    perform s.id from public.students s where s.id=any(selected_students) order by s.id for update;
    if exists(select 1 from unnest(selected_students) x where not exists(
      select 1 from public.students s where s.id=x and s.studio_id=studio and s.deleted_at is null
    )) or exists(select 1 from credit_internal.credit_household_members m where m.student_id=any(selected_students))
    then raise exception 'INVALID_TRANSITION: Each student must be active and belong to only one credit household.'; end if;
    insert into credit_internal.credit_households(studio_id,name) values(studio,trim(p_value->>'name')) returning id into household;
    insert into credit_internal.credit_household_members(household_id,student_id)
      select household,x from unnest(selected_students) x;
    result:=jsonb_build_object('status','completed','householdId',household);
  elsif p_action='configure_definition' then
    update public.package_definitions set allow_household_credits=(p_value->>'shared')::boolean,
      allow_credit_transfer=(p_value->>'transfer')::boolean,version=version+1,updated_at=now()
      where id=(p_value->>'definitionId')::uuid and studio_id=studio
        and cardinality(eligible_service_ids)>0 returning * into definition;
    if not found then raise exception 'INVALID_TRANSITION: Choose a studio package with explicit lesson eligibility.'; end if;
    result:=jsonb_build_object('status','completed','definitionId',definition.id);
  elsif p_action='issue' then
    select * into definition from public.package_definitions where id=(p_value->>'definitionId')::uuid
      and studio_id=studio and active and allow_household_credits for share;
    if not found or household is null then raise exception 'INVALID_TRANSITION: Choose a package with approved shared credit terms.'; end if;
    insert into public.packages(household_id,definition_id,name,credit_quantity,expires_at,auto_apply)
      values(household,definition.id,definition.name,definition.session_count,
        now()+make_interval(days=>definition.expiration_days),true) returning id into pool;
    insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key,created_by)
      values(pool,'adjustment',definition.session_count,reason_text,request_key,actor);
    result:=jsonb_build_object('status','completed','packageId',pool,'householdId',household);
  elsif p_action in ('membership_preview','membership_apply','transfer_preview','transfer_apply') then
    -- Student locks precede package locks, as in the booking reservation flow.
    if p_action in ('transfer_preview','transfer_apply') then
      perform s.id from public.students s where s.id=member or s.id=(
        select p.student_id from public.packages p where p.id=(p_value->>'packageId')::uuid
      ) order by s.id for update;
    end if;
    select p.* into source from public.packages p where p.id=(p_value->>'packageId')::uuid
      and (exists(select 1 from public.students s where s.id=p.student_id and s.studio_id=studio and s.deleted_at is null)
        or exists(select 1 from credit_internal.credit_households h where h.id=p.household_id and h.studio_id=studio))
      for update;
    if source.id is null then raise exception 'FORBIDDEN'; end if;
    pool:=source.id;
    if p_action in ('membership_preview','membership_apply') then
      if source.household_id is null or member is null or not exists(
        select 1 from credit_internal.credit_household_members m where m.household_id=source.household_id and m.student_id=member
      ) or jsonb_typeof(p_value->'eligible') is distinct from 'boolean' then raise exception 'FORBIDDEN'; end if;
      has_target:=exists(select 1 from credit_internal.credit_pool_members m where m.package_id=source.id and m.student_id=member);
      action_preview:=jsonb_build_object('packageId',pool,'studentId',member,'eligibleBefore',has_target,
        'eligibleAfter',p_value->'eligible','conflicts',coalesce((
          select jsonb_agg(jsonb_build_object('id',l.id,'topic',l.topic,'startsAt',l.starts_at) order by l.starts_at,l.id)
          from credit_internal.shared_pool_usage(pool) u join public.lessons l on l.id=u.lesson_id
          where u.student_id=member and u.reserved>0 and p_value->'eligible'='false'::jsonb
        ),'[]'));
      can_apply:=jsonb_array_length(action_preview->'conflicts')=0 and has_target<>(p_value->>'eligible')::boolean;
      if p_action='membership_preview' then
        return action_preview||jsonb_build_object('canApply',can_apply,'status','preview');
      end if;
      if p_value->'preview' is distinct from action_preview then
        return action_preview||jsonb_build_object('canApply',can_apply,'status','stale');
      end if;
      if not can_apply then return action_preview||jsonb_build_object('canApply',false,'status','unapplied'); end if;
      if (p_value->>'eligible')::boolean then
        insert into credit_internal.credit_pool_members(package_id,household_id,student_id)
          values(pool,source.household_id,member);
        -- Queue the existing allocator. It continues to honor student policy.
        perform credit_internal.enqueue_coverage(member);
      else
        delete from credit_internal.credit_pool_members m where m.package_id=pool and m.student_id=member;
      end if;
      result:=action_preview||jsonb_build_object('status','completed');
    else
      select * into terms from credit_internal.package_credit_terms where package_id=pool;
      qty:=(p_value->>'quantity')::integer;
      if qty is null or qty not between 1 and 100000 or num_nonnulls(household,member)<>1 then
        raise exception 'VALIDATION_FAILED';
      end if;
      -- Transfers stay inside explicit households. An unrelated recipient
      -- cannot gain access based on a contact match or studio membership.
      has_target:=exists(select 1 from credit_internal.credit_household_members sm
        where (sm.student_id=source.student_id or (source.household_id is not null and sm.household_id=source.household_id))
          and (sm.household_id=household or exists(select 1 from credit_internal.credit_household_members dm
             where dm.household_id=sm.household_id and dm.student_id=member)));
      remaining:=public.package_credit_balance(pool);
      can_apply:=coalesce(terms.allow_credit_transfer and terms.issuance_entry_id is not null
        and terms.duration_minutes is not null and cardinality(terms.service_ids)>0
        and (household is null or terms.allow_household_credits)
        and (source.expires_at is null or source.expires_at>now())
        and has_target and qty<=remaining
        and (member is null or member is distinct from source.student_id)
        and (household is null or household is distinct from source.household_id),false);
      action_preview:=jsonb_build_object('packageId',pool,'studentId',member,'householdId',household,
        'packageName',source.name,'expiresAt',source.expires_at,'durationMinutes',terms.duration_minutes,
        'sourceAvailable',remaining,'sourceAfter',remaining-qty,'quantity',qty,
        'destinationAfter',qty,'sourceReserved',coalesce((select sum(v.reserved) from credit_internal.shared_pool_usage(pool) v),
          (select sum(g.qty) from (select greatest(0,-sum(e.quantity)) qty from public.package_credit_entries e
            join public.lessons l on l.id=e.lesson_id and l.status='scheduled' where e.package_id=pool
            group by e.lesson_id) g),0));
      if p_action='transfer_preview' then
        return action_preview||jsonb_build_object('canApply',can_apply,'status','preview');
      end if;
      if p_value->'preview' is distinct from action_preview then
        return action_preview||jsonb_build_object('canApply',can_apply,'status','stale');
      end if;
      if not can_apply then return action_preview||jsonb_build_object('canApply',false,'status','unapplied'); end if;
      insert into public.packages(student_id,household_id,transferred_from_package_id,definition_id,
        name,credit_quantity,expires_at,auto_apply)
        values(member,household,pool,source.definition_id,source.name,qty,source.expires_at,source.auto_apply)
        returning id into pool;
      insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key,created_by)
        values(source.id,'adjustment',-qty,reason_text,request_key||':out',actor) returning id into source_entry;
      insert into public.package_credit_entries(package_id,kind,quantity,reason,idempotency_key,created_by)
        values(pool,'adjustment',qty,reason_text,request_key||':in',actor) returning id into destination_entry;
      if member is not null then
        perform credit_internal.enqueue_coverage(member);
      end if;
      result:=action_preview||jsonb_build_object('status','completed','destinationPackageId',pool,
        'sourceEntryId',source_entry,'destinationEntryId',destination_entry);
    end if;
  else raise exception 'VALIDATION_FAILED'; end if;

  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,
    correlation_id,source,before_state,after_state)
    values(studio,actor,'credits.household.'||p_action,'credit_household',
      coalesce(pool,household,definition.id),reason_text,request_key,'coach_portal',action_preview,result)
    returning id into audit_id;
  result:=result||jsonb_build_object('auditEventId',audit_id);
  insert into credit_internal.credit_command_receipts(key,student_id,actor_id,request,response)
    values(request_key,p_student,actor,jsonb_build_object('action',p_action,'value',p_value),result);
  return result;
end $$;

revoke all on function credit_internal.household_credit_access(uuid,text,jsonb) from public,anon;
grant execute on function credit_internal.household_credit_access(uuid,text,jsonb) to authenticated;
create function public.household_credit_access(p_student uuid,p_action text,p_value jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select credit_internal.household_credit_access(p_student,p_action,p_value)
$$;
revoke all on function public.household_credit_access(uuid,text,jsonb) from public,anon;
grant execute on function public.household_credit_access(uuid,text,jsonb) to authenticated;



create or replace function credit_internal.apply_upcoming(p_student uuid,p_manual boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  l record; evaluation jsonb; pkg uuid; before_entries bigint; inserted integer;
  applied integer:=0; covered integer:=0; skipped integer:=0; failed integer:=0;
  reasons jsonb:='{}'; errors jsonb:='{}'; code text; needs_review boolean;
begin
  perform 1 from public.students where id=p_student and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  needs_review:=(public.student_credit_summary(p_student)->>'needsReview')::boolean;
  -- Lock the complete relevant set in chronological order before taking lot locks.
  perform credit_internal.lock_upcoming(p_student);
  for l in select x.id from public.lessons x join public.students s on s.id=p_student and s.studio_id=x.studio_id
    where x.status='scheduled' and x.starts_at>=now() and
      (x.student_id=p_student or exists(select 1 from public.lesson_participants lp
        where lp.lesson_id=x.id and lp.student_id=p_student and lp.status in ('reserved','confirmed')))
    order by x.starts_at,x.id
  loop
    begin
      evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,l.id,
        case when p_manual then 'manual' else 'automatic' end,'{}',null,needs_review);
      if evaluation->>'state'='covered' then covered:=covered+1;
      elsif coalesce((evaluation->>'eligible')::boolean,false) then
        select count(*) into before_entries from public.package_credit_entries e
          join public.packages p on p.id=e.package_id where coalesce(e.used_by_student_id,p.student_id)=p_student and e.lesson_id=l.id and e.quantity<0;
        pkg:=public.reserve_student_lesson_credit(l.id,p_student,null,p_manual);
        select (count(*)-before_entries)::integer into inserted from public.package_credit_entries e
          join public.packages p on p.id=e.package_id where coalesce(e.used_by_student_id,p.student_id)=p_student and e.lesson_id=l.id and e.quantity<0;
        if inserted>0 then applied:=applied+inserted;
        elsif pkg is not null then covered:=covered+1;
        else
          evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,l.id,
            case when p_manual then 'manual' else 'automatic' end);
          code:=evaluation->>'reasonCode'; skipped:=skipped+1;
          reasons:=jsonb_set(reasons,array[code],to_jsonb(coalesce((reasons->>code)::integer,0)+1));
        end if;
      else
        code:=evaluation->>'reasonCode'; skipped:=skipped+1;
        reasons:=jsonb_set(reasons,array[code],to_jsonb(coalesce((reasons->>code)::integer,0)+1));
      end if;
    exception
      when serialization_failure or deadlock_detected then raise;
      when others then
        -- The failed lesson's ledger/invoice writes roll back together. Store codes only.
        failed:=failed+1;
        errors:=jsonb_set(errors,array[sqlstate],to_jsonb(coalesce((errors->>sqlstate)::integer,0)+1));
    end;
  end loop;
  return public.student_credit_summary(p_student)||jsonb_build_object(
    'applied',applied,'alreadyCovered',covered,'skipped',skipped,'failed',failed,
    'skipReasons',reasons,'failureCodes',errors,'autoApplyPending',failed>0);
end $$;

create or replace function public.sync_invoice_lesson_credit(p_lesson uuid,p_student uuid) returns void
language plpgsql security definer set search_path='' as $$
declare inv public.studio_invoices; item jsonb; new_items jsonb; credit bigint; amount bigint;
begin
  if not exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id where e.lesson_id=p_lesson and coalesce(e.used_by_student_id,p.student_id)=p_student group by e.package_id having sum(e.quantity)<0) then return; end if;
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

create or replace function public.credit_account_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  select p.student_id into sid from public.packages p where p.id=new.package_id;
  if sid is null then return new; end if;
  insert into public.student_credit_accounts(student_id,auto_apply) select sid,case when bool_and(auto_apply) then true when not bool_or(auto_apply) then false else null end from public.packages where student_id=sid on conflict(student_id) do nothing;
  update public.student_credit_accounts set version=version+1,updated_at=now() where student_id=sid;
  return new;
end $$;

create or replace function lesson_ops.assess_change(
  p_lesson uuid,p_action text,p_starts_at timestamptz default null,p_class boolean default false
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare l public.lessons; reason text; bookings jsonb; students uuid[]; credit_count bigint;
  credit_diagnostics jsonb:='{}'; evaluated_student uuid; diagnostic jsonb;
begin
  select * into l from public.lessons where id=p_lesson;
  if l.id is null then return jsonb_build_object('eligible',false,'reasonCode','lesson_unavailable'); end if;
  select coalesce(array_agg(distinct sid),'{}') into students from (
    select l.student_id sid union select student_id from public.lesson_participants
      where lesson_id=l.id and status in ('reserved','confirmed')) s where sid is not null;
  if p_action not in ('cancel','reschedule') then reason:='invalid_action';
  elsif l.status<>'scheduled' then reason:='lesson_not_scheduled';
  elsif exists(select 1 from unnest(students) sid where not exists(select 1 from public.students where id=sid and studio_id=l.studio_id)) then reason:='reconciliation_required';
  elsif exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
    where lp.lesson_id=l.id and lp.status in ('reserved','confirmed') and (b.studio_id<>l.studio_id or b.student_id is distinct from lp.student_id)) then reason:='booking_ownership_review_required';
  elsif (l.student_id is null or l.offering_id is not null or coalesce(l.capacity,1)>1
    or exists(select 1 from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed') and student_id is distinct from l.student_id)) and not p_class then reason:='class_scope_required';
  elsif l.invoice_payment_pending or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.checkout_key is not null and x->'lessonIds' @> to_jsonb(array[l.id::text]))
    or exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
      where lp.lesson_id=l.id and lp.status in ('reserved','confirmed') and b.payment_status='processing') then reason:='payment_pending';
  elsif p_action='cancel' and exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x
    where i.status not in ('draft','void') and x->'lessonIds' @> to_jsonb(array[l.id::text]) and jsonb_array_length(x->'lessonIds')>1
      and not coalesce((x->>'cancelled')::boolean,false)) then reason:='shared_invoice_review_required';
  elsif exists(select 1 from public.sync_conflicts where entity_type='lesson' and entity_id=l.id and status='open') then reason:='synchronization_review_required';
  elsif exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=l.id group by p.student_id having sum(e.quantity)<-1)
    or exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
      where lp.lesson_id=l.id and b.payment_policy='credits' and b.paid_minor>0)
    or (l.paid_minor>0 and exists(select 1 from public.package_credit_entries where lesson_id=l.id group by package_id having sum(quantity)<0)) then reason:='reconciliation_required';
  elsif p_action='cancel' and exists(select 1 from public.bookings b join public.lesson_participants lp on lp.booking_id=b.id
    where lp.lesson_id=l.id and lp.status in ('reserved','confirmed') and b.payment_policy<>'credits'
      and (b.paid_minor>0 or b.payment_status in ('paid','partially_paid','refunded','not_required') and b.total_minor>0)
      and exists(select 1 from public.lesson_participants other where other.booking_id=b.id and other.lesson_id<>l.id)) then reason:='shared_prepaid_review_required';
  elsif p_action='reschedule' and (p_starts_at is null or p_starts_at<=now()) then reason:='invalid_time';
  elsif p_action='reschedule' and exists(select 1 from public.package_credit_entries e join public.packages p on p.id=e.package_id
    where e.lesson_id=l.id and p.expires_at<=greatest(now(),p_starts_at) group by p.id having sum(e.quantity)<0) then reason:='reserved_credit_expires';
  end if;
  for evaluated_student in select unnest(students) order by 1 loop
    diagnostic:=credit_internal.evaluate_student_lesson_credit(evaluated_student,l.id,'manual');
    credit_diagnostics:=jsonb_set(credit_diagnostics,array[evaluated_student::text],diagnostic);
    if reason is null and diagnostic->>'reasonCode'='reconciliation_required' then reason:='reconciliation_required'; end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'version',b.version,'shared',
    exists(select 1 from public.lesson_participants other where other.booking_id=b.id and other.lesson_id<>l.id),
    'unaffectedActive', (select count(distinct other.lesson_id) from public.lesson_participants other join public.lessons x on x.id=other.lesson_id
      where other.booking_id=b.id and other.lesson_id<>l.id and other.status in ('reserved','confirmed') and x.status='scheduled')) order by b.id),'[]')
    into bookings from public.bookings b where b.studio_id=l.studio_id and b.id in(select booking_id from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed'));
  select count(*) into credit_count from (select e.package_id,e.used_by_student_id from public.package_credit_entries e where e.lesson_id=l.id group by e.package_id,e.used_by_student_id having sum(e.quantity)<0) held;
  return jsonb_build_object('eligible',reason is null,'reasonCode',reason,'lessonId',l.id,'version',l.version,
    'topic',l.topic,'startsAt',l.starts_at,'endsAt',l.ends_at,'status',l.status,'seriesId',l.series_id,
    'class',l.student_id is null or l.offering_id is not null or coalesce(l.capacity,1)>1,
    'studentIds',to_jsonb(students),'bookings',bookings,'reservedCredits',credit_count,'creditDiagnostics',credit_diagnostics,
    'calendarPending',exists(select 1 from public.calendar_projections where lesson_id=l.id and status<>'projected'),
    'notificationParticipantCount',(select count(*) from public.lesson_participants where lesson_id=l.id and status in ('reserved','confirmed')),
    'providerLinked',l.source_provider not in ('studio','public_booking'));
end $$;

create or replace function public.portal_renewal_options(p_student uuid,p_lesson uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.students; l public.lessons; actor uuid:=auth.uid(); ids jsonb;
  evaluation jsonb; allowed boolean;
begin
  select * into s from public.students where id=p_student and deleted_at is null and portal_enabled;
  if s.id is null or actor is null or not public.can_view_student_finance(p_student) then
    raise exception 'FORBIDDEN';
  end if;
  allowed:=(s.user_id=actor and not s.is_minor and not exists(
    select 1 from public.linked_contacts c where c.student_id=s.id and c.is_primary_payer
  )) is true or exists (
    select 1 from public.linked_contacts c where c.student_id=s.id and c.studio_id=s.studio_id
      and c.user_id=actor and c.portal_enabled and c.can_view_finance and c.is_primary_payer
  );
  if not allowed or p_lesson is null then
    return jsonb_build_object('canPurchase',allowed,'definitionIds','[]'::jsonb);
  end if;
  if not public.can_view_student_schedule(p_student) then raise exception 'FORBIDDEN'; end if;
  select x.* into l from public.lessons x where x.id=p_lesson and x.studio_id=s.studio_id
    and exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
      where lp.lesson_id=x.id and lp.student_id=s.id and lp.status in ('reserved','confirmed')
       and b.student_id=s.id and b.status='confirmed' and b.payment_policy='credits');
  if l.id is null or l.status<>'scheduled' or l.starts_at<=now() or l.service_id is null then
    return jsonb_build_object('canPurchase',true,'definitionIds','[]'::jsonb);
  end if;
  evaluation:=credit_internal.evaluate_student_lesson_credit(p_student,p_lesson,'manual');
  if evaluation->>'reasonCode' not in ('no_available_credits','expires_before_lesson')
    or coalesce((evaluation->>'existingReservation')::boolean,false) then
    return jsonb_build_object('canPurchase',true,'definitionIds','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(d.id order by d.session_count,d.id),'[]'::jsonb) into ids
    from public.package_definitions d where d.studio_id=s.studio_id
    and d.active and d.visibility='public' and d.direct_purchase
    and l.service_id=any(d.eligible_service_ids)
    and l.ends_at-l.starts_at=make_interval(mins=>d.session_duration_minutes)
    and (l.meeting_provider is null or l.meeting_provider=any(d.meeting_providers))
    and (d.expiration_days is null or now()+interval '24 hours'*d.expiration_days>l.starts_at)
    and exists(select 1 from public.package_billing_options b where b.definition_id=d.id
      and b.renewal_mode='one_time' and b.active and nullif(trim(b.stripe_price_id),'') is not null);
  return jsonb_build_object('canPurchase',true,'definitionIds',ids);
end $$;
