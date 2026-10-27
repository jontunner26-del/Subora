-- Run in the Supabase SQL editor AFTER 20261027_chat_tickets.sql (and the phase 2 migration).
-- It ends with a deliberate error: "ALL CHECKS PASSED" in the error text means success. Nothing is kept.
do $$
declare s uuid; t uuid; failed boolean := false;
begin
  assert to_regclass('public.support_sessions') is not null, 'phase 2 table support_sessions missing';
  assert to_regclass('public.support_messages') is not null, 'phase 2 table support_messages missing';
  assert to_regclass('public.chat_tickets') is not null, 'chat_tickets missing';
  assert (select relrowsecurity from pg_class where oid = 'public.chat_tickets'::regclass), 'RLS is off on chat_tickets';
  assert not has_table_privilege('anon', 'public.chat_tickets', 'select'), 'anon can read chat_tickets';
  assert not has_table_privilege('authenticated', 'public.chat_tickets', 'select'), 'authenticated can read chat_tickets';
  assert not has_table_privilege('anon', 'public.chat_tickets', 'insert'), 'anon can insert chat_tickets';
  assert not has_table_privilege('anon', 'public.support_messages', 'select'), 'anon can read support_messages';

  insert into public.support_sessions (channel, external_id) values ('web', 'verify-' || gen_random_uuid()) returning id into s;
  insert into public.chat_tickets (ref, session_id, channel, contact_email, note) values ('CH-VERIFY1', s, 'web', 'a@b.co', 'hi') returning id into t;
  assert (select status from public.chat_tickets where id = t) = 'open', 'default status is not open';

  begin insert into public.chat_tickets (ref, session_id, channel) values ('CH-VERIFY1', s, 'web'); failed := false;
  exception when unique_violation then failed := true; end;
  assert failed, 'duplicate ref was accepted';

  begin insert into public.chat_tickets (ref, session_id, channel, status) values ('CH-VERIFY2', s, 'web', 'bogus'); failed := false;
  exception when check_violation then failed := true; end;
  assert failed, 'bad status was accepted';

  begin insert into public.chat_tickets (ref, session_id, channel) values ('CH-VERIFY3', s, 'sms'); failed := false;
  exception when check_violation then failed := true; end;
  assert failed, 'bad channel was accepted';

  delete from public.support_sessions where id = s;
  assert not exists (select 1 from public.chat_tickets where id = t), 'ticket did not cascade-delete with its session';

  raise exception 'ALL CHECKS PASSED (rolled back on purpose)';
end $$;
