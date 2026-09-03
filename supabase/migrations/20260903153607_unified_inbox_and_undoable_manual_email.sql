-- One private inbox replaces lesson threads and class message boards. Writes
-- stay behind the authenticated server command so authorship and access are
-- always derived from the signed-in account.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  kind text not null check (kind in ('direct','class')),
  student_id uuid references public.students(id) on delete cascade,
  offering_id uuid references public.service_offerings(id) on delete cascade,
  title text not null,
  last_message_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'direct' and student_id is not null and offering_id is null)
    or (kind = 'class' and offering_id is not null and student_id is null)
  )
);

create unique index if not exists conversations_direct_student_unique
  on public.conversations(studio_id, student_id) where kind = 'direct';
create unique index if not exists conversations_class_offering_unique
  on public.conversations(studio_id, offering_id) where kind = 'class';
create index if not exists conversations_recent_idx
  on public.conversations(studio_id, last_message_at desc);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_role text not null check (author_role in ('coach','student','guardian')),
  author_name text not null,
  body text not null check (char_length(body) between 1 and 4000),
  legacy_key text unique,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_thread_idx
  on public.conversation_messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

drop policy if exists conversations_read_access on public.conversations;
create policy conversations_read_access on public.conversations
  for select to authenticated
  using (
    public.is_studio_coach(studio_id)
    or (student_id is not null and public.can_access_student(student_id))
    or (
      offering_id is not null
      and exists (
        select 1
        from public.lessons l
        join public.lesson_participants lp on lp.lesson_id = l.id
        where l.offering_id = conversations.offering_id
          and lp.student_id is not null
          and public.can_access_student(lp.student_id)
      )
    )
  );

drop policy if exists conversation_messages_read_access on public.conversation_messages;
create policy conversation_messages_read_access on public.conversation_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_messages.conversation_id
    )
  );

revoke all on public.conversations, public.conversation_messages from anon;
revoke insert, update, delete on public.conversations, public.conversation_messages from authenticated;
grant select on public.conversations, public.conversation_messages to authenticated;
grant all on public.conversations, public.conversation_messages to service_role;

-- Preserve useful history while retiring the disconnected message-board UI.
insert into public.conversations(studio_id, kind, student_id, title, last_message_at)
select s.studio_id, 'direct', s.id, s.full_name,
       coalesce(max(lm.created_at), now())
from public.lesson_messages lm
join public.students s on s.id = lm.student_id
group by s.studio_id, s.id, s.full_name
on conflict do nothing;

insert into public.conversation_messages(
  conversation_id, studio_id, author_user_id, author_role, author_name,
  body, legacy_key, created_at
)
select c.id, c.studio_id, lm.author_user_id, lm.author_role,
       case
         when lm.author_role = 'coach' then coalesce(
           (select m.display_name from public.memberships m
            where m.studio_id = c.studio_id and m.role = 'coach' limit 1),
           'Coach'
         )
         else s.full_name
       end,
       lm.body, 'lesson_message:' || lm.id::text, lm.created_at
from public.lesson_messages lm
join public.students s on s.id = lm.student_id
join public.conversations c on c.student_id = s.id and c.kind = 'direct'
on conflict (legacy_key) do nothing;

insert into public.conversations(studio_id, kind, offering_id, title, last_message_at)
select so.studio_id, 'class', so.id, so.title,
       coalesce(max(om.created_at), now())
from public.offering_messages om
join public.service_offerings so on so.id = om.offering_id
group by so.studio_id, so.id, so.title
on conflict do nothing;

insert into public.conversation_messages(
  conversation_id, studio_id, author_user_id, author_role, author_name,
  body, legacy_key, created_at
)
select c.id, c.studio_id, om.author_user_id, om.author_role, om.author_name,
       om.body, 'offering_message:' || om.id::text, om.created_at
from public.offering_messages om
join public.conversations c on c.offering_id = om.offering_id and c.kind = 'class'
on conflict (legacy_key) do nothing;

comment on table public.conversations is
  'Private direct and enrolled-class inbox threads. Writes are server-authorized.';
comment on table public.conversation_messages is
  'Messages in the unified studio inbox. deleted_at supports the short undo window.';
comment on table public.offering_messages is
  'Legacy class-board records retained for migration history; new messages use conversation_messages.';
