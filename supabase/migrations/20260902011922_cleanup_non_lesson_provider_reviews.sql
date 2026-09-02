-- Reclassify only deterministic false positives already waiting in the coach
-- review queue. Nothing is deleted, and the previous matched_by value remains
-- after the unique marker so this update can be reversed exactly.
with clearly_non_lesson as (
  select id
  from public.integration_imports
  where status = 'needs_review'
    and (
      lower(payload::text) ~ '\m(newsletter|weekly digest|digest email|promotion|special offer|marketing update)\M'
      or lower(payload::text) ~ '\m(timelycare|medical|doctor|dentist|dental|therapy|therapist|healthcare|health care|clinic|patient|telehealth|prescription)\M'
      or lower(payload::text) ~ '\m(birthday|anniversary|vacation|holiday|dinner|lunch|breakfast|flight|travel|personal appointment|family event)\M'
      or (
        student_id is null
        and lower(payload::text) ~ '\mrehearsal\M'
      )
      or (
        lower(payload::text) ~ '\m(receipt|invoice|payment|payout|billing statement|refund receipt)\M'
        and lower(payload::text) !~ '\m(booked|booking confirmed|booking confirmation|lesson scheduled|session scheduled|cancelled|canceled|rescheduled)\M'
      )
      or (
        lower(payload::text) ~ '\m(inquiry|new message|unread message|review request|cancellation policy)\M'
        and lower(payload::text) !~ '\m(booked|booking confirmed|booking confirmation|lesson scheduled|session scheduled|cancelled|canceled|rescheduled)\M'
      )
      or (
        student_id is null
        and detected_source in ('google_calendar', 'gmail', 'studio_calendar')
        and lower(payload::text) ~ '\m(appointment|visit|meeting|call)\M'
        and lower(payload::text) !~ '\m(lesson|coaching|acting session|audition coaching|audition prep|voice session|scene study|class)\M'
      )
    )
)
update public.integration_imports as target
set status = 'ignored',
    matched_by = 'cleanup:cohesion_non_lesson_v1'
      || case
        when nullif(target.matched_by, '') is not null
          then ' | ' || target.matched_by
        else ''
      end,
    updated_at = now()
from clearly_non_lesson
where target.id = clearly_non_lesson.id;

-- Rollback SQL (run only if this cleanup must be reverted):
-- update public.integration_imports
-- set status = 'needs_review',
--     matched_by = nullif(regexp_replace(matched_by, '^cleanup:cohesion_non_lesson_v1(?: \\| )?', ''), ''),
--     updated_at = now()
-- where matched_by like 'cleanup:cohesion_non_lesson_v1%';
