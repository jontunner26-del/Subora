// Creates the Subora vendor KYC flow on Ninja and prints its id (vf_...).
// Sandbox:  NINJA_ENV=sandbox NINJA_SECRET_KEY=sk_sandbox_... node tools/ninja-create-flow.mjs
// Live:     NINJA_ENV=live    NINJA_SECRET_KEY=sk_...         node tools/ninja-create-flow.mjs   (after Ninja approves your KYB)
// Options:  LIVENESS=1 adds the live-person video check; PRIMARY=#0f6b2f sets the hosted page colour.
// Or create the same flow by hand in the Ninja dashboard and paste its id into NINJA_FLOW_ID. The webhook secret is shown in the flow editor.
const env = process.env.NINJA_ENV === 'live' ? 'live' : 'sandbox';
const base = env === 'live' ? 'https://api.ninja.boucloud.io' : 'https://api.sandbox.ninja.boucloud.io';
const key = process.env.NINJA_SECRET_KEY;
if (!key) { console.error('Set NINJA_SECRET_KEY'); process.exit(1); }
const site = process.env.SITE_URL || 'https://www.subora.com.ng';
const body = {
  name: 'Subora vendor KYC',
  id_types: ['nin', 'bvn'],            // selfie matching needs a registry photo, which NIN and BVN records have
  rules: {
    allow_transposed_names: true, accept_score: 0.90, review_score: 0.60, min_age: 18,
    fields: [
      { field: 'first_name', match: 'name', required: true, source: 'customer' },
      { field: 'last_name', match: 'name', required: true, source: 'customer' },
      { field: 'date_of_birth', match: 'date', required: true, source: 'customer' },
    ],
  },
  selfie_required: true,
  ...(process.env.LIVENESS ? { liveness_required: true } : {}),
  branding: { display_name: 'Subora', primary_color: process.env.PRIMARY || '#0f6b2f' },
  redirect_url: `${site}/vendor/verify`,
  webhook_url: process.env.WEBHOOK_URL || 'https://znywpatsqmmxkbqtybrr.supabase.co/functions/v1/ninja-kyc-webhook',
};
const r = await fetch(`${base}/api/flows`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const out = await r.json().catch(() => ({}));
console.log(r.status, JSON.stringify(out, null, 2));
if (!r.ok) process.exit(1);
console.log(`\nNext: supabase secrets set NINJA_ENV=${env} NINJA_FLOW_ID=${out.id ?? '<flow id>'} NINJA_SECRET_KEY=... NINJA_WEBHOOK_SECRET=<from the flow editor>`);
