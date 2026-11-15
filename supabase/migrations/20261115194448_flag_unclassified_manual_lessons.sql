-- Keep existing lessons intact. An unresolved manual lesson is not evidence of a prepaid obligation or a separate payment arrangement.
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
  student_status text;
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
    for l in select x.id, x.topic, x.starts_at, x.ends_at, x.version, x.service_id, x.source_provider from public.lessons x
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
      student_status:=case
        when result->>'state'='covered' then case when credit_internal.package_lesson_matches(
          (result->>'packageId')::uuid,l.id) is true then 'covered' else 'studio_review' end
        when result->>'reasonCode'='payment_pending' then 'processing'
        when result->>'reasonCode'='expires_before_lesson' and result->>'existingReservation'='true' then 'expiration_review'
        when result->>'state'='review_required' then 'studio_review'
        when result->>'reasonCode' in ('cash_paid','partially_paid','lesson_ineligible') then 'separate_payment'
        when exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
          where lp.lesson_id=l.id and b.student_id=p_student and b.status='confirmed' and b.payment_policy='credits')
          then case when result->>'state'='eligible_unreserved' then 'awaiting_reservation'
            when result->>'reasonCode'='auto_disabled' then 'studio_review' else 'needs_credit' end
        when l.service_id is null and coalesce(l.source_provider,'studio')='studio'
          and not exists(select 1 from public.lesson_participants lp join public.bookings b on b.id=lp.booking_id
            where lp.lesson_id=l.id and lp.student_id=p_student and b.student_id=p_student and b.status='confirmed')
          then 'studio_review'
        else 'separate_payment' end;
      if total > (p_page::bigint - 1) * p_page_size and total <= p_page::bigint * p_page_size then
        items := items || jsonb_build_array(result || jsonb_build_object(
          'coverageStatus',student_status,'serviceId',l.service_id,
          'durationMinutes',extract(epoch from l.ends_at-l.starts_at)/60,'lessonId', l.id, 'topic', l.topic, 'startsAt', l.starts_at, 'endsAt', l.ends_at, 'version', l.version));
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
