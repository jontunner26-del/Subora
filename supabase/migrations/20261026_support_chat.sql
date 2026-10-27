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
