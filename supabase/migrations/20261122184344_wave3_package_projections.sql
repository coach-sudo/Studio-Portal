
-- Portal projections never return audit notes, provider IDs, or other
-- beneficiaries' lesson details. The pool total is calculated once per lot.
create function credit_internal.read_package_wallet(p_student uuid,p_lessons_visible boolean)
returns jsonb language sql stable set search_path='' as $$
  with lots as (
    select p.id,p.name,p.expires_at,exists(
      select 1 from credit_internal.package_beneficiaries x where x.package_id=p.id
    ) shared,p.definition_id,
    credit_internal.package_covers_student(p.id,p.student_id,p_student) can_use
    from public.packages p
    where p.student_id=p_student or exists(
      select 1 from credit_internal.package_beneficiaries b where b.package_id=p.id and b.student_id=p_student
    )
  ), debits as (
    select e.package_id,l.id,l.topic,l.starts_at,l.status,coalesce(e.covered_student_id,p.student_id) student_id,
      -sum(e.quantity)::integer units
    from lots x join public.packages p on p.id=x.id join public.package_credit_entries e on e.package_id=x.id
    join public.lessons l on e.lesson_id=l.id
    group by e.package_id,l.id,coalesce(e.covered_student_id,p.student_id)
    having sum(e.quantity)<0
  ), totals as (
    select package_id,coalesce(sum(units) filter(where status='scheduled'),0) reserved,
      coalesce(sum(units) filter(where status in ('completed','late_cancelled','no_show')),0) used
    from debits group by package_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'name',x.name,'expiresAt',x.expires_at,'shared',x.shared,
    'available',case when x.expires_at<=now() then 0 else greatest(public.package_credit_balance(x.id),0) end,
    'reserved',coalesce(t.reserved,0),'used',coalesce(t.used,0),
    'expired',case when x.expires_at<=now() then greatest(public.package_credit_balance(x.id),0) else 0 end,
    'needsReview',public.package_credit_balance(x.id)<0 or not exists(
      select 1 from credit_internal.package_credit_terms s where s.package_id=x.id
        and s.duration_minutes>0 and cardinality(s.service_ids)>0 and s.issuance_entry_id is not null
    ),
    'lessons',coalesce((select jsonb_agg(to_jsonb(d) order by d."startsAt" desc,d.id)
      from (select a.id,a.topic,a.starts_at "startsAt",a.status,a.units from debits a
        where a.package_id=x.id and a.student_id=p_student and p_lessons_visible
        order by a.starts_at desc,a.id limit 30) d),'[]'::jsonb)
  ) order by x.expires_at nulls last,x.id),'[]'::jsonb)
  from lots x left join totals t on t.package_id=x.id where x.can_use
$$;
revoke all on function credit_internal.read_package_wallet(uuid,boolean) from public,anon,authenticated,service_role;

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
    'maintenance', (select jsonb_build_object('pending',generation>completed_generation,
      'requestedVersion',requested_version,'completedVersion',completed_version,'attempts',attempts,
      'lastError',last_error,'updatedAt',updated_at) from credit_internal.credit_coverage_jobs where student_id=p_student), 'previewEnable', p_preview_enable,
    'settingReasonCode', case when summary->'autoApply' = 'null'::jsonb then 'mixed_settings_review' end,
    'packages', credit_internal.read_package_wallet(p_student,lessons_visible), 'lessonsVisible', lessons_visible, 'items', items,
    'page', p_page, 'pageSize', p_page_size, 'total', case when lessons_visible then total end,
    'hasMore', lessons_visible and total > p_page::bigint * p_page_size,
    'counts', case when lessons_visible then jsonb_build_object('covered', covered,
      'eligible', eligible, 'uncovered', uncovered, 'reviewRequired', review_required) end);
end;
$$;
