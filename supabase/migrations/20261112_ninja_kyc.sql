-- Ninja hosted KYC (vendor verification). Additive only: two new tables and one service-role-only function.
-- Existing kyc_submissions / admin_review_kyc are untouched: only a Ninja "review" outcome creates a kyc_submissions row,
-- so the existing trigger notifies admins and the existing review queue handles it.

create table if not exists public.ninja_kyc_sessions (
  id                    uuid primary key default gen_random_uuid(),
  vendor_id             uuid not null references public.vendors(id) on delete cascade,
  ninja_verification_id text not null unique,
  flow_id               text not null,
  sandbox               boolean not null,
  status                text not null default 'pending' check (status in ('pending','completed','cancelled')),
  outcome               text,
  score                 numeric,
  face_score            numeric,
  fields                jsonb not null default '[]'::jsonb,   -- per-field match labels and scores only, never ID numbers
  applied               boolean not null default false,        -- false = a sandbox result that was recorded but did not change the vendor
  expires_at            timestamptz,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz
);
create index if not exists ninja_kyc_sessions_vendor_idx on public.ninja_kyc_sessions (vendor_id, created_at desc);
alter table public.ninja_kyc_sessions enable row level security;
drop policy if exists ninja_kyc_owner_read on public.ninja_kyc_sessions;
create policy ninja_kyc_owner_read on public.ninja_kyc_sessions for select using (vendor_id = auth.uid() or is_admin());
-- no insert/update/delete policies: only the edge functions (service role) write

create table if not exists public.ninja_webhook_events (
  event_id    text primary key,
  received_at timestamptz not null default now()
);
alter table public.ninja_webhook_events enable row level security;   -- no policies: service role only

create or replace function public.apply_ninja_kyc_result(
  p_verification_id text, p_event_id text, p_outcome text, p_action text, p_reason text,
  p_score numeric, p_face_score numeric, p_fields jsonb, p_apply boolean
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare s ninja_kyc_sessions; v_store text; n int;
begin
  select * into s from ninja_kyc_sessions where ninja_verification_id = p_verification_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_session'); end if;

  insert into ninja_webhook_events (event_id) values (p_event_id) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 or s.status = 'completed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  update ninja_kyc_sessions
     set status = 'completed', outcome = p_outcome, score = p_score, face_score = p_face_score,
         fields = coalesce(p_fields, '[]'::jsonb), applied = p_apply, completed_at = now()
   where id = s.id;
  if not p_apply then return jsonb_build_object('ok', true, 'applied', false); end if;

  select store_name into v_store from vendors where id = s.vendor_id;

  if p_action = 'verify' then
    perform set_config('subora.staff_internal', 'on', true);
    update vendors set kyc_status = 'verified' where id = s.vendor_id;
    perform set_config('subora.staff_internal', '', true);
    perform notify(s.vendor_id, 'shield', 'Verification approved', 'Your identity was verified.', 'vendor', 'verify');
    perform audit('Ninja', 'Auto-approved KYC', s.vendor_id::text);

  elsif p_action = 'reject' then
    perform set_config('subora.staff_internal', 'on', true);
    update vendors set kyc_status = 'rejected' where id = s.vendor_id;
    perform set_config('subora.staff_internal', '', true);
    perform notify(s.vendor_id, 'shield', 'Verification not approved', coalesce(p_reason, 'You can try again.'), 'vendor', 'verify');
    perform audit('Ninja', 'Auto-rejected KYC (' || p_outcome || ')', s.vendor_id::text);

  else  -- review: hand to the existing admin queue; the kyc_submitted trigger sets vendors.kyc_status = 'review' and notifies admins
    insert into kyc_submissions (vendor_id, kind, full_name, id_number, doc_paths, details, status)
    values (s.vendor_id, 'standard', coalesce(v_store, 'Vendor'), null, '{}',
            jsonb_build_object('provider', 'ninja', 'ninja_verification_id', p_verification_id, 'outcome', p_outcome,
                               'score', p_score, 'face_score', p_face_score, 'sandbox', s.sandbox, 'fields', coalesce(p_fields, '[]'::jsonb)),
            'review');
    perform audit('Ninja', 'KYC sent to review (' || p_outcome || ')', s.vendor_id::text);
  end if;
  return jsonb_build_object('ok', true, 'applied', true, 'action', p_action);
end $$;

revoke all on function public.apply_ninja_kyc_result(text, text, text, text, text, numeric, numeric, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.apply_ninja_kyc_result(text, text, text, text, text, numeric, numeric, jsonb, boolean) to service_role;
