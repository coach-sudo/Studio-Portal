-- Catalog edits must not change the service or duration sold with an issued lot.
-- No legacy row is backfilled from today's catalog.
create table credit_internal.package_credit_terms (
  package_id uuid primary key references public.packages(id) on delete cascade,
  original_student_id uuid not null,
  original_definition_id uuid,
  original_name text not null,
  original_expires_at timestamptz,
  service_ids uuid[] not null,
  duration_minutes integer,
  issuance_entry_id uuid references public.package_credit_entries(id) on delete set null,
  captured_at timestamptz not null default now()
);
revoke all on credit_internal.package_credit_terms from public,anon,authenticated,service_role;

create function credit_internal.capture_package_credit_terms()
returns trigger language plpgsql security definer set search_path='' as $$
declare definition public.package_definitions;
begin
  select d.* into definition from public.package_definitions d
    join public.students s on s.studio_id=d.studio_id and s.id=new.student_id
    where d.id=new.definition_id;
  insert into credit_internal.package_credit_terms(package_id,original_student_id,
    original_definition_id,original_name,original_expires_at,service_ids,duration_minutes)
  values(new.id,new.student_id,new.definition_id,new.name,new.expires_at,
    coalesce(definition.eligible_service_ids,'{}'),definition.session_duration_minutes);
  return new;
end $$;
revoke all on function credit_internal.capture_package_credit_terms() from public,anon,authenticated;
create trigger capture_package_credit_terms after insert on public.packages
  for each row execute function credit_internal.capture_package_credit_terms();

create function credit_internal.capture_package_credit_issuance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update credit_internal.package_credit_terms set issuance_entry_id=new.id
    where package_id=new.package_id and issuance_entry_id is null;
  return new;
end $$;
revoke all on function credit_internal.capture_package_credit_issuance() from public,anon,authenticated;
create trigger capture_package_credit_issuance after insert on public.package_credit_entries
  for each row when (new.lesson_id is null and new.quantity>0 and new.kind in ('purchase','adjustment'))
  execute function credit_internal.capture_package_credit_issuance();

-- Definitionless lots keep the old allocation path. Definition-linked legacy
-- lots keep using their current supported rules, identified as unverified terms.
create function credit_internal.package_terms_match(
  p_package uuid,p_studio uuid,p_service uuid,p_duration interval
) returns boolean language sql stable set search_path='' as $$
  select case
    when t.package_id is not null and t.original_definition_id is not null then
      coalesce(p_service=any(t.service_ids) and p_duration=make_interval(mins=>t.duration_minutes),false)
    when t.package_id is not null or p.definition_id is null then null
    else coalesce(p_service=any(d.eligible_service_ids) and
      p_duration=make_interval(mins=>d.session_duration_minutes),false)
  end
  from public.packages p join public.students s on s.id=p.student_id and s.studio_id=p_studio
  left join credit_internal.package_credit_terms t on t.package_id=p.id
  left join public.package_definitions d on d.id=p.definition_id and d.studio_id=s.studio_id
  where p.id=p_package
$$;
revoke all on function credit_internal.package_terms_match(uuid,uuid,uuid,interval) from public,anon,authenticated;

create or replace function credit_internal.package_lesson_matches(p_package uuid,p_lesson uuid)
returns boolean language sql stable set search_path='' as $$
  select credit_internal.package_terms_match(p_package,l.studio_id,l.service_id,l.ends_at-l.starts_at)
  from public.lessons l where l.id=p_lesson
$$;

