-- Subora traffic sources, phase 1: database layer.
-- Run this whole file once in the Supabase SQL editor. It is wrapped in a transaction,
-- so if anything fails nothing is kept and you can fix and re-run it.
--
-- Privacy by design: a visit stores only a random visitor ID the browser makes up,
-- the landing PATH (never the query string), the campaign tags and the referrer HOST name.
-- No IP address, no user agent, no email, no name. Staff browsing is not counted.
--
-- Access: visitors can only call traffic_record (add one visit). Everything else is admin only.
-- Admin means profiles.role = 'admin', the same rule the app uses.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tracked links the admin creates (one row per campaign link)
-- ---------------------------------------------------------------------------
create table if not exists public.traffic_links (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  source text not null check (source ~ '^[a-z0-9._-]{1,40}$'),
  medium text not null default 'social' check (medium ~ '^[a-z0-9._-]{1,40}$'),
  campaign text not null check (campaign ~ '^[a-z0-9._-]{1,80}$'),
  content text check (content is null or content ~ '^[a-z0-9._-]{1,80}$'),
  destination text not null default '/' check (destination ~ '^/[A-Za-z0-9/_.~%-]{0,299}$'),
  archived boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists traffic_links_unique_idx
  on public.traffic_links (source, medium, campaign, coalesce(content, ''), destination)
  where not archived;

-- ---------------------------------------------------------------------------
-- 2. Visits (one row each time a new visit starts)
-- ---------------------------------------------------------------------------
create table if not exists public.traffic_visits (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  created_at timestamptz not null default now(),
  landing_path text not null default '/' check (length(landing_path) <= 300),
  source text not null default 'direct' check (length(source) <= 60),
  medium text not null default 'none' check (length(medium) <= 60),
  channel text not null default 'direct' check (channel in ('paid', 'social', 'search', 'email', 'referral', 'direct')),
  campaign text check (campaign is null or length(campaign) <= 100),
  content text check (content is null or length(content) <= 100),
  term text check (term is null or length(term) <= 100),
  referrer_host text check (referrer_host is null or length(referrer_host) <= 120),
  detected_by text not null default 'none' check (detected_by in ('utm', 'referrer', 'app', 'none'))
);

create index if not exists traffic_visits_created_idx on public.traffic_visits (created_at desc);
create index if not exists traffic_visits_visitor_idx on public.traffic_visits (visitor_id, created_at desc);
create index if not exists traffic_visits_source_idx on public.traffic_visits (source, created_at desc);

comment on table public.traffic_visits is
  'Anonymous visit log. Random visitor id, landing path, campaign tags and referrer host only. No IP, user agent or personal data.';

-- ---------------------------------------------------------------------------
-- 3. First-touch source of each new account (written once, right after sign-up)
-- ---------------------------------------------------------------------------
create table if not exists public.traffic_attributions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visitor_id uuid not null,
  first_source text not null,
  first_medium text not null,
  first_channel text not null,
  first_campaign text,
  first_landing_path text,
  first_visit_at timestamptz not null,
  claimed_at timestamptz not null default now()
);

create index if not exists traffic_attributions_claimed_idx on public.traffic_attributions (claimed_at desc);
create index if not exists traffic_attributions_source_idx on public.traffic_attributions (first_source, claimed_at desc);

-- ---------------------------------------------------------------------------
-- 4. Lock the tables. The public API cannot read visits or attributions at all.
--    Only the functions below (security definer) and admins through them can.
-- ---------------------------------------------------------------------------
alter table public.traffic_links enable row level security;
alter table public.traffic_visits enable row level security;
alter table public.traffic_attributions enable row level security;

revoke all on public.traffic_links from anon, authenticated;
revoke all on public.traffic_visits from anon, authenticated;
revoke all on public.traffic_attributions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.traffic_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

revoke all on function public.traffic_is_admin() from public, anon;
grant execute on function public.traffic_is_admin() to authenticated;

-- Admin-only access to the links table (create, edit, archive, delete).
grant select, insert, update, delete on public.traffic_links to authenticated;
drop policy if exists traffic_links_admin on public.traffic_links;
create policy traffic_links_admin on public.traffic_links
  for all to authenticated
  using (public.traffic_is_admin())
  with check (public.traffic_is_admin());

-- Trim, strip control characters, cap the length. Returns null for empty text.
create or replace function public.traffic_clean(p text, p_len int)
returns text
language sql
immutable
as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g')), p_len), '');
$$;

