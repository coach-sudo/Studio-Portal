-- Repair legacy PL/pgSQL definitions without changing their signatures,
-- privileges, or business behavior. Each replacement is guarded so a future
-- replay fails visibly rather than rewriting an unexpected function body.
do $repair$
declare
  fn record;
  ddl text;
  before_change text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'command_apply_lesson_credit',
        'command_approve_outbox',
        'command_complete_lesson',
        'command_create_service_offering',
        'command_make_lesson_recurring',
        'command_remove_student',
        'command_transition',
        'confirm_booking',
        'create_booking_series_holds',
        'expire_delinquent_booking',
        'finalize_booking_cancellation',
        'finalize_subscription_termination',
        'merge_studio_students'
      )
  loop
    ddl := pg_get_functiondef(fn.oid);

    if fn.proname in (
      'command_apply_lesson_credit',
      'command_create_service_offering',
      'command_remove_student',
      'create_booking_series_holds',
      'expire_delinquent_booking',
      'finalize_booking_cancellation',
      'finalize_subscription_termination'
    ) then
      before_change := ddl;
      ddl := replace(ddl, 'uuid[]:=''{}'';', 'uuid[]:=''{}''::uuid[];');
      ddl := replace(ddl, 'uuid[] := ''{}'';', 'uuid[] := ''{}''::uuid[];');
      if ddl = before_change
        and position('uuid[]:=''{}''::uuid[];' in ddl) = 0
        and position('uuid[] := ''{}''::uuid[];' in ddl) = 0 then
        raise exception 'Expected UUID array initializer was not found in %', fn.proname;
      end if;
    end if;

    if fn.proname = 'command_approve_outbox' then
      before_change := ddl;
      ddl := replace(
        ddl,
        'if exists(select 1 from public.idempotency_keys where key=idempotency_key) then return (select response from public.idempotency_keys where key=idempotency_key); end if;',
        'if exists(select 1 from public.idempotency_keys k where k.key=command_approve_outbox.idempotency_key) then return (select k.response from public.idempotency_keys k where k.key=command_approve_outbox.idempotency_key); end if;'
      );
      if ddl = before_change and position('command_approve_outbox.idempotency_key' in ddl) = 0 then
        raise exception 'Expected idempotency lookup was not found in command_approve_outbox';
      end if;
    elsif fn.proname = 'command_transition' then
      before_change := ddl;
      ddl := replace(
        ddl,
        'if exists(select 1 from public.idempotency_keys where key=idempotency_key) then return (select response from public.idempotency_keys where key=idempotency_key); end if;',
        'if exists(select 1 from public.idempotency_keys k where k.key=command_transition.idempotency_key) then return (select k.response from public.idempotency_keys k where k.key=command_transition.idempotency_key); end if;'
      );
      if ddl = before_change and position('command_transition.idempotency_key' in ddl) = 0 then
        raise exception 'Expected idempotency lookup was not found in command_transition';
      end if;
    end if;

    if fn.proname = 'command_complete_lesson' then
      before_change := ddl;
      ddl := replace(
        ddl,
        'on conflict(lesson_id) do update set status=''queued'',last_error=null',
        'on conflict on constraint calendar_projections_lesson_id_key do update set status=''queued'',last_error=null'
      );
      if ddl = before_change and position('calendar_projections_lesson_id_key' in ddl) = 0 then
        raise exception 'Expected calendar conflict target was not found in command_complete_lesson';
      end if;
    end if;

    if fn.proname in ('command_create_service_offering', 'confirm_booking') then
      before_change := ddl;
      ddl := replace(ddl, ' idx integer;', '');
      if ddl = before_change and position('for idx in' in ddl) > 0 and position('idx integer;' in ddl) > 0 then
        raise exception 'Expected redundant idx declaration was not found in %', fn.proname;
      end if;
    end if;

    if fn.proname = 'command_make_lesson_recurring' then
      before_change := ddl;
      ddl := replace(ddl, E'  i integer;\n', '');
      if ddl = before_change and position('for i in' in ddl) > 0 and position('i integer;' in ddl) > 0 then
        raise exception 'Expected redundant i declaration was not found in command_make_lesson_recurring';
      end if;
    end if;

    if fn.proname = 'confirm_booking' then
      before_change := ddl;
      ddl := replace(
        ddl,
        'on conflict(lesson_id,email) do nothing',
        'on conflict on constraint lesson_participants_lesson_id_email_key do nothing'
      );
      if ddl = before_change and position('lesson_participants_lesson_id_email_key' in ddl) = 0 then
        raise exception 'Expected participant conflict target was not found in confirm_booking';
      end if;
    end if;

    if fn.proname in ('command_transition', 'merge_studio_students') then
      before_change := ddl;
      ddl := replace(ddl, 'public.reader_requests', 'private.reader_requests');
      if ddl = before_change and position('private.reader_requests' in ddl) = 0 then
        raise exception 'Expected reader-request reference was not found in %', fn.proname;
      end if;
    end if;

    if fn.proname in ('command_approve_outbox', 'command_complete_lesson', 'command_transition') then
      before_change := ddl;
      ddl := replace(ddl, 'encode(digest(', 'encode(extensions.digest(');
      if ddl = before_change and position('extensions.digest(' in ddl) = 0 then
        raise exception 'Expected pgcrypto digest call was not found in %', fn.proname;
      end if;
    end if;

    execute ddl;
  end loop;
end
$repair$;