create or replace function credit_internal.guard_typed_credit_hold()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status<>'scheduled' or new.status not in ('scheduled','completed') or
    (new.status=old.status and
     (new.starts_at,new.ends_at,new.service_id) is not distinct from
     (old.starts_at,old.ends_at,old.service_id)) then
    return new;
  end if;
  if exists (
    select 1 from public.package_credit_entries e
    join public.packages p on p.id=e.package_id
    where e.lesson_id=old.id
      and (credit_internal.package_terms_match(p.id,new.studio_id,new.service_id,new.ends_at-new.starts_at) is false
        or (credit_internal.package_terms_match(p.id,new.studio_id,new.service_id,new.ends_at-new.starts_at) is true
          and p.expires_at<=new.starts_at))
    group by p.id having sum(e.quantity)<0
  ) then
    raise exception 'INVALID_TRANSITION: Review incompatible or expired package coverage before changing this lesson.';
  end if;
  return new;
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
      (l.student_id=p_student or exists(select 1 from public.lesson_participants lp
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
      case when ledger.issued=0 and (ledger.net<>0 or exists(select 1 from debits)) then 'missing_issuance' end,
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

create or replace function credit_internal.read_student_credit_coverage(
  p_student uuid, p_page integer, p_page_size integer, p_preview_enable boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  summary jsonb;
  l record;
  result jsonb;
  items jsonb := '[]'::jsonb;
  allocated jsonb := '{}'::jsonb;
  total integer := 0;
  covered integer := 0;
  eligible integer := 0;
  uncovered integer := 0;
  review_required integer := 0;
  selected_package text;
  lessons_visible boolean;
begin
  perform credit_internal.require_student_finance(p_student);
  if p_page is null or p_page < 1 or p_page > 1000000
     or p_page_size is null or p_page_size < 1 or p_page_size > 100
     or p_preview_enable is null then
    raise exception 'VALIDATION_FAILED: Coverage page size must be 1-100.' using errcode = '22023';
  end if;
  summary := public.student_credit_summary(p_student);
  lessons_visible := current_setting('role', true) = 'service_role' or public.can_view_student_schedule(p_student);
  if lessons_visible then
    for l in select x.id, x.topic, x.starts_at, x.ends_at, x.version from public.lessons x
      join public.students s on s.id = p_student and s.studio_id = x.studio_id
      where x.status = 'scheduled' and x.starts_at >= now()
        and (x.student_id = p_student or exists(select 1 from public.lesson_participants lp
          where lp.lesson_id = x.id and lp.student_id = p_student and lp.status in ('reserved', 'confirmed')))
      order by x.starts_at, x.id
    loop
      result := credit_internal.evaluate_student_lesson_credit(p_student, l.id,
        case when p_preview_enable then 'enable_preview' else 'automatic' end, allocated, null,
        (summary->>'needsReview')::boolean);
      total := total + 1;
      if result->>'state' = 'covered' then covered := covered + 1;
      elsif (result->>'eligible')::boolean then
        eligible := eligible + 1;
        selected_package := result->>'packageId';
        allocated := jsonb_set(allocated, array[selected_package],
          to_jsonb(coalesce((allocated->>selected_package)::integer, 0) + 1));
      else
        uncovered := uncovered + 1;
        if result->>'state' = 'review_required' then review_required := review_required + 1; end if;
      end if;
      if total > (p_page::bigint - 1) * p_page_size and total <= p_page::bigint * p_page_size then
        items := items || jsonb_build_array(result || jsonb_build_object(
          'lessonId', l.id, 'topic', l.topic, 'startsAt', l.starts_at, 'endsAt', l.ends_at, 'version', l.version));
      end if;
    end loop;
  end if;
  return jsonb_build_object('studentId', p_student, 'evaluatedAt', now(),
    'summary', summary - 'lots',
    'packages', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v->'id','name', v->'name','durationMinutes', v->'durationMinutes',
      'services', v->'services','expiresAt', v->'expiresAt','unused', v->'unused',
      'reserved', v->'reserved','available', v->'available','consumed', v->'consumed',
      'eligibilityVerified', v->'terms' is not null and v->'terms'<>'null'::jsonb
        and not ((v->'issues') ? 'eligibility_unverified')
    ) order by p.created_at desc,p.id)
    from public.packages p cross join lateral credit_internal.package_credit_review(p_student,p.id) v
    where p.student_id=p_student),'[]'::jsonb),
    'maintenance', (select jsonb_build_object('pending',generation>completed_generation,
      'requestedVersion',requested_version,'completedVersion',completed_version,'attempts',attempts,
      'lastError',last_error,'updatedAt',updated_at) from credit_internal.credit_coverage_jobs where student_id=p_student), 'previewEnable', p_preview_enable,
    'settingReasonCode', case when summary->'autoApply' = 'null'::jsonb then 'mixed_settings_review' end,
    'lessonsVisible', lessons_visible, 'items', items,
    'page', p_page, 'pageSize', p_page_size, 'total', case when lessons_visible then total end,
    'hasMore', lessons_visible and total > p_page::bigint * p_page_size,
    'counts', case when lessons_visible then jsonb_build_object('covered', covered,
      'eligible', eligible, 'uncovered', uncovered, 'reviewRequired', review_required) end);
end;
$$;