-- Works out the source, medium and channel of a visit.
-- Order of trust: explicit campaign tags (utm), then the referrer host, then the in-app browser hint.
create or replace function public.traffic_resolve(
  p_source text, p_medium text, p_host text, p_app text,
  out o_source text, out o_medium text, out o_channel text, out o_detected text)
language plpgsql
immutable
as $$
declare
  s text := lower(coalesce(public.traffic_clean(p_source, 60), ''));
  m text := lower(coalesce(public.traffic_clean(p_medium, 60), ''));
  h text := lower(coalesce(public.traffic_clean(p_host, 120), ''));
  a text := lower(coalesce(public.traffic_clean(p_app, 20), ''));
begin
  s := btrim(regexp_replace(s, '[^a-z0-9._-]+', '-', 'g'), '-');
  m := btrim(regexp_replace(m, '[^a-z0-9._-]+', '-', 'g'), '-');
  h := regexp_replace(h, '^www\.', '');

  if s <> '' then
    o_detected := 'utm';
    o_source := case
      when s ~ 'tiktok' or s in ('tt', 'tik-tok') then 'tiktok'
      when s ~ 'instagram' or s in ('ig', 'insta') then 'instagram'
      when s ~ 'facebook' or s = 'fb' then 'facebook'
      when s ~ 'twitter' or s in ('x', 'tw', 't.co') then 'x'
      when s ~ 'youtube' or s in ('yt', 'youtu.be') then 'youtube'
      when s ~ 'whatsapp' or s = 'wa' then 'whatsapp'
      when s ~ 'telegram' or s = 'tg' then 'telegram'
      when s ~ 'linkedin' then 'linkedin'
      when s ~ 'snapchat' or s = 'snap' then 'snapchat'
      when s ~ 'google' then 'google'
      else s
    end;
    o_medium := coalesce(nullif(m, ''), 'unknown');
  elsif h <> '' and h !~ '(^|\.)subora\.com\.ng$' then
    o_detected := 'referrer';
    o_source := case
      when h ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$' then 'facebook'
      when h ~ '(^|\.)instagram\.com$' then 'instagram'
      when h ~ '(^|\.)tiktok\.com$' then 'tiktok'
      when h ~ '(^|\.)(t\.co|twitter\.com|x\.com)$' then 'x'
      when h ~ '(^|\.)(youtube\.com|youtu\.be)$' then 'youtube'
      when h ~ '(^|\.)(whatsapp\.com|wa\.me)$' then 'whatsapp'
      when h ~ '(^|\.)(telegram\.org|t\.me)$' then 'telegram'
      when h ~ '(^|\.)(linkedin\.com|lnkd\.in)$' then 'linkedin'
      when h ~ '(^|\.)snapchat\.com$' then 'snapchat'
      when h ~ '(^|\.)pinterest\.[a-z.]+$' then 'pinterest'
      when h ~ '(^|\.)reddit\.com$' then 'reddit'
      when h ~ '(^|\.)nairaland\.com$' then 'nairaland'
      when h ~ '(^|\.)google\.[a-z.]+$' then 'google'
      when h ~ '(^|\.)bing\.com$' then 'bing'
      when h ~ '(^|\.)duckduckgo\.com$' then 'duckduckgo'
      when h ~ '(^|\.)yahoo\.com$' then 'yahoo'
      when h ~ '(^|\.)ecosia\.org$' then 'ecosia'
      else h
    end;
    o_medium := case
      when o_source in ('google', 'bing', 'duckduckgo', 'yahoo', 'ecosia') then 'organic'
      when o_source in ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'whatsapp', 'telegram', 'linkedin', 'snapchat', 'pinterest', 'reddit', 'nairaland') then 'social'
      else 'referral'
    end;
  elsif a in ('tiktok', 'instagram', 'facebook') then
    o_detected := 'app';
    o_source := a;
    o_medium := 'social';
  else
    o_detected := 'none';
    o_source := 'direct';
    o_medium := 'none';
  end if;

  o_channel := case
    when o_medium in ('cpc', 'ppc', 'paid', 'paid-social', 'paid_social', 'paidsocial', 'ads', 'ad', 'display', 'cpm', 'sponsored') then 'paid'
    when o_medium in ('email', 'e-mail', 'newsletter') or o_source in ('email', 'newsletter') then 'email'
    when o_source = 'direct' then 'direct'
    when o_source in ('facebook', 'instagram', 'tiktok', 'x', 'youtube', 'whatsapp', 'telegram', 'linkedin', 'snapchat', 'pinterest', 'reddit', 'threads', 'nairaland') then 'social'
    when o_source in ('google', 'bing', 'duckduckgo', 'yahoo', 'ecosia') then 'search'
    else 'referral'
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Recording a visit (the only thing the public site can call)
-- ---------------------------------------------------------------------------
create or replace function public.traffic_record(
  p_visitor uuid,
  p_path text default '/',
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_referrer_host text default null,
  p_app text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_path text;
  v_host text;
  v_campaign text;
  v_content text;
  v_term text;
begin
  if p_visitor is null then return; end if;

  -- Staff browsing the site is not counted.
  if auth.uid() is not null and public.traffic_is_admin() then return; end if;

  v_path := coalesce(public.traffic_clean(p_path, 300), '/');
  v_path := split_part(split_part(v_path, '?', 1), '#', 1);
  if v_path = '' or left(v_path, 1) <> '/' then v_path := '/'; end if;

  v_host := lower(public.traffic_clean(p_referrer_host, 120));
  v_campaign := lower(public.traffic_clean(p_utm_campaign, 100));
  v_content := lower(public.traffic_clean(p_utm_content, 100));
  v_term := lower(public.traffic_clean(p_utm_term, 100));

  select * into r from public.traffic_resolve(p_utm_source, p_utm_medium, v_host, p_app);

  -- Flood protection: per visitor and for the whole site. Extra visits are dropped silently.
  if (select count(*) from public.traffic_visits
        where visitor_id = p_visitor and created_at > now() - interval '1 hour') >= 30 then return; end if;
  if (select count(*) from public.traffic_visits
        where created_at > now() - interval '1 minute') >= 1000 then return; end if;

  -- The same visitor landing on the same page from the same source within 10 minutes counts once.
  if exists (select 1 from public.traffic_visits
              where visitor_id = p_visitor
                and created_at > now() - interval '10 minutes'
                and landing_path = v_path
                and source = r.o_source
                and medium = r.o_medium
                and campaign is not distinct from v_campaign) then return; end if;

  insert into public.traffic_visits
    (visitor_id, landing_path, source, medium, channel, campaign, content, term, referrer_host, detected_by)
  values
    (p_visitor, v_path, left(r.o_source, 60), left(r.o_medium, 60), r.o_channel,
     v_campaign, v_content, v_term, v_host, r.o_detected);
end;
$$;

revoke all on function public.traffic_record(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function public.traffic_record(uuid, text, text, text, text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Linking a brand-new account to the source it first came from
--    Only runs for accounts created in the last 3 days, so old users logging in are ignored.
--    The visitor id saved in the account at sign-up wins, because people often confirm their
--    email in a different browser from the one they signed up in.
-- ---------------------------------------------------------------------------
create or replace function public.traffic_claim(p_visitor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v record;
  vid uuid;
  meta text;
begin
  if uid is null then return; end if;
  if exists (select 1 from public.traffic_attributions where user_id = uid) then return; end if;
  if not exists (select 1 from public.profiles p where p.id = uid and p.created_at > now() - interval '3 days') then return; end if;

  select u.raw_user_meta_data ->> 'vid' into meta from auth.users u where u.id = uid;
  if meta is not null and meta ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    vid := meta::uuid;
  else
    vid := p_visitor;
  end if;
  if vid is null then return; end if;

  select * into v
    from public.traffic_visits
   where visitor_id = vid and created_at > now() - interval '30 days'
   order by created_at asc, id asc
   limit 1;

  if found then
    insert into public.traffic_attributions
      (user_id, visitor_id, first_source, first_medium, first_channel, first_campaign, first_landing_path, first_visit_at)
    values
      (uid, vid, v.source, v.medium, v.channel, v.campaign, v.landing_path, v.created_at)
    on conflict (user_id) do nothing;
  else
    -- No visit was recorded (blocked tracker, old link): count the sign-up as direct so totals add up.
    insert into public.traffic_attributions
      (user_id, visitor_id, first_source, first_medium, first_channel, first_visit_at)
    values
      (uid, vid, 'direct', 'none', 'direct', now())
    on conflict (user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.traffic_claim(uuid) from public, anon;
grant execute on function public.traffic_claim(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin reports (each one refuses anyone who is not an admin)
--    Funding and order numbers per source are added in a later phase.
-- ---------------------------------------------------------------------------
create or replace function public.traffic_report(p_days int default 30)
returns table (source text, channel text, visits bigint, visitors bigint, signups bigint)
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
  with v as (
    select tv.source as src, tv.channel as chn, count(*) as n_visits, count(distinct tv.visitor_id) as n_visitors
      from public.traffic_visits tv
     where tv.created_at >= now() - make_interval(days => d)
     group by tv.source, tv.channel
  ), s as (
    select ta.first_source as src, ta.first_channel as chn, count(*) as n_signups
      from public.traffic_attributions ta
     where ta.claimed_at >= now() - make_interval(days => d)
     group by ta.first_source, ta.first_channel
  )
  select coalesce(v.src, s.src), coalesce(v.chn, s.chn),
         coalesce(v.n_visits, 0)::bigint, coalesce(v.n_visitors, 0)::bigint, coalesce(s.n_signups, 0)::bigint
    from v full outer join s on s.src = v.src and s.chn = v.chn
   order by 3 desc, 5 desc;
end;
$$;

create or replace function public.traffic_campaigns(p_days int default 30)
returns table (source text, medium text, campaign text, visits bigint, visitors bigint, signups bigint)
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
  with v as (
    select tv.source as src, tv.medium as med, coalesce(tv.campaign, '(none)') as cmp,
           count(*) as n_visits, count(distinct tv.visitor_id) as n_visitors
      from public.traffic_visits tv
     where tv.created_at >= now() - make_interval(days => d)
     group by tv.source, tv.medium, coalesce(tv.campaign, '(none)')
  ), s as (
    select ta.first_source as src, ta.first_medium as med, coalesce(ta.first_campaign, '(none)') as cmp,
           count(*) as n_signups
      from public.traffic_attributions ta
     where ta.claimed_at >= now() - make_interval(days => d)
     group by ta.first_source, ta.first_medium, coalesce(ta.first_campaign, '(none)')
  )
  select coalesce(v.src, s.src), coalesce(v.med, s.med), coalesce(v.cmp, s.cmp),
         coalesce(v.n_visits, 0)::bigint, coalesce(v.n_visitors, 0)::bigint, coalesce(s.n_signups, 0)::bigint
    from v full outer join s on s.src = v.src and s.med = v.med and s.cmp = v.cmp
   order by 4 desc, 6 desc
   limit 200;
end;
$$;

create or replace function public.traffic_pages(p_days int default 30)
returns table (landing_path text, visits bigint, visitors bigint)
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
  select tv.landing_path, count(*)::bigint, count(distinct tv.visitor_id)::bigint
    from public.traffic_visits tv
   where tv.created_at >= now() - make_interval(days => d)
   group by tv.landing_path
   order by 2 desc
   limit 50;
end;
$$;

create or replace function public.traffic_daily(p_days int default 30)
returns table (stat_day date, visits bigint, visitors bigint, signups bigint)
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
  with v as (
    select (tv.created_at at time zone 'Africa/Lagos')::date as dy,
           count(*) as n_visits, count(distinct tv.visitor_id) as n_visitors
      from public.traffic_visits tv
     where tv.created_at >= now() - make_interval(days => d)
     group by 1
  ), s as (
    select (ta.claimed_at at time zone 'Africa/Lagos')::date as dy, count(*) as n_signups
      from public.traffic_attributions ta
     where ta.claimed_at >= now() - make_interval(days => d)
     group by 1
  )
  select coalesce(v.dy, s.dy), coalesce(v.n_visits, 0)::bigint, coalesce(v.n_visitors, 0)::bigint, coalesce(s.n_signups, 0)::bigint
    from v full outer join s on s.dy = v.dy
   order by 1;
end;
$$;

revoke all on function public.traffic_report(int) from public, anon;
revoke all on function public.traffic_campaigns(int) from public, anon;
revoke all on function public.traffic_pages(int) from public, anon;
revoke all on function public.traffic_daily(int) from public, anon;
grant execute on function public.traffic_report(int) to authenticated;
grant execute on function public.traffic_campaigns(int) to authenticated;
grant execute on function public.traffic_pages(int) to authenticated;
grant execute on function public.traffic_daily(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Retention: visits older than 400 days can be deleted. Nobody but the database owner may run it.
--    To run it every night, schedule it with pg_cron (optional):
--      select cron.schedule('traffic-purge', '15 2 * * *', 'select public.traffic_purge()');
-- ---------------------------------------------------------------------------
create or replace function public.traffic_purge()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint;
begin
  delete from public.traffic_visits where created_at < now() - interval '400 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.traffic_purge() from public, anon, authenticated;

commit;
