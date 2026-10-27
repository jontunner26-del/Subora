// Channel-agnostic chat core. The website, Telegram and WhatsApp adapters all call handleMessage().
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildSystemPrompt, clampText, kbForBudget, type Msg, parseEscalation } from "./pure.ts";
import { generate } from "./providers.ts";
import { newRef, sendTicketEmails, validEmail } from "./escalation.ts";

export type Channel = "web" | "telegram" | "whatsapp";
export interface Incoming { channel: Channel; externalId: string; text: string; ipHash?: string }
export interface Reply { reply: string; escalate: boolean; sessionId: string; limited?: boolean }

const env = (k: string) => Deno.env.get(k);
const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = env("SITE_URL") ?? "https://www.subora.com.ng";
const SUPPORT = env("SUPPORT_EMAIL") ?? "support@subora.com.ng";

const FALLBACK_KB = `Subora is a Nigerian marketplace for shared subscriptions, courses and digital goods with escrow on every order. Human support: live chat in the app (Help Centre) daily 8am to 10pm WAT, or ${SUPPORT}.`;
let kbCache: { text: string; at: number } | null = null;

async function getKnowledge(): Promise<string> {
  if (kbCache && Date.now() - kbCache.at < 10 * 60_000) return kbCache.text;
  try {
    const r = await fetch(`${SITE}/knowledge.md`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const text = await r.text();
      if (text.length > 500) { kbCache = { text, at: Date.now() }; return text; }
    }
  } catch (_) { /* fall through */ }
  return kbCache?.text ?? FALLBACK_KB;
}

