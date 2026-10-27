// Run: node --experimental-strip-types --test tests/chatbot.test.mjs   (Node 22+)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { kbForBudget, buildSystemPrompt, stripThink, parseEscalation, manusPrompt } from '../supabase/functions/_shared/pure.ts';
import { generate } from '../supabase/functions/_shared/providers.ts';

const KB = fs.readFileSync(new URL('../knowledge.md', import.meta.url), 'utf8');
const ok = (b) => ({ ok: true, status: 200, json: async () => b });
const bad = (s) => ({ ok: false, status: s, json: async () => ({}) });
const env = (o) => (k) => o[k];
const hist = [{ role: 'user', content: 'How does escrow work?' }];

test('knowledge budget keeps header and whole pages, under the limit', () => {
  const t = kbForBudget(KB, 11000);
  assert.ok(t.length <= 11000);
  assert.match(t, /# PAGE \/faq/);
  assert.match(t, /^# Subora knowledge base/);
  assert.equal(kbForBudget('short', 100), 'short');
});

test('system prompt has rules and knowledge', () => {
  const s = buildSystemPrompt('KBTEXT');
  assert.match(s, /\[\[ESCALATE\]\]/); assert.match(s, /KBTEXT/);
});

test('think blocks stripped, escalation parsed', () => {
  assert.equal(stripThink('<think>hmm</think>Hello'), 'Hello');
  assert.equal(stripThink('reasoning</think>Hi'), 'Hi');
  assert.deepEqual(parseEscalation('Sorry about that.\n[[ESCALATE]]'), { text: 'Sorry about that.', escalate: true });
  assert.deepEqual(parseEscalation('Fine.'), { text: 'Fine.', escalate: false });
});

test('manus prompt stays under the input cap', () => {
  const p = manusPrompt(buildSystemPrompt(KB), hist);
  assert.ok(p.length <= 16500, String(p.length));
  assert.match(p, /CUSTOMER: How does escrow work\?/);
});

test('chain: first Token Harbor model answers', async () => {
  const calls = [];
  const fetch = async (u, o) => { calls.push(JSON.parse(o.body).model); return ok({ choices: [{ message: { content: 'Answer A' } }] }); };
  const r = await generate({ fetch, env: env({ TOKENHARBOR_API_KEY: 'k' }) }, 'S', 'S', hist);
  assert.deepEqual(r, { text: 'Answer A', provider: 'tokenharbor:deepseek-v4.1-flash:free' });
  assert.equal(calls.length, 1);
});

test('chain: falls to second Token Harbor model on 500, then on empty content', async () => {
  let n = 0;
  const fetch = async () => { n++; return n === 1 ? bad(500) : ok({ choices: [{ message: { content: 'B' } }] }); };
  const r = await generate({ fetch, env: env({ TOKENHARBOR_API_KEY: 'k' }) }, 'S', 'S', hist);
  assert.equal(r.provider, 'tokenharbor:mimo-v2.6-flash:free');
  n = 0;
  const f2 = async () => { n++; return n === 1 ? ok({ choices: [{ message: { content: '  ' } }] }) : ok({ choices: [{ message: { content: 'C' } }] }); };
  assert.equal((await generate({ fetch: f2, env: env({ TOKENHARBOR_API_KEY: 'k' }) }, 'S', 'S', hist)).text, 'C');
});

test('chain: Manus fallback creates a task, polls, returns the result', async () => {
  let polls = 0;
  const fetch = async (u) => {
    if (u.includes('tokenharbor')) return bad(503);
    if (u.endsWith('/task.create')) return ok({ ok: true, task_id: 'T1' });
    polls++;
    if (polls === 1) return ok({ messages: [{ type: 'status_update', status_update: { agent_status: 'running' } }] });
    return ok({ messages: [
      { type: 'status_update', status_update: { agent_status: 'stopped' } },
      { type: 'assistant_message', assistant_message: { content: 'Manus answer', delivery_kind: 'result' } },
      { type: 'assistant_message', assistant_message: { content: 'opening', delivery_kind: 'opening' } }] });
  };
  let t = 0;
  const r = await generate({ fetch, env: env({ TOKENHARBOR_API_KEY: 'k', MANUS_API_KEY: 'm' }), sleep: async () => { t += 2000; }, now: () => t }, 'S', 'S', hist);
  assert.deepEqual(r, { text: 'Manus answer', provider: 'manus' });
});

test('chain: everything fails or Manus waits/times out -> null', async () => {
  const fetch = async (u) => {
    if (u.includes('tokenharbor')) throw new Error('network');
    if (u.endsWith('/task.create')) return ok({ ok: true, task_id: 'T' });
    return ok({ messages: [{ type: 'status_update', status_update: { agent_status: 'waiting' } }] });
  };
  let t = 0;
  assert.equal(await generate({ fetch, env: env({ TOKENHARBOR_API_KEY: 'k', MANUS_API_KEY: 'm' }), sleep: async () => { t += 2000; }, now: () => t }, 'S', 'S', hist), null);
  const slow = async (u) => u.includes('tokenharbor') ? bad(500) : u.endsWith('/task.create') ? ok({ ok: true, task_id: 'T' }) : ok({ messages: [{ type: 'status_update', status_update: { agent_status: 'running' } }] });
  t = 0;
  assert.equal(await generate({ fetch: slow, env: env({ TOKENHARBOR_API_KEY: 'k', MANUS_API_KEY: 'm' }), sleep: async () => { t += 2000; }, now: () => t }, 'S', 'S', hist), null);
  assert.equal(await generate({ fetch, env: env({}) }, 'S', 'S', hist), null);
});

// ---------- phase 3: escalation ----------
import { validEmail, newRef, esc, buildSupportEmail, buildUserEmail, sendTicketEmails } from '../supabase/functions/_shared/escalation.ts';

test('email validation', () => {
  assert.equal(validEmail(' Jon@Example.COM '), 'jon@example.com');
  for (const b of ['', 'a@b', 'a b@c.com', 'a@b.c', '<x@y.com>', 'a@b.com,c@d.com', 'x'.repeat(250) + '@a.com', null]) assert.equal(validEmail(b), null, String(b));
});

test('ticket refs look right and are unambiguous', () => {
  for (let i = 0; i < 200; i++) assert.match(newRef(), /^CH-[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(new Set(Array.from({ length: 50 }, () => newRef())).size, 50);
});

test('chat text is escaped in the staff email and the subject cannot be header-injected', () => {
  const t = [{ role: 'user', content: 'hi <script>alert(1)</script>\nBcc: evil@x.com' }, { role: 'assistant', content: 'a & b' }];
  const m = buildSupportEmail({ ref: 'CH-AAAAAA', channel: 'web', contactEmail: 'u@x.com', note: '<b>n</b>', sessionId: 's', transcript: t });
  assert.ok(!m.html.includes('<script>')); assert.match(m.html, /&lt;script&gt;/); assert.match(m.html, /a &amp; b/); assert.match(m.html, /&lt;b&gt;n&lt;\/b&gt;/);
  assert.ok(!/[\r\n]/.test(m.subject)); assert.match(m.subject, /^\[CH-AAAAAA\]/);
  assert.match(buildUserEmail('CH-AAAAAA').text, /CH-AAAAAA/);
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('brevo: staff email goes to support with reply-to, then a confirmation to the customer', async () => {
  const sent = [];
  const fetch = async (u, o) => { sent.push({ u, h: o.headers, b: JSON.parse(o.body) }); return { ok: true, status: 201, json: async () => ({}) }; };
  const r = await sendTicketEmails({ fetch, env: (k) => ({ BREVO_API_KEY: 'bk' })[k] },
    { ref: 'CH-AAAAAA', channel: 'web', contactEmail: 'u@x.com', note: null, sessionId: 's', transcript: [{ role: 'user', content: 'help' }] });
  assert.deepEqual(r, { ok: true });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].u, 'https://api.brevo.com/v3/smtp/email'); assert.equal(sent[0].h['api-key'], 'bk');
  assert.equal(sent[0].b.to[0].email, 'support@subora.com.ng'); assert.equal(sent[0].b.replyTo.email, 'u@x.com');
  assert.equal(sent[0].b.sender.email, 'welcome@subora.com.ng');
  assert.equal(sent[1].b.to[0].email, 'u@x.com'); assert.equal(sent[1].b.replyTo, undefined);
});

test('brevo: failures are reported, no key reported, no email means no confirmation', async () => {
  const bad = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  const base = { ref: 'CH-A', channel: 'telegram', contactEmail: null, sessionId: 's', transcript: [{ role: 'user', content: 'x' }] };
  const r1 = await sendTicketEmails({ fetch: bad, env: (k) => ({ BREVO_API_KEY: 'bk' })[k] }, base);
  assert.equal(r1.ok, false); assert.match(r1.error, /brevo 401/);
  assert.equal((await sendTicketEmails({ fetch: bad, env: () => undefined }, base)).ok, false);
  let n = 0; const good = async () => { n++; return { ok: true, status: 201, json: async () => ({}) }; };
  assert.equal((await sendTicketEmails({ fetch: good, env: (k) => ({ BREVO_API_KEY: 'bk' })[k] }, base)).ok, true);
  assert.equal(n, 1);
  const boom = async () => { throw new Error('network'); };
  assert.equal((await sendTicketEmails({ fetch: boom, env: (k) => ({ BREVO_API_KEY: 'bk' })[k] }, base)).ok, false);
});

// ---------- phase 4: widget pure helpers ----------
import { createRequire } from 'node:module';
const W = createRequire(import.meta.url)('../assets/chat-widget.js');

test('widget: only known site paths and the support email become links', () => {
  const t = W.tokens('See /safety, not and/or or /unknown. Mail support@subora.com.ng **now**');
  assert.deepEqual(t.filter(x => x.t === 'path').map(x => x.v), ['/safety']);
  assert.ok(t.some(x => x.t === 'mail' && x.v === 'support@subora.com.ng'));
  assert.ok(t.some(x => x.t === 'b' && x.v === 'now'));
  assert.ok(!t.some(x => x.t === 'path' && x.v === '/or'));
});

test('widget: email check and session ids', () => {
  assert.equal(W.validEmail(' a@b.co '), 'a@b.co');
  assert.equal(W.validEmail('nope'), '');
  assert.match(W.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
