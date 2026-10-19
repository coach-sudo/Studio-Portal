-- PR 1.4, dependent on PRs #36-38. No historical lessons are changed.
-- All command/worker surfaces are service-only and validate the authenticated
-- coach supplied by the existing Netlify command boundary.
create table lesson_ops.lesson_bulk_jobs (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,studio_id uuid not null references public.studios(id),
 operation text not null check(operation in ('cancel','archive','restore','void','delete')),
 request jsonb not null,review_token text not null,expires_at timestamptz not null default now()+interval '30 minutes',
 state text not null default 'reviewed' check(state in ('reviewed','running')),
 series_snapshot jsonb not null default '{}',created_at timestamptz not null default now(),accepted_at timestamptz
);
create table lesson_ops.lesson_bulk_items (
 id uuid primary key default gen_random_uuid(),job_id uuid not null references lesson_ops.lesson_bulk_jobs(id),
 lesson_id uuid not null,ordinal integer not null,lesson_version integer not null,
 assessment jsonb not null,fingerprint text not null,
 status text not null check(status in ('blocked','pending','processing','succeeded','skipped','conflicted','failed')),
 attempts integer not null default 0,claim_token uuid,claim_until timestamptz,next_attempt_at timestamptz not null default now(),
 reason_code text,result jsonb,finished_at timestamptz,unique(job_id,lesson_id),unique(job_id,ordinal)
);
create index bulk_items_pending on lesson_ops.lesson_bulk_items(next_attempt_at,job_id,ordinal) where status in ('pending','processing','failed');
create table lesson_ops.lesson_bulk_requests (
 key text primary key,actor_id uuid not null,job_id uuid not null references lesson_ops.lesson_bulk_jobs(id),kind text not null,request jsonb not null,result jsonb not null
);
create table lesson_ops.lesson_record_state (
 lesson_id uuid primary key references public.lessons(id) on delete restrict,studio_id uuid not null,
 archived_at timestamptz,archived_by uuid,voided_at timestamptz,voided_by uuid,void_reason text,
 version integer not null default 1
);
create table lesson_ops.lesson_deletion_snapshots (
 lesson_id uuid primary key,studio_id uuid not null,actor_id uuid not null,
 job_id uuid not null references lesson_ops.lesson_bulk_jobs(id),reason text not null,
 snapshot jsonb not null,created_at timestamptz not null default now()
);
alter table lesson_ops.lesson_bulk_jobs enable row level security;
alter table lesson_ops.lesson_bulk_items enable row level security;
alter table lesson_ops.lesson_bulk_requests enable row level security;
alter table lesson_ops.lesson_record_state enable row level security;
alter table lesson_ops.lesson_deletion_snapshots enable row level security;
revoke all on lesson_ops.lesson_bulk_jobs,lesson_ops.lesson_bulk_items,lesson_ops.lesson_bulk_requests,
 lesson_ops.lesson_record_state,lesson_ops.lesson_deletion_snapshots from public,anon,authenticated,service_role;

create function lesson_ops.immutable_deletion_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if current_setting('app.bulk_fixture_cleanup',true)='true' and starts_with(old.snapshot->'lesson'->>'topic','e2e-') then return old; end if;
 raise exception 'FORBIDDEN: Deletion snapshots are immutable';
end $$;
create trigger immutable_deletion_snapshot before update or delete on lesson_ops.lesson_deletion_snapshots
 for each row execute function lesson_ops.immutable_deletion_snapshot();

-- Only positively identified, untouched, native creation scaffolding can go.
-- Existing participants are not retroactively marked safe.
alter table public.lesson_participants add column deletion_scaffold boolean not null default false;
create function lesson_ops.mark_creation_scaffold() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then new.deletion_scaffold:=false;
 else
  new.deletion_scaffold:=exists(select 1 from public.lessons l join public.students s on s.id=l.student_id
   where l.id=new.lesson_id and l.source_provider='studio' and l.source_external_id is null
    and l.student_id=new.student_id and new.booking_id is null and l.offering_id is null and coalesce(l.capacity,1)=1
    and new.status='confirmed' and new.created_at=l.created_at and new.email=s.email and new.display_name=s.full_name);
 end if;
 return new;
end $$;
create trigger mark_creation_scaffold before insert or update on public.lesson_participants for each row execute function lesson_ops.mark_creation_scaffold();

