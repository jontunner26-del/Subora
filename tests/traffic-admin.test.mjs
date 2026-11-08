// Tests for the admin Traffic tab. The code is cut out of index.html and run against fake data,
// so the app does not need a browser or a database. Run: node --test tests/traffic-admin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTML = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const cut = (from, to) => {
  const a = HTML.indexOf(from), b = HTML.indexOf(to, a);
  assert.ok(a > 0 && b > a, 'markers not found: ' + from);
  return HTML.slice(a, b);
};
const VIEW = cut('/* ---------- admin: traffic sources', 'function admin(){');
const HANDLERS = cut('/* admin: traffic sources */', 'H.plan_pick=');

const REP = [
  { source: 'tiktok', channel: 'social', visits: 120, visitors: 100, signups: 10, funded_users: 4, funded_amount: 20000, buyers: 3, order_count: 5, order_value: 45000, fee_earned: 4500 },
  { source: 'direct', channel: 'direct', visits: 300, visitors: 250, signups: 5, funded_users: 1, funded_amount: 5000, buyers: 1, order_count: 1, order_value: 9000, fee_earned: 900 }
];
const CAMPS = [
  { source: 'tiktok', medium: 'social', campaign: 'nov-promo', visits: 90, visitors: 80, signups: 8, funded_users: 3, funded_amount: 15000, buyers: 2, order_count: 3, order_value: 30000, fee_earned: 3000 },
  { source: 'x', medium: 'cpc', campaign: '<img src=x onerror=alert(1)>', visits: 5, visitors: 5, signups: 0, funded_users: 0, funded_amount: 0, buyers: 0, order_count: 0, order_value: 0, fee_earned: 0 },
  { source: 'facebook', medium: 'social', campaign: '=HYPERLINK("http://evil","click")', visits: 2, visitors: 2, signups: 0, funded_users: 0, funded_amount: 0, buyers: 0, order_count: 0, order_value: 0, fee_earned: 0 }
];
const PAGES = [{ landing_path: '/blog/<script>alert(1)</script>', visits: 7, visitors: 6 }, { landing_path: '/', visits: 3, visitors: 3 }];
const DAILY = Array.from({ length: 30 }, (_, i) => ({ stat_day: '2026-11-' + String(i % 28 + 1).padStart(2, '0'), visits: i, visitors: i, signups: 0 }));
const LINKS = [{ id: 'l1', name: 'TikTok · nov-promo', source: 'tiktok', medium: 'social', campaign: 'nov-promo', content: 'clip1', destination: '/escrow', archived: false }];

function setup(opts = {}) {
  const calls = { inserted: [], updated: [], toasts: [], copied: [], blobs: [], rpc: [], timers: [] };
  const inputs = { '#tr_plat': 'tiktok', '#tr_med': 'social', '#tr_cmp': 'Nov Promo!', '#tr_cnt': '', '#tr_cu': '', '#tr_pg': '/', ...(opts.inputs || {}) };
  const rpcResult = opts.rpc || (name => ({ traffic_report: { data: REP }, traffic_campaigns: { data: CAMPS }, traffic_pages: { data: PAGES }, traffic_daily: { data: DAILY } }[name]));
  const sb = {
    rpc: async (name, args) => { calls.rpc.push([name, args]); return rpcResult(name); },
    from: table => {
      const q = {
        select: () => q, order: () => q, limit: () => Promise.resolve(opts.links || { data: LINKS }),
        insert: row => ({ select: () => ({ single: async () => { calls.inserted.push([table, row]); return opts.insertResult || { data: { id: 'new1', ...row, archived: false } }; } }) }),
        update: patch => ({ eq: async (c, v) => { calls.updated.push([table, patch, c, v]); return opts.updateResult || {}; } })
      };
      return q;
    }
  };
  const ctx = {
    S: { role: 'admin', sub: 'traffic' }, sb, H: {}, HF: {},
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    N: n => '₦' + Number(n).toLocaleString(), barsHTML: (l, v) => `<div class="bars">${v.map(x => `<div><em>${x}</em><i></i></div>`).join('')}</div>`,
    render: () => { calls.renders = (calls.renders || 0) + 1; }, toast: m => calls.toasts.push(m), copyText: t => calls.copied.push(t),
    $: id => ({ value: inputs[id] }),
    setTimeout: fn => { calls.timers.push(fn); return 0; },
    URL, URLSearchParams, Blob, Promise, Math, Date, String, Number, RegExp, Object, Array, JSON, Error,
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    __blob: null
  };
  ctx.URL = Object.assign(function (...a) { return new URL(...a); }, { createObjectURL: b => { calls.blobs.push(b); return 'blob:x'; }, revokeObjectURL() {} });
  vm.createContext(ctx);
  vm.runInContext(VIEW + '\n' + HANDLERS, ctx);
  return { ctx, calls, run: code => vm.runInContext(code, ctx) };
}
const loaded = async o => { const t = setup(o); t.run('S.tr=undefined'); t.run('adminTraffic()'); await t.run('trLoad()'); return t; };

test('before the data arrives it shows loading and schedules the load', () => {
  const t = setup(); const html = t.run('adminTraffic()');
  assert.match(html, /Loading traffic/);
  assert.equal(t.calls.timers.length, 1);
  t.run('adminTraffic()'); // a second paint must not schedule another load while one is pending
  assert.equal(t.calls.timers.length, 2); // scheduled again until trLoad flips loading; trLoad itself guards re-entry
});

