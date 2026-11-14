// Ninja (ninja.ng) helpers shared by ninja-kyc-start and ninja-kyc-webhook. Pure: no Deno or network calls,
// so tests/ninja.test.mjs can run them in Node. Each function folder keeps an identical copy named ninja.ts
// (the test fails if they drift): after editing this file run  cp supabase/functions/_shared/ninja.ts supabase/functions/ninja-kyc-start/ninja.ts  (and the same for ninja-kyc-webhook).

export type NinjaEnv = "sandbox" | "live";
export type Action = "verify" | "review" | "reject";
export interface Decision { action: Action; reason: string | null }
export interface NinjaEvent {
  eventId: string; verificationId: string; outcome: string; score: number | null; faceScore: number | null;
  fields: { field: string; match: string; score: number }[]; sandbox: boolean;
}

export const baseUrl = (env: NinjaEnv) => env === "live" ? "https://api.ninja.boucloud.io" : "https://api.sandbox.ninja.boucloud.io";
export const envOf = (v?: string | null): NinjaEnv => String(v ?? "sandbox").trim().toLowerCase() === "live" ? "live" : "sandbox";

const enc = new TextEncoder();
export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// X-Ninja-Signature is "hmac-sha256=<hex>" of the raw body; a bare hex digest is accepted too.
export async function verifySignature(secret: string | undefined, raw: string, header: string | null): Promise<boolean> {
  if (!secret || !header) return false;
  const hex = await hmacSha256Hex(secret, raw);
  const h = header.trim().toLowerCase();
  return safeEqual(h, "hmac-sha256=" + hex) || safeEqual(h, hex);
}

const REASONS: Record<string, string> = {
  mismatch: "The details you entered did not match your ID record. Check your name and date of birth and try again.",
  not_found: "We could not find a record for that ID number. Check the number and try again.",
  underage: "You must be 18 or older to sell on Subora.",
  face_mismatch: "Your selfie did not match the photo on your ID. Try again in good light, facing the camera.",
  liveness_failed: "The live-person check did not pass. Try again in good light, facing the camera.",
};
// verified -> approve, a clear failure -> reject (the vendor may retry), anything else (review, unknown) -> a human looks.
export function decide(outcome: string): Decision {
  const o = String(outcome ?? "").toLowerCase();
  if (o === "verified") return { action: "verify", reason: null };
  if (REASONS[o]) return { action: "reject", reason: REASONS[o] };
  return { action: "review", reason: null };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
export function parseEvent(o: any): NinjaEvent | null {
  if (!o || o.event !== "verification.completed" || !o.data) return null;
  const d = o.data;
  if (typeof o.event_id !== "string" || typeof d.verification_id !== "string" || typeof d.outcome !== "string") return null;
  const fields = Array.isArray(d.fields) ? d.fields.slice(0, 20).map((f: any) => ({
    field: String(f?.field ?? "").slice(0, 40), match: String(f?.match ?? "").slice(0, 40), score: num(f?.score) ?? 0,
  })) : [];
  return { eventId: o.event_id, verificationId: d.verification_id, outcome: d.outcome, score: num(d.score), faceScore: num(d.face_score), fields, sandbox: d.sandbox === true };
}

export interface WebhookDeps {
  raw: string; signature: string | null; secret?: string; env: NinjaEnv; sandboxApply: boolean;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}
export async function processWebhook(x: WebhookDeps): Promise<{ status: number; body: string }> {
  if (!(await verifySignature(x.secret, x.raw, x.signature))) return { status: 401, body: "bad_signature" };
  let obj: any; try { obj = JSON.parse(x.raw); } catch { return { status: 400, body: "bad_json" }; }
  const ev = parseEvent(obj);
  if (!ev) return { status: 200, body: "ignored" };
  // a sandbox event must never act in live mode, and a live event never in sandbox mode
  if ((x.env === "live") === ev.sandbox) return { status: 200, body: "ignored_environment" };
  const d = decide(ev.outcome);
  const { data, error } = await x.rpc("apply_ninja_kyc_result", {
    p_verification_id: ev.verificationId, p_event_id: ev.eventId, p_outcome: ev.outcome, p_action: d.action, p_reason: d.reason,
    p_score: ev.score, p_face_score: ev.faceScore, p_fields: ev.fields, p_apply: x.env === "live" || x.sandboxApply,
  });
  if (error) return { status: 500, body: "db_error" };   // non-2xx makes Ninja retry (1m, 5m, 30m, 2h, 6h)
  return { status: 200, body: data?.error === "unknown_session" ? "unknown_session" : "ok" };
}
