alter table public.bookings
  add column if not exists in_person_location text,
  add column if not exists location_confirmed_at timestamptz;

alter table public.outbox_messages
  add column if not exists event_key text,
  add column if not exists dedupe_key text,
  add column if not exists booking_id uuid references public.bookings(id) on delete cascade,
  add column if not exists send_at timestamptz;

create unique index if not exists outbox_messages_dedupe_idx
  on public.outbox_messages(dedupe_key)
  where dedupe_key is not null;

create index if not exists outbox_messages_delivery_idx
  on public.outbox_messages(status,send_at,next_attempt_at);

update storage.buckets
set file_size_limit=52428800,
    allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp','video/mp4','audio/mpeg','audio/mp4','text/plain']
where id='studio-materials';

update public.studios
set settings = jsonb_set(
  settings,
  '{emailAutomations}',
  coalesce(settings->'emailAutomations','{}'::jsonb) || '{
    "enabled": true,
    "coachNewBooking": true,
    "studentConfirmation": true,
    "reminders": true,
    "confirmationSubject": "Your {{studioName}} booking is confirmed",
    "confirmationBody": "Hi {{studentName}},\n\nYour {{serviceName}} booking is confirmed for {{startsAt}}.\n\nManage your booking: {{manageUrl}}",
    "coachSubject": "New booking: {{studentName}} — {{serviceName}}",
    "coachBody": "{{studentName}} booked {{serviceName}} for {{startsAt}} ({{location}}). Reference: {{reference}}.",
    "reminderSubject": "Reminder: {{serviceName}} in {{hours}} hours",
    "reminderBody": "Hi {{studentName}},\n\nYour {{serviceName}} session starts at {{startsAt}}. {{meetingDetails}}",
    "paymentFailedSubject": "Payment needs attention for {{studioName}}",
    "paymentFailedBody": "We could not collect your scheduled payment. Please update your payment method within seven days."
  }'::jsonb,
  true
)
where slug='stage-story';
