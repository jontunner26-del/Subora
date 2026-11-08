-- Run in the Supabase SQL editor AFTER 20261108_traffic_conversions.sql.
-- It ends with a deliberate error: "ALL CHECKS PASSED" in the error text means success. Nothing is kept.
-- Any other error text names the check that failed. Copy it to me and I will fix it.
-- It uses real accounts from your database only inside this test, and everything is rolled back.
do $$
declare
  adm uuid; u1 uuid; u2 uuid; r record;
  exp_users bigint; exp_amt numeric; exp_orders bigint; exp_gmv numeric; exp_fee numeric; exp_buyers bigint;
  failed boolean := false;
  noadmin uuid := gen_random_uuid();
begin
  -- 1. Locked down, as before
  assert not has_function_privilege('anon', 'public.traffic_report(int)', 'execute'), 'anon can run traffic_report';
  assert not has_function_privilege('anon', 'public.traffic_campaigns(int)', 'execute'), 'anon can run traffic_campaigns';
  assert has_function_privilege('authenticated', 'public.traffic_report(int)', 'execute'), 'signed-in users cannot reach traffic_report (it checks admin itself)';

  -- 2. Non-admins are refused
  perform set_config('request.jwt.claim.sub', noadmin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', noadmin::text)::text, true);
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

  -- 3. Both reports run for an admin (this is the check that catches any SQL mistake in the reports)
  select p.id into adm from public.profiles p where p.role::text = 'admin' limit 1;
  assert adm is not null, 'no admin account found in profiles';
  perform set_config('request.jwt.claim.sub', adm::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text)::text, true);
  perform * from public.traffic_report(30);
  perform * from public.traffic_campaigns(30);
  perform * from public.traffic_pages(30);
  perform * from public.traffic_daily(30);

  -- 4. The funding numbers match the raw data (uses one real account that has topped up its wallet)
  select wt.user_id into u1 from public.wallet_transactions wt
   where wt.ref like 'pay:%' and wt.amount > 0
     and not exists (select 1 from public.traffic_attributions a where a.user_id = wt.user_id)
   limit 1;
  if u1 is not null then
    insert into public.traffic_attributions (user_id, visitor_id, first_source, first_medium, first_channel, first_campaign, first_visit_at)
    values (u1, gen_random_uuid(), 'verify-fund', 'social', 'social', 'verify-campaign', now());
    select count(distinct wt.user_id), coalesce(sum(wt.amount), 0) into exp_users, exp_amt
      from public.wallet_transactions wt where wt.user_id = u1 and wt.ref like 'pay:%' and wt.amount > 0;
    select * into r from public.traffic_report(30) t where t.source = 'verify-fund';
    assert r.signups = 1, 'signups wrong for verify-fund: ' || r::text;
    assert r.funded_users = exp_users, 'funded users wrong: ' || r::text;
    assert r.funded_amount = exp_amt, 'funded amount wrong: ' || r::text;
    select * into r from public.traffic_campaigns(30) t where t.source = 'verify-fund' and t.campaign = 'verify-campaign';
    assert r.funded_amount = exp_amt, 'campaign funded amount wrong: ' || r::text;
  else
    raise notice 'No account with a wallet top-up and no source yet, so the funding check was skipped.';
  end if;

  -- 5. The order numbers match the raw data (uses one real buyer with orders)
  select od.buyer_id into u2 from public.orders od
   where od.status::text <> 'refunded'
     and not exists (select 1 from public.traffic_attributions a where a.user_id = od.buyer_id)
   limit 1;
  if u2 is not null then
    insert into public.traffic_attributions (user_id, visitor_id, first_source, first_medium, first_channel, first_campaign, first_visit_at)
    values (u2, gen_random_uuid(), 'verify-order', 'social', 'social', 'verify-campaign', now());
    select count(*), coalesce(sum(od.total), 0), coalesce(sum(od.fee), 0), count(distinct od.buyer_id)
      into exp_orders, exp_gmv, exp_fee, exp_buyers
      from public.orders od where od.buyer_id = u2 and od.status::text <> 'refunded';
    select * into r from public.traffic_report(30) t where t.source = 'verify-order';
    assert r.order_count = exp_orders, 'order count wrong: ' || r::text;
    assert r.order_value = exp_gmv, 'order value wrong: ' || r::text;
    assert r.fee_earned = exp_fee, 'fee earned wrong: ' || r::text;
    assert r.buyers = exp_buyers, 'buyers wrong: ' || r::text;
  else
    raise notice 'No buyer with orders and no source yet, so the order check was skipped.';
  end if;

  raise exception 'ALL CHECKS PASSED (nothing was kept)';
end $$;
