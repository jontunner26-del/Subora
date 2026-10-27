// Website adapter for the Subora support bot.
// POST { session_id: <uuid made by the browser>, message: "<text>" }  ->  { reply, escalate }
// POST { session_id, action: "ticket", email, note? }  ->  { ref, emailed }   (escalate to human support)
import { createTicket, handleMessage, ipHash, TicketError } from "../_shared/chatcore.ts";

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://www.subora.com.ng,https://subora.com.ng").split(",").map(s => s.trim()).filter(Boolean);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ALLOWED.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (b: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(b), { status, headers: { ...h, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);
  if (origin && !ALLOWED.includes(origin)) return json({ error: "forbidden_origin" }, 403, h);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400, h); }
  const sid = String(body?.session_id ?? "");
  const message = String(body?.message ?? "").trim();
  if (!UUID.test(sid)) return json({ error: "bad_session_id" }, 400, h);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (body?.action === "ticket") {
    try {
      const t = await createTicket({ channel: "web", externalId: sid, email: String(body?.email ?? ""), note: String(body?.note ?? ""), ipHash: await ipHash(ip) });
      return json({ ref: t.ref, emailed: t.emailed, existing: t.existing }, 200, h);
    } catch (e) {
      if (e instanceof TicketError) {
        const status = e.code === "rate_limited" ? 429 : e.code === "no_session" ? 404 : 400;
        return json({ error: e.code }, status, h);
      }
      console.error("support-chat ticket", e);
      return json({ error: "server_error" }, 500, h);
    }
  }
  if (!message) return json({ error: "empty_message" }, 400, h);
  try {
    const r = await handleMessage({ channel: "web", externalId: sid, text: message, ipHash: await ipHash(ip) });
    return json({ reply: r.reply, escalate: r.escalate, limited: !!r.limited }, 200, h);
  } catch (e) {
    console.error("support-chat", e);
    return json({ error: "server_error" }, 500, h);
  }
});