-- Catalog-driven dependency inventory includes actual FK columns, non-FK UUID
-- identities, UUID arrays and nested JSON strings. New matching public columns
-- are fail-closed even if an old checklist did not know about them. Audit and
-- our frozen reviews/snapshots are intentionally retained, not dependencies.
create function lesson_ops.dependencies(p_lesson uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c record;n bigint;seal text;found jsonb:='{}';predicate text;
begin
 for c in select ns.nspname schema_name,cl.relname table_name,a.attname column_name,t.typname
  from pg_catalog.pg_attribute a join pg_catalog.pg_class cl on cl.oid=a.attrelid
  join pg_catalog.pg_namespace ns on ns.oid=cl.relnamespace join pg_catalog.pg_type t on t.oid=a.atttypid
  where cl.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
   and not (ns.nspname='public' and cl.relname in ('lessons','audit_events','calendar_projections','lesson_participants'))
   and ((ns.nspname='public' and t.typname in ('uuid','_uuid','jsonb','json')) or exists(select 1 from pg_catalog.pg_constraint fk
     where fk.contype='f' and fk.confrelid='public.lessons'::regclass and fk.conrelid=cl.oid and a.attnum=any(fk.conkey)))
  order by cl.oid,a.attnum loop
  if c.typname='uuid' then predicate:=format('%I=$1',c.column_name);
  elsif c.typname='_uuid' then predicate:=format('$1=any(%I)',c.column_name);
  elsif c.typname in ('jsonb','json') then predicate:=format('(exists(select 1 from jsonb_path_query(%1$I::jsonb,''$.** ? (@.type() == "string")'') v where lower(v#>>''{}'')=$1::text) or exists(select 1 from jsonb_path_query(%1$I::jsonb,''$.** ? (@.type() == "object").keyvalue().key'') v where lower(v#>>''{}'')=$1::text))',c.column_name);
  else predicate:=format('%I::text=$1::text',c.column_name); end if;
  execute format('select count(*),md5(coalesce(string_agg(to_jsonb(t)::text,''|'' order by to_jsonb(t)::text),'''')) from %I.%I t where %s',c.schema_name,c.table_name,predicate) into n,seal using p_lesson;
  if n>0 then found:=found||jsonb_build_object(c.schema_name||'.'||c.table_name||'.'||c.column_name,jsonb_build_object('count',n,'fingerprint',seal)); end if;
 end loop;
 if exists(select 1 from lesson_ops.effects where lesson_id=p_lesson) then
  found:=found||jsonb_build_object('lesson_change_effects',jsonb_build_object('count',(select count(*) from lesson_ops.effects where lesson_id=p_lesson)));
 end if;
 return found;
end $$;

create function lesson_ops.reject_deleted_lesson_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.id=old.id then return new; end if;
 perform pg_advisory_xact_lock(hashtext('lesson_tombstone'),hashtext(new.id::text));
 if exists(select 1 from lesson_ops.lesson_deletion_snapshots where lesson_id=new.id) then raise exception 'REVIEW_REQUIRED: This lesson was permanently deleted'; end if;
 return new;
end $$;
create trigger reject_deleted_lesson_identity before insert or update of id on public.lessons for each row execute function lesson_ops.reject_deleted_lesson_identity();

-- Prevent JSON/array/non-FK references to already deleted lessons. FK inserts
-- already have parent-key locks; these tombstone checks close their missing path.
create function lesson_ops.reject_deleted_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from lesson_ops.lesson_deletion_snapshots) then return new; end if;
 if exists(select 1 from (select v from jsonb_path_query(to_jsonb(new),'$.** ? (@.type() == "string")') v
   union all select v from jsonb_path_query(to_jsonb(new),'$.** ? (@.type() == "object").keyvalue().key') v) values_and_keys
   join lesson_ops.lesson_deletion_snapshots d on lower(v#>>'{}')=d.lesson_id::text) then
  raise exception 'REVIEW_REQUIRED: This lesson was permanently deleted';
 end if;
 return new;
end $$;
do $$ declare t record;begin
 for t in select distinct c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
   join pg_catalog.pg_attribute a on a.attrelid=c.oid join pg_catalog.pg_type ty on ty.oid=a.atttypid
   where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    and c.relname not in ('audit_events','lessons') and ty.typname in ('json','jsonb','_uuid','uuid') loop
  execute format('create trigger reject_deleted_lesson_reference before insert or update on public.%I for each row execute function lesson_ops.reject_deleted_reference()',t.relname);
 end loop;
end $$;

create function lesson_ops.assess_bulk(p_lesson uuid,p_operation text,p_student uuid,p_class boolean,p_use_credit boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare l public.lessons;state lesson_ops.lesson_record_state;assessment jsonb;dependencies jsonb;reason text;fingerprint text;projection jsonb;participants jsonb;
begin
 select * into l from public.lessons where id=p_lesson;
 if l.id is null then return jsonb_build_object('lessonId',p_lesson,'eligible',false,'reasonCode','lesson_unavailable','fingerprint','missing'); end if;
 select * into state from lesson_ops.lesson_record_state where lesson_id=l.id;
 dependencies:=case when p_operation in ('archive','restore') then '{}'::jsonb else lesson_ops.dependencies(l.id) end;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into participants from public.lesson_participants p where lesson_id=l.id;
 select to_jsonb(p) into projection from public.calendar_projections p where lesson_id=l.id;
 if p_operation='cancel' then assessment:=lesson_ops.assess_change(l.id,'cancel',null,p_class);reason:=assessment->>'reasonCode';
 else assessment:=jsonb_build_object('lessonId',l.id,'version',l.version,'topic',l.topic,'startsAt',l.starts_at,'endsAt',l.ends_at,
   'status',l.status,'seriesId',l.series_id,'studentIds',case when l.student_id is null then '[]'::jsonb else to_jsonb(array[l.student_id]) end,
   'notificationParticipantCount',0,'reservedCredits',0); end if;
 if l.student_id is not null and not exists(select 1 from public.students where id=l.student_id and studio_id=l.studio_id) then reason:='student_ownership_review_required';
 elsif p_student is not null and l.student_id is distinct from p_student then reason:='class_scope_required';
 elsif state.voided_at is not null then reason:='record_voided';
 elsif p_operation in ('archive','restore','void') and (l.student_id is null or l.offering_id is not null or coalesce(l.capacity,1)>1
  or exists(select 1 from public.lesson_participants where lesson_id=l.id and student_id is distinct from l.student_id)) and not p_class then reason:='class_scope_required';
 elsif p_operation='archive' and l.status not in ('completed','cancelled','late_cancelled') then reason:='terminal_record_required';
 elsif p_operation='archive' and state.archived_at is not null then reason:='already_archived';
 elsif p_operation='restore' and state.archived_at is null then reason:='not_archived';
 elsif p_operation='void' then
  if l.status<>'cancelled' then reason:='cancelled_record_required';
  elsif l.invoice_payment_pending or l.paid_minor<>0 or l.payment_status in ('due','unpaid','partially_paid','processing')
    or exists(select 1 from public.package_credit_entries e where e.lesson_id=l.id group by e.package_id having sum(e.quantity)<-1)
    or exists(select 1 from public.bookings b join public.lesson_participants p on p.booking_id=b.id where p.lesson_id=l.id
      and b.status='confirmed' and (b.payment_status='processing' or b.total_minor>b.paid_minor and b.payment_policy<>'credits'))
    or exists(select 1 from public.studio_invoices i cross join jsonb_array_elements(i.items) x where x->'lessonIds' @> to_jsonb(array[l.id::text])
      and i.status not in ('draft','void') and not coalesce((x->>'cancelled')::boolean,false)) then reason:='financial_review_required'; end if;
 elsif p_operation='delete' then
  if l.status not in ('scheduled','cancelled') then reason:='historical_record_protected';
  elsif l.source_provider is distinct from 'studio' or l.source_external_id is not null or to_jsonb(l)->>'imported_at' is not null then reason:='provider_history';
  elsif l.package_id is not null or exists(select 1 from public.package_credit_entries where lesson_id=l.id) then reason:='credit_history';
  elsif coalesce(l.paid_minor,0)<>0 or l.payment_status not in ('untracked','due','unpaid') or l.invoice_id is not null or l.invoice_payment_pending then reason:='financial_history';
  elsif l.offering_id is not null or l.student_id is null or coalesce(l.capacity,1)>1 then reason:='class_history';
  elsif exists(select 1 from public.lesson_participants where lesson_id=l.id and (not deletion_scaffold or booking_id is not null or student_id is distinct from l.student_id)) then reason:='participant_history';
  elsif l.join_url is not null or coalesce(projection->>'external_event_id','')<>'' or coalesce(projection->>'external_version','')<>'' or projection->>'last_error' is not null
    or projection->>'first_attempted_at' is not null or projection->>'claim_token' is not null or coalesce((projection->>'attempts')::integer,0)>0
    or coalesce((projection->>'projected_version')::integer,0)>0 or projection->>'last_projected_at' is not null
    or (projection is not null and projection->>'status'<>'queued') then reason:='calendar_history';
  elsif dependencies<>'{}' then reason:='record_dependencies';
  elsif state.lesson_id is not null then reason:='record_management_history'; end if;
 end if;
 if exists(select 1 from public.sync_conflicts where entity_type='lesson' and entity_id=l.id and status='open') then reason:='synchronization_review_required'; end if;
 if p_operation in ('cancel','void') and exists(select 1 from public.studio_invoices inv cross join jsonb_array_elements(inv.items) line
  where line->'lessonIds' @> to_jsonb(array[l.id::text]) and inv.studio_id<>l.studio_id) then reason:='invoice_ownership_review_required'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('lesson',to_jsonb(l),'state',to_jsonb(state),
   'dependencies',dependencies,'participants',participants,'projection',projection,'assessment',assessment)::text,'sha256'),'hex');
 return assessment||jsonb_build_object('eligible',reason is null,'reasonCode',reason,'dependencies',dependencies,'fingerprint',fingerprint,
   'creditPolicy',case when p_use_credit then 'retain' else 'return' end,'calendarEffect',p_operation='cancel',
   'notificationEffect',p_operation='cancel','archivedAt',state.archived_at,'voidedAt',state.voided_at,
   'potentialNotificationStudentIds',case when p_operation='cancel' then assessment->'studentIds' else '[]'::jsonb end,
   'financialConsequences',jsonb_build_object('paidAmountPreserved',true,'initiatesCashRefund',false,
    'creditSettlement',case when p_operation='cancel' then case when p_use_credit then 'retain' else 'return_under_existing_expiry_policy' end else 'none' end,
    'invoiceLines',case when p_operation='cancel' then (select coalesce(jsonb_agg(jsonb_build_object('invoiceId',inv.id,'currency',inv.currency,
      'lineId',line->>'id','paidMinor',coalesce((line->>'paidMinor')::bigint,0),'marksCancelled',not coalesce((line->>'cancelled')::boolean,false),
      'unpaidWaiverMinor',case when p_use_credit or coalesce((line->>'cancelled')::boolean,false) then 0 else greatest(0,
        coalesce((line->>'quantity')::bigint,0)*coalesce((line->>'unitMinor')::bigint,0)-coalesce((line->>'paidMinor')::bigint,0)-coalesce((line->>'creditMinor')::bigint,0)) end)),'[]')
     from public.studio_invoices inv cross join jsonb_array_elements(inv.items) line where inv.studio_id=l.studio_id and inv.status not in ('draft','void')
      and line->'lessonIds' @> to_jsonb(array[l.id::text])) else '[]'::jsonb end));
end $$;

create function lesson_ops.require_bulk_coach(p_actor uuid,p_studio uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.memberships where user_id=p_actor and studio_id=p_studio and role='coach') then raise exception 'FORBIDDEN'; end if;
end $$;

-- One common filtered candidate query drives pagination AND all-matching freeze.
-- Raw request filters are validated even for service-role calls.
create function lesson_ops.bulk_candidates(p_studio uuid,p_filter jsonb) returns setof public.lessons
language plpgsql stable security definer set search_path='' as $$
begin
 if p_filter-'studentId'-'statuses'-'from'-'to'-'query'-'seriesId'-'includeArchived'-'sort'-'page'-'view'<>'{}'
   or length(coalesce(p_filter->>'query',''))>120 then raise exception 'VALIDATION_FAILED'; end if;
 return query select l.* from public.lessons l where l.studio_id=p_studio
  and (p_filter->>'studentId' is null or l.student_id=(p_filter->>'studentId')::uuid or exists(select 1 from public.lesson_participants p where p.lesson_id=l.id and p.student_id=(p_filter->>'studentId')::uuid))
  and (p_filter->>'seriesId' is null or l.series_id=(p_filter->>'seriesId')::uuid)
  and (p_filter->'statuses' is null or l.status::text in(select jsonb_array_elements_text(p_filter->'statuses')))
  and (p_filter->>'from' is null or l.starts_at>=(p_filter->>'from')::timestamptz)
  and (p_filter->>'to' is null or l.starts_at<(p_filter->>'to')::timestamptz)
  and (p_filter->>'query' is null or position(lower(p_filter->>'query') in lower(l.topic))>0)
  and not exists(select 1 from lesson_ops.lesson_record_state s where s.lesson_id=l.id and (s.voided_at is not null or s.archived_at is not null and not coalesce((p_filter->>'includeArchived')::boolean,false)));
end $$;

create function public.lesson_bulk_candidates(p_actor uuid,p_studio uuid,p_filter jsonb,p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform lesson_ops.require_bulk_coach(p_actor,p_studio);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
 return jsonb_build_object('count',(select count(*) from lesson_ops.bulk_candidates(p_studio,p_filter)),
  'items',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from (select * from lesson_ops.bulk_candidates(p_studio,p_filter) order by starts_at,id offset p_offset limit p_limit) l),
  'offset',p_offset,'limit',p_limit);
end $$;

create function public.preview_lesson_bulk(p_actor uuid,p_studio uuid,p_key text,p_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[];anchors uuid[];excluded uuid[];job lesson_ops.lesson_bulk_jobs;l public.lessons;a jsonb;counter integer:=0;prior lesson_ops.lesson_bulk_requests;
 operation text:=p_value->>'operation';scope text:=coalesce(p_value->>'scope','selected');student uuid:=coalesce(p_value->>'studentContextId',p_value->'filter'->>'studentId')::uuid;
 class_scope boolean:=coalesce((p_value->>'wholeClass')::boolean,false);series_state jsonb:='{}';
begin
 perform lesson_ops.require_bulk_coach(p_actor,p_studio);
 if p_key is null or length(p_key) not between 8 and 200 or coalesce(operation,'') not in ('cancel','archive','restore','void','delete')
  or scope not in ('selected','future','series') or length(trim(coalesce(p_value->>'reason',''))) not between 3 and 500
  or (class_scope and student is not null) then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtext(p_studio::text));
 select * into prior from lesson_ops.lesson_bulk_requests where key='preview:'||p_key;
 if prior.key is not null then
  if prior.actor_id<>p_actor or prior.request<>p_value or not exists(select 1 from lesson_ops.lesson_bulk_jobs where id=prior.job_id and studio_id=p_studio) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;return prior.result; end if;
 if student is not null and not exists(select 1 from public.students where id=student and studio_id=p_studio and deleted_at is null) then raise exception 'FORBIDDEN'; end if;
 select coalesce(array_agg(distinct value::uuid),'{}') into excluded from jsonb_array_elements_text(coalesce(p_value->'excludedIds','[]'));
 if cardinality(excluded)>5000 then raise exception 'BATCH_TOO_LARGE'; end if;
 if p_value->>'selectionMode'='matching' then
  if scope<>'selected' then raise exception 'VALIDATION_FAILED'; end if;
  select coalesce(array_agg(id),'{}') into ids from (select id from lesson_ops.bulk_candidates(p_studio,coalesce(p_value->'filter','{}')) where not id=any(excluded) limit 5001) bounded;
 elsif coalesce(p_value->>'selectionMode','ids')='ids' then
  select coalesce(array_agg(distinct value::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_value->'selectedIds','[]')) where not value::uuid=any(excluded);
 else raise exception 'VALIDATION_FAILED'; end if;
 if cardinality(ids) not between 1 and 5000 then raise exception 'BATCH_TOO_LARGE: Review 1-5000 records; narrow the filter'; end if;
 if exists(select 1 from unnest(ids) wanted where not exists(select 1 from public.lessons where id=wanted and studio_id=p_studio)) then raise exception 'FORBIDDEN'; end if;
 if scope in ('future','series') then
  anchors:=ids;
  if exists(select 1 from public.lessons where id=any(anchors) and series_id is null) then raise exception 'VALIDATION_FAILED: Choose recurring records'; end if;
  select coalesce(array_agg(id),'{}') into ids from (select distinct occurrence.id from public.lessons occurrence join public.lessons anchor on anchor.id=any(anchors) and anchor.series_id=occurrence.series_id
   where occurrence.studio_id=p_studio and not occurrence.id=any(excluded) and (scope='series' or occurrence.starts_at>=greatest(now(),anchor.starts_at)) limit 5001) bounded;
  if cardinality(ids) not between 1 and 5000 then raise exception 'BATCH_TOO_LARGE'; end if;
  select coalesce(jsonb_object_agg(s.id::text,jsonb_build_object('series',to_jsonb(s),'lessons',
    (select jsonb_agg(jsonb_build_object('id',x.id,'version',x.version) order by x.id) from public.lessons x where x.series_id=s.id))),'{}') into series_state
    from public.recurring_series s where id in(select series_id from public.lessons where id=any(anchors));
 end if;
 insert into lesson_ops.lesson_bulk_jobs(actor_id,studio_id,operation,request,review_token,series_snapshot)
  values(p_actor,p_studio,operation,p_value,encode(extensions.gen_random_bytes(32),'hex'),series_state) returning * into job;
 for l in select * from public.lessons where id=any(ids) order by starts_at,id loop
  counter:=counter+1;a:=lesson_ops.assess_bulk(l.id,operation,student,class_scope,coalesce((p_value->>'useCredit')::boolean,false));
  insert into lesson_ops.lesson_bulk_items(job_id,lesson_id,ordinal,lesson_version,assessment,fingerprint,status,reason_code)
   values(job.id,l.id,counter,l.version,a,a->>'fingerprint',case when (a->>'eligible')::boolean then 'pending' else 'blocked' end,a->>'reasonCode');
 end loop;
 a:=jsonb_build_object('jobId',job.id,'reviewToken',job.review_token,'expiresAt',job.expires_at,'count',counter,
  'eligible',(select count(*) from lesson_ops.lesson_bulk_items where job_id=job.id and status='pending'),
  'blocked',(select count(*) from lesson_ops.lesson_bulk_items where job_id=job.id and status='blocked'),
  'operation',operation,'scope',scope,'stopsFutureGeneration',operation='cancel' and scope in ('future','series'),
  'creditPolicy',case when coalesce((p_value->>'useCredit')::boolean,false) then 'retain' else 'return' end,
  'notificationPolicy',case when operation='cancel' then 'existing_cancellation_recipients' else 'none' end);
 insert into lesson_ops.lesson_bulk_requests values('preview:'||p_key,p_actor,job.id,'preview',p_value,a);
 return a;
end $$;

create function public.execute_lesson_bulk(p_actor uuid,p_job uuid,p_token text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j lesson_ops.lesson_bulk_jobs;prior lesson_ops.lesson_bulk_requests;r jsonb;series_key text;current_series jsonb;checked_item lesson_ops.lesson_bulk_items;student_id uuid;
begin
 select * into j from lesson_ops.lesson_bulk_jobs where id=p_job;
 if j.id is null or j.actor_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 perform lesson_ops.require_bulk_coach(p_actor,j.studio_id);
 if p_token is distinct from j.review_token or length(coalesce(p_key,'')) not between 8 and 200 then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext(j.studio_id::text));
 select * into j from lesson_ops.lesson_bulk_jobs where id=p_job for update;
 select * into prior from lesson_ops.lesson_bulk_requests where key='execute:'||p_key;
 if prior.key is not null then
  if prior.actor_id<>p_actor or prior.job_id<>p_job then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  return prior.result||jsonb_build_object('duplicate',true); end if;
 if j.state<>'reviewed' then raise exception 'IDEMPOTENCY_CONFLICT: This review already has an execution key'; end if;
 if j.expires_at<=now() then raise exception 'REVIEW_EXPIRED'; end if;
 if j.operation='cancel' and j.request->>'scope' in ('future','series') then
  if exists(select 1 from lesson_ops.lesson_bulk_items where job_id=j.id and status='blocked' and assessment->>'status'='scheduled') then raise exception 'REVIEW_REQUIRED: Resolve protected future occurrences before stopping generation'; end if;
  perform 1 from public.students where studio_id=j.studio_id and id in(
   select l.student_id from public.lessons l join lesson_ops.lesson_bulk_items i on i.lesson_id=l.id where i.job_id=j.id
   union select lp.student_id from public.lesson_participants lp join lesson_ops.lesson_bulk_items i on i.lesson_id=lp.lesson_id where i.job_id=j.id) order by id for update;
  for student_id in select s.id from public.students s where studio_id=j.studio_id and id in(
   select l.student_id from public.lessons l join lesson_ops.lesson_bulk_items i on i.lesson_id=l.id where i.job_id=j.id
   union select lp.student_id from public.lesson_participants lp join lesson_ops.lesson_bulk_items i on i.lesson_id=lp.lesson_id where i.job_id=j.id) order by s.id loop
   perform credit_internal.lock_upcoming(student_id);
  end loop;
  perform 1 from public.lessons where id in(select lesson_id from lesson_ops.lesson_bulk_items where job_id=j.id) order by starts_at,id for update;
  for checked_item in select * from lesson_ops.lesson_bulk_items where job_id=j.id and status='pending' order by ordinal loop
   r:=lesson_ops.assess_bulk(checked_item.lesson_id,j.operation,coalesce(j.request->>'studentContextId',j.request->'filter'->>'studentId')::uuid,
    coalesce((j.request->>'wholeClass')::boolean,false),coalesce((j.request->>'useCredit')::boolean,false));
   if r->>'fingerprint' is distinct from checked_item.fingerprint then raise exception 'VERSION_CONFLICT: Review changed series consequences'; end if;
  end loop;
  for series_key in select jsonb_object_keys(j.series_snapshot) loop
   perform 1 from public.recurring_series where id=series_key::uuid for update;
   select jsonb_build_object('series',to_jsonb(s),'lessons',(select jsonb_agg(jsonb_build_object('id',x.id,'version',x.version) order by x.id) from public.lessons x where x.series_id=s.id)) into current_series from public.recurring_series s where s.id=series_key::uuid;
   if current_series is distinct from j.series_snapshot->series_key then raise exception 'VERSION_CONFLICT: Review the series again'; end if;
  end loop;
  for series_key in select jsonb_object_keys(j.series_snapshot) loop
   update public.recurring_series set status='cancelled',updated_at=now() where id=series_key::uuid;
   insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
    values(j.studio_id,p_actor,'series.generation_stopped','recurring_series',series_key::uuid,j.request->>'reason',j.id::text,'coach_portal',j.series_snapshot->series_key,'{"status":"cancelled"}');
  end loop;
 end if;
 update lesson_ops.lesson_bulk_jobs set state='running',accepted_at=now() where id=j.id;
 r:=jsonb_build_object('jobId',j.id,'accepted',true,'duplicate',false);
 insert into lesson_ops.lesson_bulk_requests values('execute:'||p_key,p_actor,j.id,'execute',jsonb_build_object('jobId',j.id),r);
 return r;
end $$;

create function public.claim_lesson_bulk_items(p_limit integer default 10,p_job uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
 if p_limit not between 1 and 25 then raise exception 'VALIDATION_FAILED'; end if;
 update lesson_ops.lesson_bulk_items set status='failed',reason_code='worker_lease_exhausted',claim_token=null,claim_until=null,finished_at=now()
  where status='processing' and claim_until<=now() and attempts>=5 and (p_job is null or job_id=p_job);
 with wanted as (select i.id from lesson_ops.lesson_bulk_items i join lesson_ops.lesson_bulk_jobs j on j.id=i.job_id
  where j.state='running' and (p_job is null or j.id=p_job) and i.attempts<5 and
   (i.status='pending' or i.status='failed' and i.next_attempt_at<=now() or i.status='processing' and i.claim_until<=now())
  order by j.accepted_at,i.ordinal for update of i skip locked limit p_limit), claimed as (
  update lesson_ops.lesson_bulk_items i set status='processing',attempts=attempts+1,claim_token=gen_random_uuid(),claim_until=now()+interval '2 minutes'
   from wanted where i.id=wanted.id returning i.id,i.job_id,i.claim_token)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]') into rows from claimed c;
 return rows;
end $$;

create function public.process_lesson_bulk_item(p_item uuid,p_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i lesson_ops.lesson_bulk_items;j lesson_ops.lesson_bulk_jobs;a jsonb;r jsonb;t record;before_lesson public.lessons;code text;
begin
 select * into i from lesson_ops.lesson_bulk_items where id=p_item;
 select * into j from lesson_ops.lesson_bulk_jobs where id=i.job_id;
 if i.id is null then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtext(j.studio_id::text));
 select * into i from lesson_ops.lesson_bulk_items where id=p_item for update;
 if i.status='succeeded' then return i.result||jsonb_build_object('duplicate',true); end if;
 if i.status<>'processing' or i.claim_token is distinct from p_token or i.claim_until<=now() then raise exception 'VERSION_CONFLICT: Worker lease expired'; end if;
 begin
  perform set_config('lock_timeout','3s',true);
  perform lesson_ops.require_bulk_coach(j.actor_id,j.studio_id);
  -- Non-FK writers need table fencing. Locks are bounded to one record and
  -- released at RPC commit; deadlock/timeout is a recoverable item failure.
  if j.operation='delete' then
   perform pg_advisory_xact_lock(hashtext('lesson_tombstone'),hashtext(i.lesson_id::text));
   for t in select distinct c.oid,n.nspname,c.relname from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join pg_catalog.pg_attribute at on at.attrelid=c.oid join pg_catalog.pg_type ty on ty.oid=at.atttypid
    where n.nspname='public' and c.relkind='r' and at.attnum>0 and not at.attisdropped and c.relname not in ('lessons','audit_events')
     and ty.typname in ('json','jsonb','_uuid') order by c.oid loop
    execute format('lock table %I.%I in share row exclusive mode',t.nspname,t.relname);
   end loop;
  end if;
  perform 1 from public.students where studio_id=j.studio_id and id in(select student_id from public.lessons where id=i.lesson_id union select student_id from public.lesson_participants where lesson_id=i.lesson_id) order by id for update;
  perform credit_internal.lock_upcoming(s.id) from public.students s where studio_id=j.studio_id and id in(select student_id from public.lessons where id=i.lesson_id union select student_id from public.lesson_participants where lesson_id=i.lesson_id) order by s.id;
  select * into before_lesson from public.lessons where id=i.lesson_id and studio_id=j.studio_id for update;
  a:=lesson_ops.assess_bulk(i.lesson_id,j.operation,coalesce(j.request->>'studentContextId',j.request->'filter'->>'studentId')::uuid,coalesce((j.request->>'wholeClass')::boolean,false),coalesce((j.request->>'useCredit')::boolean,false));
  if a->>'fingerprint' is distinct from i.fingerprint then
   update lesson_ops.lesson_bulk_items set status='conflicted',reason_code=case when not coalesce((a->>'eligible')::boolean,false) then a->>'reasonCode' else 'dependencies_changed' end,
    result=jsonb_build_object('currentAssessment',a),claim_token=null,claim_until=null,finished_at=now() where id=i.id;
   return jsonb_build_object('status','conflicted','lessonId',i.lesson_id,'reasonCode',coalesce(a->>'reasonCode','dependencies_changed'));
  end if;
  if not (a->>'eligible')::boolean then
   update lesson_ops.lesson_bulk_items set status='skipped',reason_code=a->>'reasonCode',claim_token=null,claim_until=null,finished_at=now() where id=i.id;
   return jsonb_build_object('status','skipped','lessonId',i.lesson_id,'reasonCode',a->>'reasonCode'); end if;
  if j.operation='cancel' then
   perform set_config('app.lesson_actor',j.actor_id::text,true);perform set_config('app.lesson_reason',j.request->>'reason',true);
   perform set_config('app.lesson_class',coalesce(j.request->>'wholeClass','false'),true);
   perform set_config('app.lesson_stop_generation',case when j.request->>'scope' in ('future','series') then 'true' else 'false' end,true);
   perform set_config('app.use_credit',coalesce(j.request->>'useCredit','false'),true);
   perform set_config('app.lesson_defer_coverage','true',true);
   r:=public.command_change_lesson_state(i.lesson_id,i.lesson_version,'cancel',null,null,true);
  elsif j.operation='delete' then
   insert into lesson_ops.lesson_deletion_snapshots(lesson_id,studio_id,actor_id,job_id,reason,snapshot)
    values(i.lesson_id,j.studio_id,j.actor_id,j.id,j.request->>'reason',jsonb_build_object('lesson',to_jsonb(before_lesson),
     'participants',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.lesson_participants p where lesson_id=i.lesson_id),
     'projection',(select to_jsonb(p) from public.calendar_projections p where lesson_id=i.lesson_id),'assessment',a));
   -- Explicit removal, never a cascade-as-policy. Parent locks prevent racing FK inserts.
   delete from public.lesson_participants where lesson_id=i.lesson_id and deletion_scaffold and booking_id is null and student_id=before_lesson.student_id;
   delete from public.calendar_projections where lesson_id=i.lesson_id and status='queued' and first_attempted_at is null and claim_token is null and attempts=0 and external_event_id is null and coalesce(projected_version,0)=0;
   delete from public.lessons where id=i.lesson_id;
   r:=jsonb_build_object('deleted',true,'lessonId',i.lesson_id,'snapshotId',i.lesson_id);
  else
   insert into lesson_ops.lesson_record_state(lesson_id,studio_id) values(i.lesson_id,j.studio_id) on conflict do nothing;
   update lesson_ops.lesson_record_state set
    archived_at=case when j.operation='archive' then now() when j.operation='restore' then null else archived_at end,
    archived_by=case when j.operation='archive' then j.actor_id when j.operation='restore' then null else archived_by end,
    voided_at=case when j.operation='void' then now() else voided_at end,
    voided_by=case when j.operation='void' then j.actor_id else voided_by end,
    void_reason=case when j.operation='void' then j.request->>'reason' else void_reason end,version=version+1 where lesson_id=i.lesson_id;
   select to_jsonb(s) into r from lesson_ops.lesson_record_state s where lesson_id=i.lesson_id;
  end if;
  insert into public.audit_events(studio_id,actor_id,action,entity_type,entity_id,reason,correlation_id,source,before_state,after_state)
   values(j.studio_id,j.actor_id,'lesson.bulk_'||j.operation,'lesson',i.lesson_id,j.request->>'reason',j.id::text,'coach_portal',to_jsonb(before_lesson),r);
  update lesson_ops.lesson_bulk_items set status='succeeded',result=r,reason_code=null,claim_token=null,claim_until=null,finished_at=now() where id=i.id;
  return jsonb_build_object('status','succeeded','lessonId',i.lesson_id,'result',r);
 exception when others then
  get stacked diagnostics code=returned_sqlstate;
  update lesson_ops.lesson_bulk_items set status='failed',reason_code='execution_failed_'||code,claim_token=null,claim_until=null,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^least(attempts,6))::integer)),finished_at=now() where id=i.id;
  return jsonb_build_object('status','failed','lessonId',i.lesson_id,'reasonCode','execution_failed_'||code);
 end;
end $$;

create function public.lesson_bulk_progress(p_actor uuid,p_job uuid,p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j lesson_ops.lesson_bulk_jobs;counts jsonb;pending integer;sync_pending integer;
begin
 select * into j from lesson_ops.lesson_bulk_jobs where id=p_job;
 if j.id is null or j.actor_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 perform lesson_ops.require_bulk_coach(p_actor,j.studio_id);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
 select jsonb_build_object('total',count(*),'eligible',count(*) filter(where status<>'blocked'),'blocked',count(*) filter(where status='blocked'),
  'succeeded',count(*) filter(where status='succeeded'),'skipped',count(*) filter(where status in ('skipped','blocked')),
  'conflicted',count(*) filter(where status='conflicted'),'failed',count(*) filter(where status='failed'),
  'pending',count(*) filter(where status in ('pending','processing'))) into counts from lesson_ops.lesson_bulk_items where job_id=j.id;
 select count(*) into sync_pending from lesson_ops.lesson_bulk_items i where i.job_id=j.id and i.status='succeeded' and j.operation='cancel' and
  (exists(select 1 from public.calendar_projections where lesson_id=i.lesson_id and status<>'projected') or
   exists(select 1 from lesson_ops.effects where id in(select value::uuid from jsonb_array_elements_text(i.result->'changeEffectIds')) and status not in ('completed','superseded')) or
   exists(select 1 from lesson_ops.effects e join public.outbox_messages o on o.id=any(e.outbox_ids)
    where e.id in(select value::uuid from jsonb_array_elements_text(i.result->'changeEffectIds')) and o.status not in ('sent','cancelled')));
 pending:=(counts->>'pending')::integer;
 return jsonb_build_object('jobId',j.id,'operation',j.operation,'scope',coalesce(j.request->>'scope','selected'),'filter',j.request->'filter',
  'expiresAt',j.expires_at,'state',case when j.state='reviewed' then 'reviewed' when pending>0 then 'running' when (counts->>'failed')::integer>0 then 'needs_attention' else 'completed' end,
  'counts',counts||jsonb_build_object('synchronizationPending',sync_pending),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'lessonId',i.lesson_id,'version',i.lesson_version,'status',i.status,
     'assessment',i.assessment,'reasonCode',i.reason_code,'result',i.result,'attempts',i.attempts,'retryable',i.status='failed','nextRetryAt',case when i.status='failed' and i.attempts<5 then i.next_attempt_at end) order by i.ordinal),'[]')
    from (select * from lesson_ops.lesson_bulk_items where job_id=j.id order by ordinal offset p_offset limit p_limit) i),
  'offset',p_offset,'limit',p_limit);
end $$;

create function public.retry_lesson_bulk(p_actor uuid,p_job uuid,p_token text,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j lesson_ops.lesson_bulk_jobs;prior lesson_ops.lesson_bulk_requests;r jsonb;n integer;
begin
 select * into j from lesson_ops.lesson_bulk_jobs where id=p_job;
 if j.id is null or j.actor_id<>p_actor or j.review_token is distinct from p_token then raise exception 'FORBIDDEN'; end if;
 perform lesson_ops.require_bulk_coach(p_actor,j.studio_id);
 if length(coalesce(p_key,'')) not between 8 and 200 or j.state<>'running' then raise exception 'VALIDATION_FAILED'; end if;
 perform pg_advisory_xact_lock(hashtext(j.studio_id::text));
 select * into prior from lesson_ops.lesson_bulk_requests where key='retry:'||p_key;
 if prior.key is not null then
  if prior.actor_id<>p_actor or prior.job_id<>p_job then raise exception 'IDEMPOTENCY_CONFLICT'; end if;return prior.result; end if;
 update lesson_ops.lesson_bulk_items set status='pending',attempts=0,next_attempt_at=now(),reason_code=null,finished_at=null
  where job_id=p_job and status='failed';get diagnostics n=row_count;
 r:=jsonb_build_object('jobId',p_job,'retried',n);
 insert into lesson_ops.lesson_bulk_requests values('retry:'||p_key,p_actor,p_job,'retry','{}',r);return r;
end $$;

-- Read-only administrative history; deleted snapshots remain authorized after
-- physical removal. Neither private raw tables nor worker tokens are exposed.
create function public.lesson_record_history(p_actor uuid,p_studio uuid,p_lesson uuid,p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform lesson_ops.require_bulk_coach(p_actor,p_studio);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'VALIDATION_FAILED'; end if;
 return jsonb_build_object('lesson',(select to_jsonb(l) from public.lessons l where id=p_lesson and studio_id=p_studio),
 'state',(select to_jsonb(s) from lesson_ops.lesson_record_state s where lesson_id=p_lesson and studio_id=p_studio),
 'deletion',(select to_jsonb(d) from lesson_ops.lesson_deletion_snapshots d where lesson_id=p_lesson and studio_id=p_studio),
 'auditCount',(select count(*) from public.audit_events where studio_id=p_studio and entity_type='lesson' and entity_id=p_lesson),
 'offset',p_offset,'limit',p_limit,
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by created_at,id),'[]') from (select * from public.audit_events where studio_id=p_studio and entity_type='lesson' and entity_id=p_lesson order by created_at,id offset p_offset limit p_limit) a));
end $$;

-- Hide only from normal coach lists; portal history keeps authoritative rows.
create function public.lesson_coach_record_visible(p_lesson uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from lesson_ops.lesson_record_state s where s.lesson_id=p_lesson
   and public.is_studio_coach(s.studio_id) and (s.archived_at is not null or s.voided_at is not null))
$$;
revoke all on function public.lesson_coach_record_visible(uuid) from public,anon;
grant execute on function public.lesson_coach_record_visible(uuid) to authenticated;
create view public.lesson_list_rows with(security_invoker=true) as select l.* from public.lessons l where public.lesson_coach_record_visible(l.id);
revoke all on public.lesson_list_rows from public,anon,authenticated,service_role;
grant select on public.lesson_list_rows to authenticated,service_role;
-- The old broad coach ALL policy must not provide a cascade-delete bypass.
-- Existing authenticated reads/updates and trusted service fixture cleanup stay.
revoke delete on public.lessons from anon,authenticated;
do $$ declare definition text;begin
 if to_regprocedure('public.studio_route_snapshot(text[])') is not null then
  select pg_get_functiondef('public.studio_route_snapshot(text[])'::regprocedure) into definition;
  definition:=replace(definition,'from public.lessons t)', 'from public.lessons t where public.lesson_coach_record_visible(t.id))');
  execute definition;
 end if;
end $$;

-- Called only by the existing token-protected, non-production fixture endpoint.
-- A job qualifies only if EVERY frozen topic has this exact run prefix. This
-- exception permits synthetic fixture cleanup, never mutable production audit.
create function public.cleanup_lesson_bulk_fixture(p_run text,p_studio uuid) returns void
language plpgsql security definer set search_path='' as $$
declare jobs uuid[];
begin
 if p_run is null or p_run !~ '^e2e-[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$' then raise exception 'FORBIDDEN'; end if;
 select coalesce(array_agg(j.id),'{}') into jobs from lesson_ops.lesson_bulk_jobs j where j.studio_id=p_studio
  and exists(select 1 from lesson_ops.lesson_bulk_items where job_id=j.id)
  and not exists(select 1 from lesson_ops.lesson_bulk_items where job_id=j.id and not starts_with(coalesce(assessment->>'topic',''),p_run||' '));
 perform set_config('app.bulk_fixture_cleanup','true',true);
 delete from lesson_ops.lesson_deletion_snapshots where job_id=any(jobs) and studio_id=p_studio and starts_with(snapshot->'lesson'->>'topic',p_run||' ');
 delete from lesson_ops.lesson_record_state s where studio_id=p_studio and exists(select 1 from public.lessons l where l.id=s.lesson_id and starts_with(l.topic,p_run||' '));
 delete from lesson_ops.lesson_bulk_requests where job_id=any(jobs);
 delete from lesson_ops.lesson_bulk_items where job_id=any(jobs);
 delete from lesson_ops.lesson_bulk_jobs where id=any(jobs);
 perform set_config('app.bulk_fixture_cleanup','false',true);
end $$;

-- No default/public execute on any private implementation or privileged RPC.
revoke all on all functions in schema lesson_ops from public,anon,authenticated,service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('lesson_bulk_candidates','preview_lesson_bulk','execute_lesson_bulk','claim_lesson_bulk_items',
   'process_lesson_bulk_item','lesson_bulk_progress','retry_lesson_bulk','lesson_record_history','cleanup_lesson_bulk_fixture') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
