-- Subora traffic sources, phase 3: wallet funding, orders, sales value and fee earned per source.
-- Run AFTER 20261107_traffic_tracking.sql. Safe to run more than once.
-- Wrapped in a transaction: if anything fails, nothing is kept.
--
-- How the numbers are worked out (a "cohort" view, which is the useful one for ads):
--   Take the accounts that signed up in the chosen period, grouped by the source each one FIRST came from.
--   For those accounts, add up everything they have done so far:
--     funded users / funded amount : Paystack wallet top-ups (wallet_transactions with ref 'pay:...' and amount > 0)
--     buyers / orders / order value / fee : orders that are not refunded (the same rule as the Analytics tab)
--   Recent sign-ups have had less time to fund and buy, so give a campaign a few days before judging it.
-- Reports show totals only. They never list people.

begin;

-- The return shape changes, so the old versions must be dropped first.
drop function if exists public.traffic_report(int);
drop function if exists public.traffic_campaigns(int);

create or replace function public.traffic_report(p_days int default 30)
returns table (
  source text, channel text,
  visits bigint, visitors bigint, signups bigint,
  funded_users bigint, funded_amount numeric,
  buyers bigint, order_count bigint, order_value numeric, fee_earned numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  d int := least(greatest(coalesce(p_days, 30), 1), 400);
begin
  if not public.traffic_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with cohort as (
    select ta.user_id as uid, ta.first_source as src, ta.first_channel as chn
      from public.traffic_attributions ta
     where ta.claimed_at >= now() - make_interval(days => d)
  ), v as (
    select tv.source as src, tv.channel as chn, count(*) as n_visits, count(distinct tv.visitor_id) as n_visitors
      from public.traffic_visits tv
     where tv.created_at >= now() - make_interval(days => d)
     group by tv.source, tv.channel
  ), s as (
    select c.src, c.chn, count(*) as n_signups from cohort c group by c.src, c.chn
  ), f as (
    select c.src, c.chn, count(distinct wt.user_id) as n_funded, coalesce(sum(wt.amount), 0) as amt
      from cohort c
      join public.wallet_transactions wt on wt.user_id = c.uid and wt.ref like 'pay:%' and wt.amount > 0
     group by c.src, c.chn
  ), o as (
    select c.src, c.chn, count(distinct od.buyer_id) as n_buyers, count(*) as n_orders,
           coalesce(sum(od.total), 0) as gmv, coalesce(sum(od.fee), 0) as fee
      from cohort c
      join public.orders od on od.buyer_id = c.uid and od.status::text <> 'refunded'
     group by c.src, c.chn
  ), k as (
    select v.src, v.chn from v
    union
    select s.src, s.chn from s
  )
  select k.src, k.chn,
         coalesce(v.n_visits, 0)::bigint, coalesce(v.n_visitors, 0)::bigint, coalesce(s.n_signups, 0)::bigint,
         coalesce(f.n_funded, 0)::bigint, coalesce(f.amt, 0)::numeric,
         coalesce(o.n_buyers, 0)::bigint, coalesce(o.n_orders, 0)::bigint, coalesce(o.gmv, 0)::numeric, coalesce(o.fee, 0)::numeric
    from k
    left join v on v.src = k.src and v.chn = k.chn
    left join s on s.src = k.src and s.chn = k.chn
    left join f on f.src = k.src and f.chn = k.chn
    left join o on o.src = k.src and o.chn = k.chn
   order by 3 desc, 5 desc;
end;
$$;

create or replace function public.traffic_campaigns(p_days int default 30)
returns table (
  source text, medium text, campaign text,
  visits bigint, visitors bigint, signups bigint,
  funded_users bigint, funded_amount numeric,
  buyers bigint, order_count bigint, order_value numeric, fee_earned numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  d int := least(greatest(coalesce(p_days, 30), 1), 400);
begin
  if not public.traffic_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with cohort as (
    select ta.user_id as uid, ta.first_source as src, ta.first_medium as med,
           coalesce(ta.first_campaign, '(none)') as cmp
      from public.traffic_attributions ta
     where ta.claimed_at >= now() - make_interval(days => d)
  ), v as (
    select tv.source as src, tv.medium as med, coalesce(tv.campaign, '(none)') as cmp,
           count(*) as n_visits, count(distinct tv.visitor_id) as n_visitors
      from public.traffic_visits tv
     where tv.created_at >= now() - make_interval(days => d)
     group by tv.source, tv.medium, coalesce(tv.campaign, '(none)')
  ), s as (
    select c.src, c.med, c.cmp, count(*) as n_signups from cohort c group by c.src, c.med, c.cmp
  ), f as (
    select c.src, c.med, c.cmp, count(distinct wt.user_id) as n_funded, coalesce(sum(wt.amount), 0) as amt
      from cohort c
      join public.wallet_transactions wt on wt.user_id = c.uid and wt.ref like 'pay:%' and wt.amount > 0
     group by c.src, c.med, c.cmp
  ), o as (
    select c.src, c.med, c.cmp, count(distinct od.buyer_id) as n_buyers, count(*) as n_orders,
           coalesce(sum(od.total), 0) as gmv, coalesce(sum(od.fee), 0) as fee
      from cohort c
      join public.orders od on od.buyer_id = c.uid and od.status::text <> 'refunded'
     group by c.src, c.med, c.cmp
  ), k as (
    select v.src, v.med, v.cmp from v
    union
    select s.src, s.med, s.cmp from s
  )
  select k.src, k.med, k.cmp,
         coalesce(v.n_visits, 0)::bigint, coalesce(v.n_visitors, 0)::bigint, coalesce(s.n_signups, 0)::bigint,
         coalesce(f.n_funded, 0)::bigint, coalesce(f.amt, 0)::numeric,
         coalesce(o.n_buyers, 0)::bigint, coalesce(o.n_orders, 0)::bigint, coalesce(o.gmv, 0)::numeric, coalesce(o.fee, 0)::numeric
    from k
    left join v on v.src = k.src and v.med = k.med and v.cmp = k.cmp
    left join s on s.src = k.src and s.med = k.med and s.cmp = k.cmp
    left join f on f.src = k.src and f.med = k.med and f.cmp = k.cmp
    left join o on o.src = k.src and o.med = k.med and o.cmp = k.cmp
   order by 4 desc, 6 desc
   limit 200;
end;
$$;

revoke all on function public.traffic_report(int) from public, anon;
revoke all on function public.traffic_campaigns(int) from public, anon;
grant execute on function public.traffic_report(int) to authenticated;
grant execute on function public.traffic_campaigns(int) to authenticated;

commit;
