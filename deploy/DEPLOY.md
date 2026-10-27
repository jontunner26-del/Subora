# Deploying the Subora support chatbot (phases 1 to 4)

Project ref: `znywpatsqmmxkbqtybrr`

What is in the package
| File | Use |
|---|---|
| `deploy/all-migrations.sql` | both database migrations in order (chat sessions and messages, then tickets) |
| `supabase/verify/20261027_chat_tickets_verify.sql` | checks the tables; ends with a deliberate error, "ALL CHECKS PASSED" = success |
| `supabase/functions/support-chat/` + `supabase/functions/_shared/` | the function, as modules (use with the CLI; keep this form for Telegram/WhatsApp later) |
| `deploy/support-chat.single-file.ts` | the same function in ONE file, for pasting into the Supabase dashboard |
| `assets/chat-widget.js`, `knowledge.md`, regenerated pages | the website side (deploys with Vercel) |

## Step 1. Database (SQL editor)
1. Paste and run `deploy/all-migrations.sql`.
2. Paste and run `supabase/verify/20261027_chat_tickets_verify.sql`. Expect the error text "ALL CHECKS PASSED (rolled back on purpose)".

## Step 2. Secrets
```
supabase secrets set --project-ref znywpatsqmmxkbqtybrr \
  TOKENHARBOR_API_KEY=... \
  MANUS_API_KEY=... \
  BREVO_API_KEY=...
```
(Dashboard: Edge Functions, then Secrets.) `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically. Never put keys in the code, the repo or the website.

Optional secrets (defaults in brackets)
| Name | Default | Purpose |
|---|---|---|
| TH_MODELS | deepseek-v4.1-flash:free,mimo-v2.6-flash:free | Token Harbor models, tried in order |
| SUPPORT_FROM | welcome@subora.com.ng | Brevo sender for ticket emails (must be a verified Brevo sender) |
| SUPPORT_EMAIL | support@subora.com.ng | where escalations go |
| ALLOWED_ORIGINS | https://www.subora.com.ng,https://subora.com.ng | add a Vercel preview URL or http://localhost:3000 to test there |
| SITE_URL | https://www.subora.com.ng | where /knowledge.md is fetched from |
| LIMIT_SESSION_HOUR / LIMIT_IP_HOUR / LIMIT_DAILY / LIMIT_TICKETS_DAY | 20 / 40 / 3000 / 3 | rate limits |
| IP_SALT | subora | salt for hashing visitor IPs (raw IPs are never stored) |

## Step 3. Deploy the function
Option A, CLI (from the project folder):
```
supabase functions deploy support-chat --project-ref znywpatsqmmxkbqtybrr
```
Leave JWT verification ON (do not add --no-verify-jwt): the widget sends the public anon key, which passes it.

Option B, dashboard: Edge Functions, Create a function named `support-chat`, paste the whole of `deploy/support-chat.single-file.ts`, Deploy. Keep "Verify JWT" ON.

## Step 4. Deploy the website
Push the project to Vercel (the pages, `assets/chat-widget.js` and `knowledge.md`). `.vercelignore` keeps `supabase/`, `deploy/` and `tests/` off the public site. Check that https://www.subora.com.ng/knowledge.md opens and https://www.subora.com.ng/faq shows "Is it safe to pay?" first.

## Step 5. Test
```
curl -s https://znywpatsqmmxkbqtybrr.supabase.co/functions/v1/support-chat \
  -H "Authorization: Bearer <ANON_KEY>" -H "apikey: <ANON_KEY>" \
  -H "Origin: https://www.subora.com.ng" -H "Content-Type: application/json" \
  -d '{"session_id":"7b1f6a3e-2c4d-4e8a-9b5f-0a1b2c3d4e5f","message":"How does escrow work?"}'
```
Expect `{"reply":"...","escalate":false,"limited":false}`. In the SQL editor, `select role, provider, left(content,60) from support_messages order by id desc limit 4;` shows which model answered (`tokenharbor:deepseek...`, then `tokenharbor:mimo...`, then `manus`; `none` means every model failed).

Ticket test (same session, after the message above):
```
  -d '{"session_id":"7b1f6a3e-2c4d-4e8a-9b5f-0a1b2c3d4e5f","action":"ticket","email":"you@example.com","note":"test"}'
```
Expect `{"ref":"CH-XXXXXX","emailed":true,"existing":false}` and an email in the support inbox. Unsent tickets: `select ref, email_error from chat_tickets where emailed_at is null;`

Then open the live site, tap the chat button, ask a question, ask for a human, and send the form.

## If something is wrong
| Symptom | Likely cause |
|---|---|
| Widget says "could not reach the server" | function not deployed, or the page origin is not in ALLOWED_ORIGINS (browser console shows a CORS error) |
| Every reply is the "having trouble" message | Token Harbor key missing or wrong; check Edge Function logs |
| `emailed:false`, `email_error` says brevo 401/400 | BREVO_API_KEY wrong, or SUPPORT_FROM is not a verified Brevo sender |
| Replies ignore site facts | /knowledge.md not deployed yet (the function falls back to a tiny built-in summary) |
| Manus never answers | expected to be rare: it is the last fallback, async, 25 second wait, trimmed knowledge base; test it with a real key |

## Rebuilding after code changes
`node tools/bundle-support-chat.mjs` regenerates the single file and the combined SQL. `node tools/build-pages.mjs` regenerates the pages and `knowledge.md` (run it whenever site copy changes, then redeploy the site).

## Tests (no keys, no network)
```
node --experimental-strip-types --test tests/chatbot.test.mjs tests/support-chat.e2e.test.mjs
```
27 tests: model fallback, Manus polling, email building, and the whole function against a fake database. Browser tests for the widget are in `tests/browser/`.

## Not built yet
Phase 5 (staff view of chats and tickets), phase 6 (Telegram), phase 7 (WhatsApp).