test('loading calls all four report functions for the chosen period', async () => {
  const t = await loaded();
  assert.deepEqual(t.calls.rpc.map(c => c[0]).sort(), ['traffic_campaigns', 'traffic_daily', 'traffic_pages', 'traffic_report']);
  assert.ok(t.calls.rpc.every(c => c[1].p_days === 30));
});

test('the tab shows sources, channels, campaigns, pages, links and the link builder', async () => {
  const t = await loaded(); const html = t.run('adminTraffic()');
  for (const s of ['By source', 'TikTok', 'Direct', 'By channel', 'By campaign', 'Top landing pages', 'Create a tracked link', 'Your tracked links', 'Download CSV', 'nov-promo']) assert.ok(html.includes(s), 'missing: ' + s);
  assert.ok(html.includes('₦45,000'), 'sales value');
  assert.ok(html.includes('420'), 'total visits = 120 + 300 ... (420)');
  assert.ok(html.includes('10%'), 'tiktok sign-up rate 10 of 100 = 10%');
});

test('visitor controlled text is escaped, never injected as HTML', async () => {
  const t = await loaded(); const html = t.run('adminTraffic()');
  assert.ok(!html.includes('<img src=x'), 'campaign name was injected as HTML');
  assert.ok(!html.includes('<script>alert'), 'page path was injected as HTML');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a missing database setup gives a clear message, and not allowed is explained', async () => {
  const t = await loaded({ rpc: () => ({ error: { message: 'Could not find the function public.traffic_report(p_days) in the schema cache', code: 'PGRST202' } }) });
  assert.match(t.run('adminTraffic()'), /not set up on the database yet/);
  const t2 = await loaded({ rpc: () => ({ error: { message: 'not allowed', code: '42501' } }) });
  assert.match(t2.run('adminTraffic()'), /Only admins/);
});

test('the link is built with the campaign tags and the www address', () => {
  const t = setup();
  assert.equal(t.run("trUrl({source:'tiktok',medium:'social',campaign:'nov-promo',content:'clip1',destination:'/escrow'})"),
    'https://www.subora.com.ng/escrow?utm_source=tiktok&utm_medium=social&utm_campaign=nov-promo&utm_content=clip1');
  assert.equal(t.run("trUrl({source:'x',medium:'cpc',campaign:'a',destination:'/'})"), 'https://www.subora.com.ng/?utm_source=x&utm_medium=cpc&utm_campaign=a');
});

test('creating a link saves a clean row', async () => {
  const t = await loaded();
  await t.run("HF.tr_new({})");
  const [table, row] = t.calls.inserted[0];
  assert.equal(table, 'traffic_links');
  assert.deepEqual(JSON.parse(JSON.stringify(row)), { name: 'TikTok · nov-promo', source: 'tiktok', medium: 'social', campaign: 'nov-promo', content: null, destination: '/' });
  assert.match(t.calls.toasts.at(-1), /Link created/);
});

test('a pasted full address is reduced to its path, and bad pages are refused', async () => {
  const ok = await loaded({ inputs: { '#tr_cu': 'https://www.subora.com.ng/blog/escrow-vs-paying-seller-whatsapp-nigeria?x=1' } });
  await ok.run('HF.tr_new({})');
  assert.equal(ok.calls.inserted[0][1].destination, '/blog/escrow-vs-paying-seller-whatsapp-nigeria');
  const bad = await loaded({ inputs: { '#tr_cu': 'javascript:alert(1)' } });
  await assert.rejects(() => bad.run('HF.tr_new({})'), /must start with \//);
  const empty = await loaded({ inputs: { '#tr_cmp': '   ' } });
  await assert.rejects(() => empty.run('HF.tr_new({})'), /Give the campaign a name/);
});

test('a duplicate link gives a friendly error', async () => {
  const t = await loaded({ insertResult: { error: { code: '23505', message: 'duplicate key' } } });
  await assert.rejects(() => t.run('HF.tr_new({})'), /already have this exact link/);
});

test('copy and archive work on the right link', async () => {
  const t = await loaded();
  await t.run("H.tr_copy(null,'l1')");
  assert.equal(t.calls.copied[0], 'https://www.subora.com.ng/escrow?utm_source=tiktok&utm_medium=social&utm_campaign=nov-promo&utm_content=clip1');
  await t.run("H.tr_arch(null,'l1')");
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls.updated[0])), ['traffic_links', { archived: true }, 'id', 'l1']);
  assert.match(t.run('adminTraffic()'), /Restore/);
});

test('the CSV is protected against spreadsheet formulas', async () => {
  const t = await loaded();
  await t.run('H.tr_export()');
  const bytes = new Uint8Array(await t.calls.blobs[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'excel byte order mark');
  const text = await t.calls.blobs[0].text();
  assert.ok(text.includes('"\'=HYPERLINK('), 'formula was not neutralised');
  assert.ok(text.includes('Traffic by source, last 30 days'));
});

test('changing the period reloads the data', async () => {
  const t = await loaded();
  await t.run("H.tr_days(null,'90')");
  assert.equal(t.run('S.tr.days'), 90);
  assert.equal(t.run('S.tr.loaded'), false);
});

test('a long chart drops the value labels and tightens the gap so it fits on a phone', async () => {
  const t = await loaded(); const html = t.run('adminTraffic()');
  const chart = html.slice(html.indexOf('class="bars"'));
  assert.match(chart.slice(0, 40), /gap:2px/);
  assert.ok(!chart.slice(0, chart.indexOf('</div></div>')).includes('<em>'), 'value labels should be removed for long charts');
});
