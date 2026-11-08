/* Subora traffic tracker (small, loaded after the page, never blocks it).
   What it sends, once per visit: a random visitor id, the landing path, the campaign tags
   (utm_*), the referrer site NAME and a hint if the visit is inside the TikTok, Instagram or
   Facebook app. It never sends an IP address, a full URL, an email, a name or any account data.
   It respects Do Not Track and Global Privacy Control, skips bots, and skips browsers where an
   admin has signed in. Every failure is silent so it can never break a page.
   The anon key below is public by design (it is also in the app). Security is in the database. */
(function () {
  'use strict';

  var API = 'https://znywpatsqmmxkbqtybrr.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXdwYXRzcW1teGticXR5YnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzAxODEsImV4cCI6MjEwNzY0NjE4MX0.F3XtaNmuOXFsC8r6UjfbtnZdxoz0HDUDtieY6bSyqqc';
  var OWN_HOST = /(^|\.)subora\.com\.ng$/i;
  var BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pagespeed|gtmetrix/i;
  var SESSION_MS = 30 * 60 * 1000;
  var VID_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

  var w = window, d = document, n = navigator;

  function store(kind) { try { return w[kind]; } catch (e) { return null; } }
  function get(kind, k) { try { return store(kind).getItem(k); } catch (e) { return null; } }
  function put(kind, k, v) { try { store(kind).setItem(k, v); } catch (e) { /* storage blocked: fine */ } }

  function uuid() {
    try { if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID(); } catch (e) { /* fall through */ }
    var b = new Uint8Array(16), i;
    try { w.crypto.getRandomValues(b); } catch (e) { for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = [];
    for (i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') + '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  var cachedId = null;
  function visitorId() {
    if (cachedId) return cachedId;
    var o = null, raw = get('localStorage', 'sub_vid');
    try { o = raw ? JSON.parse(raw) : null; } catch (e) { o = null; }
    if (!o || !o.id || !(o.t > Date.now() - VID_MAX_AGE)) {
      o = { id: uuid(), t: Date.now() };
      put('localStorage', 'sub_vid', JSON.stringify(o));
    }
    cachedId = o.id;
    return cachedId;
  }

  // Which app opened the link, if any (TikTok, Instagram and Facebook in-app browsers).
  function appHint(ua) {
    if (/Instagram/i.test(ua)) return 'instagram';
    if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
    if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'tiktok';
    return '';
  }

  function param(search, key) {
    try { return new URLSearchParams(search).get(key); } catch (e) { return null; }
  }

  function hostOf(ref) {
    if (!ref) return '';
    try {
      var h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
      return OWN_HOST.test(h) ? '' : h;
    } catch (e) { return ''; }
  }

  function clean(v, len) {
    if (v === null || v === undefined) return null;
    v = String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, len);
    return v === '' ? null : v;
  }

  // Pure function: turns what the browser knows into the fields we send.
  function buildPayload(env) {
    var q = env.search || '';
    var src = clean(param(q, 'utm_source'), 60), med = clean(param(q, 'utm_medium'), 60);
    var app = appHint(env.ua || '');
    var tagged = !!src;

    // No campaign tag: the ad platforms add their own click ids, which still tell us the source.
    if (!src) {
      if (param(q, 'ttclid')) { src = 'tiktok'; med = 'cpc'; }
      else if (param(q, 'gclid') || param(q, 'gbraid') || param(q, 'wbraid')) { src = 'google'; med = 'cpc'; }
      else if (param(q, 'msclkid')) { src = 'bing'; med = 'cpc'; }
      else if (param(q, 'fbclid')) { src = app === 'instagram' ? 'instagram' : 'facebook'; med = 'social'; }
    }

    var path = String(env.path || '/').split('?')[0].split('#')[0];
    if (path.charAt(0) !== '/') path = '/';

    return {
      tagged: tagged,
      sig: [src || '', med || '', clean(param(q, 'utm_campaign'), 100) || ''].join('|'),
      body: {
        p_path: path.slice(0, 300),
        p_utm_source: src,
        p_utm_medium: med,
        p_utm_campaign: clean(param(q, 'utm_campaign'), 100),
        p_utm_content: clean(param(q, 'utm_content'), 100),
        p_utm_term: clean(param(q, 'utm_term'), 100),
        p_referrer_host: clean(hostOf(env.referrer), 120),
        p_app: app || null
      }
    };
  }

  function skip(ua) {
    try {
      if (/^(localhost|127\.|\[::1\])/.test(w.location.hostname)) return true;
      if (n.webdriver) return true;
      if (n.doNotTrack === '1' || w.doNotTrack === '1' || n.msDoNotTrack === '1' || n.globalPrivacyControl === true) return true;
      if (BOT.test(ua || '')) return true;
      if (get('localStorage', 'sub_notrack')) return true;
    } catch (e) { return true; }
    return false;
  }

  function run() {
    var ua = n.userAgent || '';
    if (skip(ua)) return;
    if (typeof w.fetch !== 'function') return;

    // The app rewrites its own address on load, so it saves the original one first (see index.html).
    var env = {
      search: w.__subq !== undefined ? w.__subq : w.location.search,
      referrer: w.__subr !== undefined ? w.__subr : d.referrer,
      path: w.__subp !== undefined ? w.__subp : w.location.pathname,
      ua: ua
    };
    var p = buildPayload(env);

    // Count the start of a visit, not every page: a new visit begins after 30 quiet minutes,
    // or when the link carries a different campaign than the one already counted.
    var now = Date.now();
    var last = +get('sessionStorage', 'sub_last') || 0;
    var prevSig = get('sessionStorage', 'sub_sig') || '';
    var newSession = !last || now - last > SESSION_MS;
    var newCampaign = p.tagged && p.sig !== prevSig;
    put('sessionStorage', 'sub_last', String(now));
    if (!newSession && !newCampaign) return;
    put('sessionStorage', 'sub_sig', p.sig);

    p.body.p_visitor = visitorId();
    w.fetch(API + '/rest/v1/rpc/traffic_record', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: 'Bearer ' + ANON },
      body: JSON.stringify(p.body)
    }).catch(function () { /* silent */ });
  }

  // The app reads the visitor id to link a new account to its first source.
  w.SuboraTrack = { vid: visitorId, _t: { buildPayload: buildPayload, appHint: appHint, hostOf: hostOf } };

  try { run(); } catch (e) { /* never break the page */ }
})();
