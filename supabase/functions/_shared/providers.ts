// Model providers: Token Harbor (primary, two free models) then Manus (fallback).
// Dependencies are injected so the chain can be tested with a fake fetch.
import { type Msg, manusPrompt, stripThink } from "./pure.ts";

export interface Deps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (...a: unknown[]) => void;
}
export interface Result { text: string; provider: string }

const TH_URL = "https://tokenharbor.ai/v1/chat/completions";
const MANUS = "https://api.manus.ai/v2";

async function callTokenHarbor(d: Deps, model: string, system: string, history: Msg[]): Promise<string | null> {
  const key = d.env("TOKENHARBOR_API_KEY");
  if (!key) return null;
  const res = await d.fetch(TH_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 600, temperature: 0.3,
      messages: [{ role: "system", content: system }, ...history],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { d.log?.("tokenharbor", model, res.status); return null; }
  const j = await res.json();
  const c = j?.choices?.[0]?.message?.content;
  const t = typeof c === "string" ? stripThink(c) : "";
  return t || null;
}

async function callManus(d: Deps, system: string, history: Msg[]): Promise<string | null> {
  const key = d.env("MANUS_API_KEY");
  if (!key) return null;
  const sleep = d.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const now = d.now ?? Date.now;
  const H = { "x-manus-api-key": key, "Content-Type": "application/json" };

  const created = await d.fetch(`${MANUS}/task.create`, {
    method: "POST", headers: H, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      message: { content: [{ type: "text", text: manusPrompt(system, history) }] },
      agent_profile: "lite", hide_in_task_list: true, interactive_mode: false, locale: "en",
    }),
  });
  if (!created.ok) { d.log?.("manus create", created.status); return null; }
  const cj = await created.json();
  const taskId = cj?.task_id;
  if (!cj?.ok || !taskId) return null;

  const deadline = now() + 25000;
  while (now() < deadline) {
    await sleep(2000);
    const r = await d.fetch(`${MANUS}/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=20`, {
      headers: { "x-manus-api-key": key }, signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) continue;
    const msgs: any[] = (await r.json())?.messages ?? [];
    if (msgs.some(m => m.type === "error_message")) return null;
    const status = msgs.find(m => m.type === "status_update")?.status_update?.agent_status;
    if (status === "error" || status === "waiting") return null; // we cannot answer agent questions
    if (status === "stopped") {
      const replies = msgs.filter(m => m.type === "assistant_message" && m.assistant_message?.content?.trim());
      const best = replies.find(m => m.assistant_message.delivery_kind === "result") ?? replies[0];
      const t = best ? stripThink(best.assistant_message.content) : "";
      return t || null;
    }
  }
  return null;
}

/** Try each provider in order; first non-empty answer wins. */
export async function generate(d: Deps, system: string, manusSystem: string, history: Msg[]): Promise<Result | null> {
  const models = (d.env("TH_MODELS") ?? "deepseek-v4.1-flash:free,mimo-v2.6-flash:free").split(",").map(s => s.trim()).filter(Boolean);
  for (const model of models) {
    try {
      const t = await callTokenHarbor(d, model, system, history);
      if (t) return { text: t, provider: `tokenharbor:${model}` };
    } catch (e) { d.log?.("tokenharbor error", model, String(e)); }
  }
  try {
    const t = await callManus(d, manusSystem, history);
    if (t) return { text: t, provider: "manus" };
  } catch (e) { d.log?.("manus error", String(e)); }
  return null;
}
