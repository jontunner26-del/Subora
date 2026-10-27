// Escalation helpers: ticket refs, email validation, email bodies, Brevo sending.
// No Deno-only imports, so it is unit-testable with Node.
import type { Deps } from "./providers.ts";

export interface TranscriptLine { role: "user" | "assistant"; content: string }
export interface TicketEmailInput {
  ref: string; channel: string; contactEmail?: string | null; note?: string | null;
  sessionId: string; transcript: TranscriptLine[];
}

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
export function validEmail(s: unknown): string | null {
  const e = String(s ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export function newRef(rand: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rand(6);
  return "CH-" + [...b].map(x => ALPHABET[x % ALPHABET.length]).join("");
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function buildSupportEmail(i: TicketEmailInput) {
  const who = i.contactEmail ? i.contactEmail : `no email (${i.channel} chat)`;
  const lastUser = [...i.transcript].reverse().find(m => m.role === "user")?.content ?? "";
  const subject = oneLine(`[${i.ref}] Chat escalation: ${lastUser}`).slice(0, 120);
  const lines = i.transcript.map(m => `${m.role === "user" ? "Customer" : "Bot"}: ${m.content}`);
  const text = `Ticket ${i.ref} (${i.channel})\nContact: ${who}\n${i.note ? `Note from customer: ${i.note}\n` : ""}\n--- Transcript ---\n${lines.join("\n\n")}\n\nReply to this email to answer the customer directly.`;
  const rows = i.transcript.map(m =>
    `<tr><td style="padding:6px 10px;vertical-align:top;color:#666;white-space:nowrap">${m.role === "user" ? "Customer" : "Bot"}</td><td style="padding:6px 10px;white-space:pre-wrap">${esc(m.content)}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><h2 style="margin:0 0 8px">Chat escalation ${esc(i.ref)}</h2>` +
    `<p style="margin:0 0 4px"><b>Channel:</b> ${esc(i.channel)}</p><p style="margin:0 0 4px"><b>Contact:</b> ${esc(who)}</p>` +
    (i.note ? `<p style="margin:0 0 4px"><b>Note from customer:</b> ${esc(i.note)}</p>` : "") +
    `<table style="border-collapse:collapse;margin-top:12px;border:1px solid #ddd">${rows}</table>` +
    `<p style="color:#666;margin-top:12px">Reply to this email to answer the customer directly.</p></div>`;
  return { subject, html, text };
}

export function buildUserEmail(ref: string) {
  const subject = `We got your message (${ref})`;
  const text = `Hi,\n\nThanks for reaching out. Your request is with the Subora support team under reference ${ref}. We usually reply within 24 hours.\n\nFor your safety: Subora staff will never ask for your password, one-time codes, or card details.\n\nSubora Support`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>Hi,</p><p>Thanks for reaching out. Your request is with the Subora support team under reference <b>${esc(ref)}</b>. We usually reply within 24 hours.</p><p style="color:#666">For your safety: Subora staff will never ask for your password, one-time codes, or card details.</p><p>Subora Support</p></div>`;
  return { subject, html, text };
}

interface Mail { to: string; subject: string; html: string; text: string; replyTo?: string }

async function sendBrevo(d: Deps, from: { email: string; name: string }, m: Mail): Promise<string | null> {
  const key = d.env("BREVO_API_KEY");
  if (!key) return "BREVO_API_KEY not set";
  const res = await d.fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      sender: from, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text,
      ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return null;
  let detail = ""; try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch (_) { /* ignore */ }
  return `brevo ${res.status} ${detail}`;
}

/** Staff email is what matters; the customer confirmation is best effort. */
export async function sendTicketEmails(d: Deps, i: TicketEmailInput): Promise<{ ok: boolean; error?: string }> {
  const from = { email: d.env("SUPPORT_FROM") ?? "welcome@subora.com.ng", name: "Subora Chat Support" };
  const to = d.env("SUPPORT_EMAIL") ?? "support@subora.com.ng";
  let err: string | null;
  try {
    const s = buildSupportEmail(i);
    err = await sendBrevo(d, from, { to, subject: s.subject, html: s.html, text: s.text, replyTo: i.contactEmail ?? undefined });
  } catch (e) { err = String(e).slice(0, 200); }
  if (err) return { ok: false, error: err };
  if (i.contactEmail) {
    try { const u = buildUserEmail(i.ref); await sendBrevo(d, from, { to: i.contactEmail, subject: u.subject, html: u.html, text: u.text }); }
    catch (_) { /* confirmation is optional */ }
  }
  return { ok: true };
}
