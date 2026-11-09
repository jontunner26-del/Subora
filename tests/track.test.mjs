// Tests for assets/track.js. They run the real script inside a fake browser, so no browser is needed.
// Run: node --test tests/track.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'track.js'), 'utf8');

const memStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
};

// Loads the tracker in a fake browser. Returns the requests it made and the window.
function load(o = {}) {
  const calls = [];
  const local = o.local || memStore();
  const session = o.session || memStore();
  const win = {
    location: { hostname: o.hostname || 'subora.com.ng', search: o.search || '', pathname: o.path || '/' },
    localStorage: o.noLocal ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } : local,
    sessionStorage: session,
    fetch: o.noFetch ? undefined : o.failFetch ? () => Promise.reject(new Error('offline')) : (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); },
    crypto: globalThis.crypto,
    doNotTrack: o.dnt || undefined,
    __subq: o.subq, __subr: o.subr, __subp: o.subp
  };
  const ctx = {
    window: win, document: { referrer: o.referrer || '' },
    navigator: { userAgent: o.ua || 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36', webdriver: !!o.webdriver, doNotTrack: o.navDnt, globalPrivacyControl: o.gpc },
    URL, URLSearchParams, Date, JSON, Math, Uint8Array, String, RegExp
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { calls, win: ctx.window, local, session };
}

const IG_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0.0';
const TT_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6';
const FB_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/430.0.0.0;]';

