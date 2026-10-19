-- PR 1: read-only credit truth. No ledger writes or reservation policy changes.
-- Private definer reads are necessary to inspect payment blockers even when a
-- finance-authorized guardian cannot select bookings under schedule RLS.
-- Every entry point validates finance access; lesson logistics require schedule
-- access separately. The public RPC itself remains an invoker function.
create schema if not exists credit_internal;
revoke all on schema credit_internal from public, anon;
grant usage on schema credit_internal to authenticated, service_role;

create function credit_internal.require_student_finance(p_student uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and (auth.uid() is null or not public.can_view_student_finance(p_student)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from public.students where id = p_student and deleted_at is null) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Match portal visibility: a minor's own login does not expose finance, and
  -- disabling the student workspace cannot be bypassed through this new RPC.
  if current_setting('role', true) is distinct from 'service_role' and exists(
    select 1 from public.students s where s.id = p_student and not public.is_studio_coach(s.studio_id)
      and (not s.portal_enabled or (s.is_minor and s.user_id = auth.uid()))) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function credit_internal.require_student_finance(uuid) from public, anon;
grant execute on function credit_internal.require_student_finance(uuid) to authenticated, service_role;

-- p_allocated represents hypothetical reservations made earlier in this read,
-- keyed by package UUID. It never changes the actual ledger. Automatic mode
-- deliberately retains the existing null-account fallback to per-package flags;
-- the mixed preference is also reported separately for explicit coach review.
create function credit_internal.evaluate_student_lesson_credit(
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
      where e.lesson_id = l.id and p.student_id = p_student
      group by e.package_id having sum(e.quantity) < 0) t;

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
      select auto_apply into enabled from public.student_credit_accounts where student_id = p_student;
      if p_mode = 'automatic' and enabled = false then
        reason := 'auto_disabled';
      else
        select p.* into pkg from public.packages p
          where p.student_id = p_student
            and (p_package is null or p.id = p_package)
            and (p_mode <> 'automatic' or coalesce(enabled, p.auto_apply))
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0
          order by p.expires_at nulls last, p.created_at, p.id limit 1;
        if pkg.id is not null then
          return jsonb_build_object('state', 'eligible_unreserved', 'reasonCode', 'eligible',
            'eligible', true, 'packageId', pkg.id, 'expiresAt', pkg.expires_at);
        end if;
        if p_mode = 'automatic' and enabled is null and exists(
          select 1 from public.packages p where p.student_id = p_student and not p.auto_apply
            and (p_package is null or p.id = p_package)
            and (p.expires_at is null or p.expires_at > greatest(now(), l.starts_at))
            and public.package_credit_balance(p.id) - coalesce((p_allocated->>p.id::text)::integer, 0) > 0) then
          reason := 'mixed_settings_review'; state := 'review_required';
        elsif exists(select 1 from public.packages p where p.student_id = p_student
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
-- Only trusted reservation commands and the guarded read facade can invoke the
-- evaluator. Portal callers must not probe arbitrary lesson/student pairs.
revoke all on function credit_internal.evaluate_student_lesson_credit(uuid,uuid,text,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function credit_internal.evaluate_student_lesson_credit(uuid,uuid,text,jsonb,uuid,boolean) to service_role;

-- Preserve the established mutation contract and lock order. Inconsistent
-- existing reservations are flagged by diagnostics but returned unchanged here,
-- exactly as before: this PR must not silently reconcile historical balances.
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
    case when p_manual then 'manual' else 'automatic' end, '{}'::jsonb, credit_package);
  if not (decision->>'eligible')::boolean then return null; end if;
  insert into public.package_credit_entries(package_id,lesson_id,kind,quantity,reason)
    values(credit_package,l.id,case when l.status = 'completed' then 'consumption'::public.credit_entry_kind
      else 'reservation'::public.credit_entry_kind end,-1,p_reason);
  update public.bookings b set payment_policy = 'credits',payment_status = 'paid',version = b.version+1,updated_at = now()
    where b.student_id = p_student and b.paid_minor = 0
      and b.id in(select booking_id from public.lesson_participants where lesson_id = l.id and student_id = p_student);
  update public.lessons set package_id = credit_package,
    payment_status = 'paid_by_credit',version = version+1,updated_at = now() where id = l.id and student_id = p_student;
  perform public.sync_invoice_lesson_credit(l.id,p_student);
  return credit_package;
end;
$$;

create function credit_internal.read_student_credit_coverage(
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
    'summary', summary - 'lots', 'previewEnable', p_preview_enable,
    'settingReasonCode', case when summary->'autoApply' = 'null'::jsonb then 'mixed_settings_review' end,
    'lessonsVisible', lessons_visible, 'items', items,
    'page', p_page, 'pageSize', p_page_size, 'total', case when lessons_visible then total end,
    'hasMore', lessons_visible and total > p_page::bigint * p_page_size,
    'counts', case when lessons_visible then jsonb_build_object('covered', covered,
      'eligible', eligible, 'uncovered', uncovered, 'reviewRequired', review_required) end);
end;
$$;
revoke all on function credit_internal.read_student_credit_coverage(uuid,integer,integer,boolean) from public, anon;
grant execute on function credit_internal.read_student_credit_coverage(uuid,integer,integer,boolean) to authenticated, service_role;

create function public.student_credit_coverage(
  p_student uuid, p_page integer default 1, p_page_size integer default 25,
  p_preview_enable boolean default false
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select credit_internal.read_student_credit_coverage(p_student, p_page, p_page_size, p_preview_enable);
$$;
revoke all on function public.student_credit_coverage(uuid,integer,integer,boolean) from public, anon;
grant execute on function public.student_credit_coverage(uuid,integer,integer,boolean) to authenticated, service_role;
