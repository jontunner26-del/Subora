-- Run in the Supabase SQL editor AFTER 20261107_traffic_tracking.sql.
-- It ends with a deliberate error: "ALL CHECKS PASSED" in the error text means success. Nothing is kept.
-- Any other error text names the check that failed. Copy it to me and I will fix it.
do $$
declare
  c int; r record; failed boolean := false;
  fake uuid := gen_random_uuid();
  vis uuid := gen_random_uuid();
begin
  -- 1. Structure and lock-down
  assert to_regclass('public.traffic_links') is not null, 'traffic_links missing';
  assert to_regclass('public.traffic_visits') is not null, 'traffic_visits missing';
  assert to_regclass('public.traffic_attributions') is not null, 'traffic_attributions missing';
  assert (select relrowsecurity from pg_class where oid = 'public.traffic_links'::regclass), 'RLS is off on traffic_links';
  assert (select relrowsecurity from pg_class where oid = 'public.traffic_visits'::regclass), 'RLS is off on traffic_visits';
  assert (select relrowsecurity from pg_class where oid = 'public.traffic_attributions'::regclass), 'RLS is off on traffic_attributions';
  assert not has_table_privilege('anon', 'public.traffic_visits', 'select'), 'anon can read traffic_visits';
  assert not has_table_privilege('anon', 'public.traffic_visits', 'insert'), 'anon can insert into traffic_visits directly';
  assert not has_table_privilege('authenticated', 'public.traffic_visits', 'select'), 'signed-in users can read traffic_visits';
  assert not has_table_privilege('anon', 'public.traffic_attributions', 'select'), 'anon can read traffic_attributions';
  assert not has_table_privilege('authenticated', 'public.traffic_attributions', 'select'), 'signed-in users can read traffic_attributions';
  assert not has_table_privilege('anon', 'public.traffic_links', 'select'), 'anon can read traffic_links';
  assert has_function_privilege('anon', 'public.traffic_record(uuid,text,text,text,text,text,text,text,text)', 'execute'), 'anon cannot record a visit';
  assert not has_function_privilege('anon', 'public.traffic_report(int)', 'execute'), 'anon can run traffic_report';
  assert not has_function_privilege('anon', 'public.traffic_claim(uuid)', 'execute'), 'anon can run traffic_claim';
  assert not has_function_privilege('authenticated', 'public.traffic_purge()', 'execute'), 'signed-in users can run traffic_purge';

  -- 2. Privacy: no personal columns in the visit log
  assert not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'traffic_visits'
       and column_name in ('ip', 'ip_address', 'ip_hash', 'user_agent', 'email', 'user_id', 'name', 'phone')
  ), 'traffic_visits has a personal data column';

  -- 3. Source detection
  select * into r from public.traffic_resolve('TikTok', 'social', null, null);
  assert r.o_source = 'tiktok' and r.o_medium = 'social' and r.o_channel = 'social' and r.o_detected = 'utm', 'utm TikTok wrong: ' || r::text;
  select * into r from public.traffic_resolve('tiktok-ads', 'cpc', null, null);
  assert r.o_source = 'tiktok' and r.o_channel = 'paid', 'paid TikTok wrong: ' || r::text;
  select * into r from public.traffic_resolve('ig', 'paid_social', null, null);
  assert r.o_source = 'instagram' and r.o_channel = 'paid', 'ig alias wrong: ' || r::text;
  select * into r from public.traffic_resolve('fb', 'social', null, null);
  assert r.o_source = 'facebook' and r.o_channel = 'social', 'fb alias wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 'l.facebook.com', null);
  assert r.o_source = 'facebook' and r.o_detected = 'referrer' and r.o_channel = 'social', 'facebook referrer wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 'l.instagram.com', null);
  assert r.o_source = 'instagram', 'instagram referrer wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 't.co', null);
  assert r.o_source = 'x', 't.co referrer wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 'www.google.com.ng', null);
  assert r.o_source = 'google' and r.o_medium = 'organic' and r.o_channel = 'search', 'google referrer wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, null, 'instagram');
  assert r.o_source = 'instagram' and r.o_detected = 'app', 'in-app hint wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 'www.subora.com.ng', null);
  assert r.o_source = 'direct' and r.o_channel = 'direct', 'own domain should be direct: ' || r::text;
  select * into r from public.traffic_resolve(null, null, 'someblog.example.org', null);
  assert r.o_source = 'someblog.example.org' and r.o_channel = 'referral', 'other site should be referral: ' || r::text;
  select * into r from public.traffic_resolve('newsletter', 'email', null, null);
  assert r.o_channel = 'email', 'email channel wrong: ' || r::text;
  select * into r from public.traffic_resolve(null, null, null, null);
  assert r.o_source = 'direct' and r.o_detected = 'none', 'empty should be direct: ' || r::text;
  -- a tag always beats the referrer
  select * into r from public.traffic_resolve('tiktok', 'social', 'l.facebook.com', 'instagram');
  assert r.o_source = 'tiktok' and r.o_detected = 'utm', 'utm should win: ' || r::text;

  -- 4. Recording
  perform public.traffic_record(vis, '/blog/escrow?secret=1#top', 'tt', 'social', 'Nov-Promo', 'Clip1', null, null, null);
  select count(*) into c from public.traffic_visits where visitor_id = vis;
  assert c = 1, 'visit was not recorded';
  select * into r from public.traffic_visits where visitor_id = vis;
  assert r.landing_path = '/blog/escrow', 'query string or fragment was kept: ' || r.landing_path;
  assert r.source = 'tiktok' and r.campaign = 'nov-promo' and r.content = 'clip1', 'visit fields wrong: ' || r::text;

  perform public.traffic_record(vis, '/blog/escrow', 'tt', 'social', 'nov-promo', null, null, null, null);
  select count(*) into c from public.traffic_visits where visitor_id = vis;
  assert c = 1, 'duplicate visit within 10 minutes was counted';

  perform public.traffic_record(vis, '/store', null, null, null, null, null, 'l.facebook.com', null);
  select count(*) into c from public.traffic_visits where visitor_id = vis;
  assert c = 2, 'second visit on another page was not recorded';

  perform public.traffic_record(null, '/', null, null, null, null, null, null, null);
  select count(*) into c from public.traffic_visits where visitor_id is null;
  assert c = 0, 'a null visitor was recorded';

  -- 5. Only admins can read reports
  perform set_config('request.jwt.claim.sub', fake::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', fake::text)::text, true);
  begin
    perform * from public.traffic_report(30);
    failed := false;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'a non-admin could read traffic_report';
  begin
    perform * from public.traffic_campaigns(30);
    failed := false;
  exception when insufficient_privilege then failed := true; end;
  assert failed, 'a non-admin could read traffic_campaigns';
  assert not public.traffic_is_admin(), 'a random user was treated as admin';

  -- 6. Claim must not raise an error for a user who has no recent account (it simply does nothing)
  perform public.traffic_claim(vis);

  raise exception 'ALL CHECKS PASSED (nothing was kept)';
end $$;