export async function ipHash(ip: string): Promise<string> {
  const data = new TextEncoder().encode((env("IP_SALT") ?? "subora") + ip);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

const LIMIT_SESSION_HOUR = Number(env("LIMIT_SESSION_HOUR") ?? 20);
const LIMIT_IP_HOUR = Number(env("LIMIT_IP_HOUR") ?? 40);
const LIMIT_DAILY = Number(env("LIMIT_DAILY") ?? 3000);

async function overLimit(sessionId: string, ip?: string): Promise<boolean> {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const count = (q: any) => q.then((r: any) => r.count ?? 0);
  const [s, i, g] = await Promise.all([
    count(db.from("support_messages").select("id", { count: "exact", head: true }).eq("session_id", sessionId).eq("role", "user").gte("created_at", hourAgo)),
    ip ? count(db.from("support_messages").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", hourAgo)) : Promise.resolve(0),
    count(db.from("support_messages").select("id", { count: "exact", head: true }).eq("role", "user").gte("created_at", dayAgo)),
  ]);
  return s >= LIMIT_SESSION_HOUR || i >= LIMIT_IP_HOUR || g >= LIMIT_DAILY;
}

export async function handleMessage(inc: Incoming): Promise<Reply> {
  const text = clampText(inc.text, 1000);
  const { data: sess, error: se } = await db.from("support_sessions")
    .upsert({ channel: inc.channel, external_id: inc.externalId }, { onConflict: "channel,external_id" })
    .select("id").single();
  if (se || !sess) throw new Error("session: " + (se?.message ?? "none"));
  const sessionId: string = sess.id;

  if (await overLimit(sessionId, inc.ipHash)) {
    return {
      sessionId, escalate: true, limited: true,
      reply: `You are sending messages very quickly, so I need to pause. Please try again in a little while, or reach our team at ${SUPPORT}.`,
    };
  }

  const { data: rows } = await db.from("support_messages")
    .select("role, content").eq("session_id", sessionId).order("id", { ascending: false }).limit(10);
  const history: Msg[] = [...(rows ?? [])].reverse().map((r: any) => ({ role: r.role, content: r.content }));
  history.push({ role: "user", content: text });

  const kb = await getKnowledge();
  const system = buildSystemPrompt(kb);
  const manusSystem = buildSystemPrompt(kbForBudget(kb, 11000));
  const out = await generate({ fetch, env, log: console.log }, system, manusSystem, history);

  let reply: string, escalate: boolean, provider: string;
  if (out) {
    const p = parseEscalation(out.text);
    reply = p.text || "Sorry, I could not put that into words. Please try rephrasing, or I can pass this to our team.";
    escalate = p.escalate; provider = out.provider;
  } else {
    reply = `I am having trouble answering right now. Please chat with our team in the app Help Centre (daily 8am to 10pm WAT) or email ${SUPPORT}.`;
    escalate = true; provider = "none";
  }

  await db.from("support_messages").insert([
    { session_id: sessionId, role: "user", content: text, ip_hash: inc.ipHash ?? null },
    { session_id: sessionId, role: "assistant", content: reply, provider },
  ]);
  await db.from("support_sessions").update({
    last_at: new Date().toISOString(),
    ...(escalate ? { escalate_requested: true } : {}),
  }).eq("id", sessionId);

  return { reply, escalate, sessionId };
}

export type TicketCode = "no_session" | "bad_email" | "rate_limited";
export class TicketError extends Error {
  code: TicketCode;
  constructor(code: TicketCode) { super(code); this.code = code; }
}

/** Create an escalation ticket for an existing chat session and email support. */
export async function createTicket(a: { channel: Channel; externalId: string; email?: string; note?: string; ipHash?: string }):
  Promise<{ ref: string; emailed: boolean; existing: boolean }> {
  const email = a.email ? validEmail(a.email) : null;
  if (a.channel === "web" && !email) throw new TicketError("bad_email");
  if (a.email && !email) throw new TicketError("bad_email");

  const { data: sess } = await db.from("support_sessions").select("id").eq("channel", a.channel).eq("external_id", a.externalId).maybeSingle();
  if (!sess) throw new TicketError("no_session");
  const sessionId: string = sess.id;

  // Same session asking again within 30 minutes: hand back the same ticket.
  const recent = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data: dup } = await db.from("chat_tickets").select("ref, emailed_at").eq("session_id", sessionId).gte("created_at", recent).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (dup) return { ref: dup.ref, emailed: !!dup.emailed_at, existing: true };

  if (a.ipHash) {
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await db.from("chat_tickets").select("id", { count: "exact", head: true }).eq("ip_hash", a.ipHash).gte("created_at", dayAgo);
    if ((count ?? 0) >= Number(env("LIMIT_TICKETS_DAY") ?? 3)) throw new TicketError("rate_limited");
  }

  const note = clampText(a.note, 1000) || null;
  let ref = "", ticketId = "";
  for (let i = 0; i < 4 && !ticketId; i++) {
    ref = newRef();
    const { data, error } = await db.from("chat_tickets")
      .insert({ ref, session_id: sessionId, channel: a.channel, contact_email: email, note, ip_hash: a.ipHash ?? null })
      .select("id").single();
    if (data) ticketId = data.id;
    else if (error?.code !== "23505") throw new Error("ticket: " + error?.message);
  }
  if (!ticketId) throw new Error("ticket: could not allocate a reference");

  const { data: rows } = await db.from("support_messages").select("role, content").eq("session_id", sessionId).order("id", { ascending: false }).limit(20);
  const transcript = [...(rows ?? [])].reverse().map((r: any) => ({ role: r.role, content: r.content }));
  const sent = await sendTicketEmails({ fetch, env, log: console.log }, { ref, channel: a.channel, contactEmail: email, note, sessionId, transcript });

  await db.from("chat_tickets").update(sent.ok ? { emailed_at: new Date().toISOString() } : { email_error: sent.error ?? "unknown" }).eq("id", ticketId);
  await db.from("support_sessions").update({ escalate_requested: true }).eq("id", sessionId);
  if (!sent.ok) console.error("ticket email failed", ref, sent.error);
  return { ref, emailed: sent.ok, existing: false };
}
