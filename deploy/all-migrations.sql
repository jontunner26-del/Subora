-- ===== 20261026_support_chat.sql =====
-- Subora support chatbot, phase 2: sessions + messages.
-- Only the Edge Function (service role) reads or writes these tables.
-- RLS is on with NO policies and anon/authenticated have no grants, so the public API cannot touch them.
-- Staff access will be added in phase 5 through the staff admin checks.

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('web','telegram','whatsapp')),
  external_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  escalate_requested boolean not null default false,
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (channel, external_id)
);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.support_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  provider text,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_session_idx on public.support_messages (session_id, id desc);
create index if not exists support_messages_ip_idx on public.support_messages (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists support_messages_user_day_idx on public.support_messages (created_at desc) where role = 'user';

alter table public.support_sessions enable row level security;
alter table public.support_messages enable row level security;
revoke all on public.support_sessions from anon, authenticated;
revoke all on public.support_messages from anon, authenticated;

-- ===== 20261027_chat_tickets.sql =====
-- Subora support chatbot, phase 3: escalation tickets.
-- Named chat_tickets so it cannot collide with any existing support/dispute tables.
-- Only the Edge Function (service role) writes here; staff access comes in phase 5.

create table if not exists public.chat_tickets (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  session_id uuid not null references public.support_sessions(id) on delete cascade,
  channel text not null check (channel in ('web','telegram','whatsapp')),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  ip_hash text,
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists chat_tickets_session_idx on public.chat_tickets (session_id, created_at desc);
create index if not exists chat_tickets_ip_idx on public.chat_tickets (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists chat_tickets_unsent_idx on public.chat_tickets (created_at) where emailed_at is null;
create index if not exists chat_tickets_open_idx on public.chat_tickets (status, created_at desc);

alter table public.chat_tickets enable row level security;
revoke all on public.chat_tickets from anon, authenticated;
