// Receives Ninja's signed verification.completed event and applies it (see apply_ninja_kyc_result).
// Deploy:  supabase functions deploy ninja-kyc-webhook --no-verify-jwt     (Ninja sends no Supabase JWT)
// Secrets: NINJA_WEBHOOK_SECRET (the flow's signing secret), NINJA_ENV (sandbox | live), optional NINJA_SANDBOX_APPLY=true
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { envOf, processWebhook } from "./ninja.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const r = await processWebhook({
    raw: await req.text(),
    signature: req.headers.get("x-ninja-signature"),
    secret: Deno.env.get("NINJA_WEBHOOK_SECRET"),
    env: envOf(Deno.env.get("NINJA_ENV")),
    sandboxApply: Deno.env.get("NINJA_SANDBOX_APPLY") === "true",
    rpc: (fn, args) => admin.rpc(fn, args) as any,
  });
  if (r.status >= 400) console.error("ninja-kyc-webhook", r.status, r.body);
  return new Response(r.body, { status: r.status });
});