test('a tagged TikTok link is sent with source, medium and campaign', () => {
  const { calls } = load({ search: '?utm_source=tiktok&utm_medium=social&utm_campaign=nov-promo&utm_content=clip1', path: '/blog/escrow' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/traffic_record$/);
  const b = calls[0].body;
  assert.equal(b.p_utm_source, 'tiktok');
  assert.equal(b.p_utm_medium, 'social');
  assert.equal(b.p_utm_campaign, 'nov-promo');
  assert.equal(b.p_utm_content, 'clip1');
  assert.equal(b.p_path, '/blog/escrow');
  assert.match(b.p_visitor, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('the request carries the anon key and keepalive, and never a full URL, IP or user agent', () => {
  const { calls } = load({ search: '?utm_source=x&secret=abc', path: '/store', referrer: 'https://l.facebook.com/l.php?u=private' });
  const { init, body } = calls[0];
  assert.equal(init.keepalive, true);
  assert.ok(init.headers.apikey && init.headers.Authorization.startsWith('Bearer '));
  const text = JSON.stringify(body);
  assert.ok(!text.includes('secret') && !text.includes('l.php') && !text.includes('Mozilla'), 'private data leaked: ' + text);
  assert.deepEqual(Object.keys(body).sort(), ['p_app', 'p_path', 'p_referrer_host', 'p_utm_campaign', 'p_utm_content', 'p_utm_medium', 'p_utm_source', 'p_utm_term', 'p_visitor']);
});

test('without tags, only the referrer host name is sent', () => {
  const { calls } = load({ referrer: 'https://l.facebook.com/l.php?u=https%3A%2F%2Fsubora.com.ng' });
  assert.equal(calls[0].body.p_referrer_host, 'l.facebook.com');
  assert.equal(calls[0].body.p_utm_source, null);
});

test('a referrer from our own site is not sent', () => {
  const { calls } = load({ referrer: 'https://www.subora.com.ng/store' });
  assert.equal(calls[0].body.p_referrer_host, null);
});

test('in-app browser hints for Instagram, Facebook and TikTok', () => {
  assert.equal(load({ ua: IG_UA }).calls[0].body.p_app, 'instagram');
  assert.equal(load({ ua: FB_UA }).calls[0].body.p_app, 'facebook');
  assert.equal(load({ ua: TT_UA }).calls[0].body.p_app, 'tiktok');
  assert.equal(load({}).calls[0].body.p_app, null);
});

test('ad click ids reveal the source when there is no tag', () => {
  assert.equal(load({ search: '?ttclid=abc' }).calls[0].body.p_utm_source, 'tiktok');
  assert.equal(load({ search: '?ttclid=abc' }).calls[0].body.p_utm_medium, 'cpc');
  assert.equal(load({ search: '?gclid=abc' }).calls[0].body.p_utm_source, 'google');
  assert.equal(load({ search: '?fbclid=abc' }).calls[0].body.p_utm_source, 'facebook');
  assert.equal(load({ search: '?fbclid=abc', ua: IG_UA }).calls[0].body.p_utm_source, 'instagram');
  // an explicit tag always wins over a click id
  assert.equal(load({ search: '?utm_source=tiktok&fbclid=abc' }).calls[0].body.p_utm_source, 'tiktok');
});

test('the address the app saved before rewriting itself is used', () => {
  const { calls } = load({ search: '', path: '/store', subq: '?utm_source=instagram&utm_campaign=bio', subr: 'https://l.instagram.com/', subp: '/' });
  assert.equal(calls[0].body.p_utm_source, 'instagram');
  assert.equal(calls[0].body.p_path, '/');
  assert.equal(calls[0].body.p_referrer_host, 'l.instagram.com');
});

test('query strings and fragments never reach the path', () => {
  const { calls } = load({ path: '/listing/1?x=1#top' });
  assert.equal(calls[0].body.p_path, '/listing/1');
});

test('a visit is counted once per session, not once per page', () => {
  const session = memStore();
  const first = load({ session, path: '/' });
  const second = load({ session, path: '/blog/a', local: first.local });
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
});

test('a new campaign link inside the same session is counted', () => {
  const session = memStore();
  const a = load({ session, search: '?utm_source=tiktok&utm_campaign=one' });
  const same = load({ session, search: '?utm_source=tiktok&utm_campaign=one', local: a.local });
  const other = load({ session, search: '?utm_source=facebook&utm_campaign=two', local: a.local });
  assert.equal(a.calls.length, 1);
  assert.equal(same.calls.length, 0);
  assert.equal(other.calls.length, 1);
});

test('a visit after 30 quiet minutes counts again', () => {
  const session = memStore({ sub_last: String(Date.now() - 31 * 60 * 1000), sub_sig: '||' });
  assert.equal(load({ session }).calls.length, 1);
  const fresh = memStore({ sub_last: String(Date.now() - 5 * 60 * 1000), sub_sig: '||' });
  assert.equal(load({ session: fresh }).calls.length, 0);
});

test('the visitor id is kept between visits and replaced after 180 days', () => {
  const local = memStore();
  const a = load({ local });
  const id = a.calls[0].body.p_visitor;
  const b = load({ local, session: memStore() });
  assert.equal(b.calls[0].body.p_visitor, id);
  const old = memStore({ sub_vid: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', t: Date.now() - 181 * 864e5 }) });
  assert.notEqual(load({ local: old }).calls[0].body.p_visitor, '11111111-1111-4111-8111-111111111111');
});

test('the app can read the visitor id', () => {
  const { win, calls } = load({});
  assert.equal(win.SuboraTrack.vid(), calls[0].body.p_visitor);
});

test('nothing is sent for Do Not Track, Global Privacy Control, bots, automation, localhost or admin browsers', () => {
  assert.equal(load({ dnt: '1' }).calls.length, 0);
  assert.equal(load({ navDnt: '1' }).calls.length, 0);
  assert.equal(load({ gpc: true }).calls.length, 0);
  assert.equal(load({ ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' }).calls.length, 0);
  assert.equal(load({ ua: 'facebookexternalhit/1.1' }).calls.length, 0);
  assert.equal(load({ webdriver: true }).calls.length, 0);
  assert.equal(load({ hostname: 'localhost' }).calls.length, 0);
  assert.equal(load({ local: memStore({ sub_notrack: '1' }) }).calls.length, 0);
});

test('it still works when storage is blocked, and does nothing without fetch', () => {
  assert.equal(load({ noLocal: true, session: memStore() }).calls.length, 1);
  assert.doesNotThrow(() => load({ noFetch: true }));
});

test('a failing request is swallowed (no unhandled rejection)', async () => {
  let unhandled = false;
  const h = () => { unhandled = true; };
  process.once('unhandledRejection', h);
  load({ failFetch: true });
  await new Promise(r => setTimeout(r, 30));
  process.removeListener('unhandledRejection', h);
  assert.equal(unhandled, false);
});

// ---- cookie banner: the choice is saved by the app as sb_prefs = { cookie: 'essential' | 'all' } ----
const prefs = cookie => memStore({ sb_prefs: JSON.stringify({ ui: {}, cookie, toured: false }) });

test('Essential only: nothing is sent', () => {
  assert.equal(load({ local: prefs('essential') }).calls.length, 0);
});

test('Essential only: the stored visitor id and session keys are deleted', () => {
  const local = memStore({ sb_prefs: JSON.stringify({ cookie: 'essential' }), sub_vid: JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', t: Date.now() }) });
  const session = memStore({ sub_last: String(Date.now()), sub_sig: '||' });
  load({ local, session });
  assert.equal(local.getItem('sub_vid'), null);
  assert.equal(session.getItem('sub_last'), null);
  assert.equal(session.getItem('sub_sig'), null);
});

test('Essential only: the app gets no visitor id, so sign-ups are not linked to a source', () => {
  const { win, local } = load({ local: prefs('essential') });
  assert.equal(win.SuboraTrack.vid(), null);
  assert.equal(local.getItem('sub_vid'), null, 'no new id may be stored');
});

test('Accept all, no choice yet, or an unreadable choice: visits are counted', () => {
  assert.equal(load({ local: prefs('all') }).calls.length, 1);
  assert.equal(load({ local: prefs(false) }).calls.length, 1);
  assert.equal(load({ local: memStore({ sb_prefs: '{not json' }) }).calls.length, 1);
});

test('choosing Essential only while on the page deletes the id straight away', () => {
  const local = memStore();
  const a = load({ local });
  assert.ok(local.getItem('sub_vid'), 'an id was stored while counting');
  local.setItem('sb_prefs', JSON.stringify({ cookie: 'essential' }));
  a.win.SuboraTrack.consentChanged();
  assert.equal(local.getItem('sub_vid'), null);
  assert.equal(a.win.SuboraTrack.vid(), null, 'a cached id must not be handed out after opting out');
});

test('consentChanged does nothing when the visitor chose Accept all', () => {
  const local = memStore();
  const a = load({ local });
  local.setItem('sb_prefs', JSON.stringify({ cookie: 'all' }));
  a.win.SuboraTrack.consentChanged();
  assert.ok(local.getItem('sub_vid'));
});
