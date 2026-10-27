// End-to-end test of the DEPLOYED single-file bundle with an in-memory fake Supabase,
// fake Token Harbor and fake Brevo. Run:
//   node tools/bundle-support-chat.mjs && node --experimental-strip-types --test tests/support-chat.e2e.test.mjs
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const KB = fs.readFileSync(path.join(ROOT, 'knowledge.md'), 'utf8');
const ORIGIN = 'https://www.subora.com.ng';
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk', TOKENHARBOR_API_KEY: 'thk', BREVO_API_KEY: 'bk' };

/* ---------- in-memory fake of the supabase-js calls the function uses ---------- */
const db = { support_sessions: [], support_messages: [], chat_tickets: [] };
let seq = 0, msgId = 0;
const reset = () => { for (const k in db) db[k] = []; };
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.mode = 'many'; this.opts = {}; }
  select(_c, o) { this.opts = o || this.opts; return this; }
  insert(r) { this.op = 'insert'; this.rows = Array.isArray(r) ? r : [r]; return this; }
  upsert(r, o) { this.op = 'upsert'; this.rows = [r]; this.on = o.onConflict.split(','); return this; }
  update(v) { this.op = 'update'; this.vals = v; return this; }
  eq(c, v) { this.f.push(r => r[c] === v); return this; }
  gte(c, v) { this.f.push(r => r[c] >= v); return this; }
  order(c, o) { this.ord = [c, o && o.ascending === false ? -1 : 1]; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(a, b) { return Promise.resolve(this.run()).then(a, b); }
  mk(r) {
    const now = new Date().toISOString(), o = { ...r, _seq: ++seq };
    if (this.t === 'support_sessions') Object.assign(o, { id: crypto.randomUUID(), escalate_requested: false, created_at: now, last_at: now }, r);
    if (this.t === 'support_messages') Object.assign(o, { id: ++msgId, created_at: now }, r);
    if (this.t === 'chat_tickets') Object.assign(o, { id: crypto.randomUUID(), status: 'open', emailed_at: null, email_error: null, created_at: now }, r);
    return o;
  }
  run() {
    const T = db[this.t];
    if (this.op === 'insert' || this.op === 'upsert') {
      const made = [];
      for (const r of this.rows) {
        if (this.t === 'support_sessions') {
          const ex = T.find(x => x.channel === r.channel && x.external_id === r.external_id);
          if (ex) { made.push(ex); continue; }
        }
        if (this.t === 'chat_tickets' && T.some(x => x.ref === r.ref)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const o = this.mk(r); T.push(o); made.push(o);
      }
      return this.out(made);
    }
    let rows = T.filter(r => this.f.every(fn => fn(r)));
    if (this.op === 'update') { rows.forEach(r => Object.assign(r, this.vals)); return { data: null, error: null }; }
    if (this.opts.head) return { data: null, count: rows.length, error: null };
    if (this.ord) rows = [...rows].sort((a, b) => ((a[this.ord[0]] > b[this.ord[0]] ? 1 : a[this.ord[0]] < b[this.ord[0]] ? -1 : a._seq - b._seq)) * this.ord[1]);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    return this.out(rows);
  }
  out(rows) {
    if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no single row' } };
    if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  }
}
globalThis.__fakeCreateClient = () => ({ from: t => new Q(t) });

/* ---------- Deno shim + network fakes ---------- */
let handler;
globalThis.Deno = { env: { get: k => ENV[k] }, serve: h => { handler = h; } };
const net = { th: null, brevo: null, thBodies: [], mails: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.endsWith('/knowledge.md')) return new Response(KB, { status: 200 });
  if (url.includes('tokenharbor.ai')) { const b = JSON.parse(opts.body); net.thBodies.push(b); return net.th(b); }
  if (url.includes('api.brevo.com')) { const b = JSON.parse(opts.body); net.mails.push(b); return net.brevo(b); }
  throw new Error('unexpected fetch ' + url);
};
const thText = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const okMail = () => new Response('{}', { status: 201 });

before(async () => {
  let src = fs.readFileSync(path.join(ROOT, 'deploy/support-chat.single-file.ts'), 'utf8');
  src = src.replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'const createClient = globalThis.__fakeCreateClient;');
  const f = path.join(os.tmpdir(), 'support-chat-bundle-' + Date.now() + '.ts');
  fs.writeFileSync(f, src);
  await import(f);
  assert.equal(typeof handler, 'function', 'bundle did not register Deno.serve');
});
beforeEach(() => { reset(); net.th = async () => thText('Escrow holds your payment until you confirm delivery.'); net.brevo = async () => okMail(); net.thBodies = []; net.mails = []; });

