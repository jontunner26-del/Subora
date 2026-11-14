// Vendor taps "Verify with Ninja": mint a one-time hosted KYC link for the signed-in vendor.
// POST (Authorization: Bearer <vendor session JWT>)  ->  { url, session_id, expires_at, sandbox }
// Deploy:  supabase functions deploy ninja-kyc-start
// Secrets: NINJA_SECRET_KEY, NINJA_FLOW_ID (vf_...), NINJA_ENV (sandbox | live); optional ALLOWED_ORIGINS, NINJA_ATTEMPTS_DAY (default 5)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { baseUrl, envOf } from "./ninja.ts";

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://www.subora.com.ng,https://subora.com.ng").split(",").map((s) => s.trim()).filter(Boolean);
const cors = (origin: string | null): Record<string, string> => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
});
const json = (b: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status, headers: { ...h, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin"); const h = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);
  if (origin && !ALLOWED.includes(origin)) return json({ error: "forbidden_origin" }, 403, h);

  const env = envOf(Deno.env.get("NINJA_ENV")); const key = Deno.env.get("NINJA_SECRET_KEY"); const flow = Deno.env.get("NINJA_FLOW_ID");
  const body = await req.json().catch(() => ({}));
  if (body && body.check === true) return json({ configured: !!(key && flow) }, 200, h);   // lets the app choose Ninja or the manual form without minting a link
  if (!key || !flow) return json({ error: "not_configured" }, 503, h);   // the app falls back to the manual form

  const SB = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("authorization") ?? "" } } });
  const { data: u } = await asUser.auth.getUser();
  if (!u?.user) return json({ error: "unauthorized" }, 401, h);
  const admin = createClient(SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: v } = await admin.from("vendors").select("id, kyc_status, suspended").eq("id", u.user.id).maybeSingle();
  if (!v) return json({ error: "not_vendor" }, 403, h);
  if (v.suspended) return json({ error: "suspended" }, 403, h);
  if (v.kyc_status === "verified") return json({ error: "already_verified" }, 409, h);
  if (v.kyc_status === "review") return json({ error: "in_review" }, 409, h);

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("ninja_kyc_sessions").select("id", { count: "exact", head: true }).eq("vendor_id", v.id).gte("created_at", since);
  if ((count ?? 0) >= Number(Deno.env.get("NINJA_ATTEMPTS_DAY") ?? 5)) return json({ error: "too_many_attempts" }, 429, h);

  const api = baseUrl(env); const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  // one live link per vendor: retire any earlier pending link first (best effort; an unopened link costs nothing)
  const { data: old } = await admin.from("ninja_kyc_sessions").select("id, ninja_verification_id").eq("vendor_id", v.id).eq("status", "pending");
  for (const o of old ?? []) {
    await fetch(`${api}/api/verifications/${encodeURIComponent(o.ninja_verification_id)}/cancel`, { method: "POST", headers: auth }).catch(() => {});
    await admin.from("ninja_kyc_sessions").update({ status: "cancelled" }).eq("id", o.id);
  }

  const sessionId = crypto.randomUUID();
  const res = await fetch(`${api}/api/flows/${encodeURIComponent(flow)}/links`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ customer_ref: sessionId, ...(u.user.email ? { customer_email: u.user.email } : {}), send_email: false }),
  }).catch(() => null);
  if (!res || !res.ok) {
    console.error("ninja-kyc-start link", res?.status);
    return json({ error: "provider_error", status: res?.status ?? 0 }, 502, h);
  }
  const link = await res.json().catch(() => null);
  if (!link || typeof link.id !== "string" || typeof link.url !== "string" || !link.url.startsWith("https://")) return json({ error: "provider_bad_response" }, 502, h);
  if (env === "live" && link.sandbox === true) {   // NINJA_FLOW_ID points at a sandbox flow while NINJA_ENV says live
    await fetch(`${api}/api/verifications/${encodeURIComponent(link.id)}/cancel`, { method: "POST", headers: auth }).catch(() => {});
    return json({ error: "config_mismatch" }, 500, h);
  }

  const { error } = await admin.from("ninja_kyc_sessions").insert({
    id: sessionId, vendor_id: v.id, ninja_verification_id: link.id, flow_id: flow, sandbox: link.sandbox === true, expires_at: link.expires_at ?? null,
  });
  if (error) {
    await fetch(`${api}/api/verifications/${encodeURIComponent(link.id)}/cancel`, { method: "POST", headers: auth }).catch(() => {});
    console.error("ninja-kyc-start insert", error.message);
    return json({ error: "server_error" }, 500, h);
  }
  return json({ url: link.url, session_id: sessionId, expires_at: link.expires_at ?? null, sandbox: link.sandbox === true }, 200, h);
});
