// Run: node --experimental-strip-types --test tests/ninja.test.mjs   (Node 22+)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { baseUrl, envOf, decide, parseEvent, verifySignature, processWebhook } from '../supabase/functions/_shared/ninja.ts';

const SECRET = 'whsec_test';
const sign = (raw) => 'hmac-sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
const evt = (o = {}, d = {}) => JSON.stringify({ event: 'verification.completed', event_id: 'evt_1', data: { verification_id: 'vs_1', outcome: 'verified', score: 0.95, face_score: 96.4, sandbox: true, fields: [{ field: 'first_name', match: 'exact', score: 1 }], ...d }, ...o });
const rpcOk = (calls) => async (fn, args) => { calls.push({ fn, args }); return { data: { ok: true }, error: null }; };
const base = (raw, extra = {}) => ({ raw, signature: sign(raw), secret: SECRET, env: 'sandbox', sandboxApply: false, ...extra });

test('copies of ninja.ts stay identical to the shared one', () => {
  const s = fs.readFileSync('supabase/functions/_shared/ninja.ts', 'utf8');
  for (const f of ['ninja-kyc-start', 'ninja-kyc-webhook']) assert.equal(fs.readFileSync(`supabase/functions/${f}/ninja.ts`, 'utf8'), s, f);
});
test('environment and base url', () => {
  assert.equal(envOf('LIVE'), 'live'); assert.equal(envOf(undefined), 'sandbox'); assert.equal(envOf('x'), 'sandbox');
  assert.equal(baseUrl('sandbox'), 'https://api.sandbox.ninja.boucloud.io'); assert.equal(baseUrl('live'), 'https://api.ninja.boucloud.io');
});
test('signature: prefixed, bare hex, tampered, missing', async () => {
  const raw = '{"a":1}'; const hex = createHmac('sha256', SECRET).update(raw).digest('hex');
  assert.ok(await verifySignature(SECRET, raw, 'hmac-sha256=' + hex)); assert.ok(await verifySignature(SECRET, raw, hex));
  assert.ok(!(await verifySignature(SECRET, raw + ' ', 'hmac-sha256=' + hex))); assert.ok(!(await verifySignature(SECRET, raw, null)));
  assert.ok(!(await verifySignature(undefined, raw, 'hmac-sha256=' + hex)));
});
test('outcomes map to approve, reject (with a vendor-facing reason) or review', () => {
  assert.deepEqual(decide('verified'), { action: 'verify', reason: null });
  for (const o of ['mismatch', 'not_found', 'underage', 'face_mismatch', 'liveness_failed']) { const d = decide(o); assert.equal(d.action, 'reject'); assert.ok(d.reason.length > 20, o); }
  assert.equal(decide('review').action, 'review'); assert.equal(decide('something_new').action, 'review'); assert.equal(decide('inactive').action, 'review');
});
test('parseEvent keeps only whitelisted fields and rejects other events', () => {
  const e = parseEvent(JSON.parse(evt({}, { fields: [{ field: 'last_name', match: 'exact_swapped', score: 1, id_number: '123' }] })));
  assert.deepEqual(e.fields, [{ field: 'last_name', match: 'exact_swapped', score: 1 }]); assert.equal(e.sandbox, true); assert.equal(e.faceScore, 96.4);
  assert.equal(parseEvent({ event: 'kyb_verification.completed', event_id: 'x', data: {} }), null); assert.equal(parseEvent(null), null);
});
test('webhook: bad signature is refused and nothing runs', async () => {
  const calls = []; const raw = evt();
  const r = await processWebhook({ ...base(raw), signature: 'hmac-sha256=00', rpc: rpcOk(calls) });
  assert.equal(r.status, 401); assert.equal(calls.length, 0);
});
test('webhook: sandbox event in sandbox mode is recorded but not applied unless opted in', async () => {
  let calls = []; const raw = evt();
  assert.equal((await processWebhook({ ...base(raw), rpc: rpcOk(calls) })).status, 200);
  assert.equal(calls[0].fn, 'apply_ninja_kyc_result'); assert.equal(calls[0].args.p_apply, false); assert.equal(calls[0].args.p_action, 'verify');
  calls = []; await processWebhook({ ...base(raw, { sandboxApply: true }), rpc: rpcOk(calls) }); assert.equal(calls[0].args.p_apply, true);
});
test('webhook: environment mismatch is acknowledged and ignored', async () => {
  const calls = [];
  assert.equal((await processWebhook({ ...base(evt(), { env: 'live' }), rpc: rpcOk(calls) })).body, 'ignored_environment');
  assert.equal((await processWebhook({ ...base(evt({}, { sandbox: false })), rpc: rpcOk(calls) })).body, 'ignored_environment'); assert.equal(calls.length, 0);
});
test('webhook: live event applies; unrelated event ignored; db error makes Ninja retry; unknown session acknowledged', async () => {
  let calls = []; const live = evt({}, { sandbox: false, outcome: 'underage' });
  assert.equal((await processWebhook({ ...base(live, { env: 'live' }), rpc: rpcOk(calls) })).status, 200);
  assert.equal(calls[0].args.p_apply, true); assert.equal(calls[0].args.p_action, 'reject'); assert.match(calls[0].args.p_reason, /18/);
  assert.equal((await processWebhook({ ...base(JSON.stringify({ event: 'other' })), rpc: rpcOk([]) })).body, 'ignored');
  assert.equal((await processWebhook({ ...base(evt()), rpc: async () => ({ data: null, error: { message: 'boom' } }) })).status, 500);
  assert.equal((await processWebhook({ ...base(evt()), rpc: async () => ({ data: { ok: false, error: 'unknown_session' }, error: null }) })).body, 'unknown_session');
});