let ipN = 10;
const call = (body, { ip = '9.9.9.9', origin = ORIGIN, method = 'POST' } = {}) =>
  handler(new Request('https://x.supabase.co/functions/v1/support-chat', {
    method, headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'x-forwarded-for': ip },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  }));
const sid = () => crypto.randomUUID();
const j = async (r) => ({ status: r.status, ...(await r.json()) });

test('CORS preflight, foreign origin, wrong method, bad input', async () => {
  const pre = await call({}, { method: 'OPTIONS' });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await j(await call({ session_id: sid(), message: 'hi' }, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await call({}, { method: 'GET' })).status, 405);
  assert.equal((await j(await call({ session_id: 'nope', message: 'hi' }))).error, 'bad_session_id');
  assert.equal((await j(await call({ session_id: sid(), message: '   ' }))).error, 'empty_message');
});

test('a normal question: answered by Token Harbor model 1 with the knowledge base, stored, no escalation', async () => {
  const s = sid();
  const r = await j(await call({ session_id: s, message: 'How does escrow work?' }));
  assert.equal(r.status, 200); assert.match(r.reply, /Escrow holds/); assert.equal(r.escalate, false); assert.equal(r.limited, false);
  assert.equal(net.thBodies.length, 1); assert.equal(net.thBodies[0].model, 'deepseek-v4.1-flash:free');
  assert.match(net.thBodies[0].messages[0].content, /KNOWLEDGE BASE[\s\S]*Subora knowledge base/);
  assert.deepEqual(db.support_messages.map(m => [m.role, m.provider ?? null]), [['user', null], ['assistant', 'tokenharbor:deepseek-v4.1-flash:free']]);
  assert.equal(db.support_sessions.length, 1); assert.equal(db.support_sessions[0].escalate_requested, false);
  assert.match(db.support_messages[0].ip_hash, /^[0-9a-f]{24}$/); assert.ok(!JSON.stringify(db).includes('9.9.9.9'));
});

test('follow-up question carries the earlier conversation', async () => {
  const s = sid();
  await call({ session_id: s, message: 'first question' });
  await call({ session_id: s, message: 'second question' });
  const sent = net.thBodies[1].messages.map(m => m.role + ':' + m.content.slice(0, 20));
  assert.deepEqual(sent.slice(1), ['user:first question', 'assistant:Escrow holds your pa', 'user:second question']);
  assert.equal(db.support_sessions.length, 1);
});

test('escalation marker is stripped, flagged, and remembered on the session', async () => {
  net.th = async () => thText('Sorry about that, I will pass this on.\n[[ESCALATE]]');
  const r = await j(await call({ session_id: sid(), message: 'my money is missing' }));
  assert.equal(r.escalate, true); assert.ok(!r.reply.includes('ESCALATE')); assert.match(r.reply, /pass this on/);
  assert.equal(db.support_sessions[0].escalate_requested, true);
  assert.ok(!db.support_messages[1].content.includes('ESCALATE'));
});

test('first model fails, second answers', async () => {
  let n = 0; net.th = async () => (++n === 1 ? new Response('{}', { status: 500 }) : thText('From model two.'));
  const r = await j(await call({ session_id: sid(), message: 'hi' }));
  assert.equal(r.reply, 'From model two.'); assert.equal(db.support_messages[1].provider, 'tokenharbor:mimo-v2.6-flash:free');
});

test('every model down: polite fallback with the support email, escalate on', async () => {
  net.th = async () => new Response('{}', { status: 503 });
  const r = await j(await call({ session_id: sid(), message: 'hi' }));
  assert.equal(r.status, 200); assert.equal(r.escalate, true); assert.match(r.reply, /support@subora\.com\.ng/);
  assert.equal(db.support_messages[1].provider, 'none');
});

test('rate limit: 20 messages an hour per chat, then a pause message with no model call', async () => {
  const s = sid();
  await call({ session_id: s, message: 'first' });
  const sess = db.support_sessions[0];
  for (let i = 0; i < 19; i++) db.support_messages.push({ id: ++msgId, session_id: sess.id, role: 'user', content: 'x', created_at: new Date().toISOString(), _seq: ++seq });
  net.thBodies = [];
  const r = await j(await call({ session_id: s, message: 'one too many' }));
  assert.equal(r.limited, true); assert.equal(net.thBodies.length, 0); assert.match(r.reply, /very quickly/);
});

test('ticket needs an existing chat and a valid email', async () => {
  const s = sid();
  assert.equal((await j(await call({ session_id: s, action: 'ticket', email: 'a@b.co' }))).error, 'no_session');
  await call({ session_id: s, message: 'hello' });
  assert.equal((await j(await call({ session_id: s, action: 'ticket', email: 'nope' }))).error, 'bad_email');
  assert.equal((await j(await call({ session_id: s, action: 'ticket' }))).error, 'bad_email');
  assert.equal(db.chat_tickets.length, 0);
});

test('ticket: saved, staff email with reply-to and transcript, customer confirmation, marked emailed', async () => {
  const s = sid();
  await call({ session_id: s, message: 'my payment is missing' });
  const r = await j(await call({ session_id: s, action: 'ticket', email: 'Jon@Example.com', note: 'Order 123 <b>urgent</b>' }));
  assert.equal(r.status, 200); assert.match(r.ref, /^CH-[A-Z2-9]{6}$/); assert.equal(r.emailed, true); assert.equal(r.existing, false);
  const t = db.chat_tickets[0];
  assert.equal(t.ref, r.ref); assert.equal(t.contact_email, 'jon@example.com'); assert.equal(t.channel, 'web'); assert.ok(t.emailed_at); assert.equal(t.email_error, null);
  assert.equal(net.mails.length, 2);
  const [staff, cust] = net.mails;
  assert.equal(staff.to[0].email, 'support@subora.com.ng'); assert.equal(staff.replyTo.email, 'jon@example.com');
  assert.equal(staff.sender.email, 'welcome@subora.com.ng'); assert.match(staff.subject, new RegExp('^\\[' + r.ref + '\\]'));
  assert.match(staff.htmlContent, /my payment is missing/); assert.ok(!staff.htmlContent.includes('<b>urgent</b>')); assert.match(staff.htmlContent, /&lt;b&gt;urgent&lt;\/b&gt;/);
  assert.equal(cust.to[0].email, 'jon@example.com'); assert.match(cust.textContent, new RegExp(r.ref));
  assert.equal(db.support_sessions[0].escalate_requested, true);
});

test('asking again within 30 minutes returns the same ticket and sends nothing new', async () => {
  const s = sid(); await call({ session_id: s, message: 'help' });
  const a = await j(await call({ session_id: s, action: 'ticket', email: 'a@b.co' }));
  net.mails = [];
  const b = await j(await call({ session_id: s, action: 'ticket', email: 'a@b.co' }));
  assert.equal(b.ref, a.ref); assert.equal(b.existing, true); assert.equal(net.mails.length, 0); assert.equal(db.chat_tickets.length, 1);
});

test('at most 3 tickets per visitor per day', async () => {
  const ip = '5.5.5.5';
  for (let i = 0; i < 3; i++) {
    const s = sid(); await call({ session_id: s, message: 'help ' + i }, { ip });
    assert.equal((await j(await call({ session_id: s, action: 'ticket', email: `u${i}@b.co` }, { ip }))).status, 200);
  }
  const s = sid(); await call({ session_id: s, message: 'again' }, { ip });
  const r = await j(await call({ session_id: s, action: 'ticket', email: 'u9@b.co' }, { ip }));
  assert.equal(r.status, 429); assert.equal(r.error, 'rate_limited'); assert.equal(db.chat_tickets.length, 3);
  const other = sid(); await call({ session_id: other, message: 'hi' }, { ip: '6.6.6.6' });
  assert.equal((await j(await call({ session_id: other, action: 'ticket', email: 'z@b.co' }, { ip: '6.6.6.6' }))).status, 200);
});

test('Brevo down: ticket still saved, flagged unsent, visitor still gets a reference', async () => {
  net.brevo = async () => new Response(JSON.stringify({ message: 'Key not found' }), { status: 401 });
  const s = sid(); await call({ session_id: s, message: 'help' });
  const r = await j(await call({ session_id: s, action: 'ticket', email: 'a@b.co' }));
  assert.equal(r.status, 200); assert.equal(r.emailed, false); assert.match(r.ref, /^CH-/);
  assert.equal(db.chat_tickets[0].emailed_at, null); assert.match(db.chat_tickets[0].email_error, /brevo 401/);
  assert.equal(net.mails.length, 1);
});
