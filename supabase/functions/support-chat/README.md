# support-chat (Subora support bot, phases 2 to 4)

Website adapter. The brain lives in `../_shared/chatcore.ts`, so the Telegram and WhatsApp
adapters (phases 6 and 7) only need to call `handleMessage({ channel, externalId, text })`.

## Deploy (project ref znywpatsqmmxkbqtybrr)
1. Run `supabase/migrations/20261026_support_chat.sql`, then `supabase/migrations/20261027_chat_tickets.sql`, in the Supabase SQL editor. Then run `supabase/verify/20261027_chat_tickets_verify.sql`: it ends with a deliberate error, and "ALL CHECKS PASSED" means success.
2. Set secrets (never put keys in the code or the repo):
   `supabase secrets set TOKENHARBOR_API_KEY=... MANUS_API_KEY=... BREVO_API_KEY=...`
   (BREVO_API_KEY is the same Brevo key your send-alerts function uses.)
3. `supabase functions deploy support-chat`
4. Make sure the site with `/knowledge.md` (phase 1) is deployed on Vercel.

## Optional secrets
| Name | Default | Purpose |
|---|---|---|
| TH_MODELS | deepseek-v4.1-flash:free,mimo-v2.6-flash:free | Token Harbor models, tried in order |
| ALLOWED_ORIGINS | https://www.subora.com.ng,https://subora.com.ng | CORS allow list (add http://localhost:3000 to test locally) |
| SITE_URL | https://www.subora.com.ng | where knowledge.md is fetched from |
| LIMIT_SESSION_HOUR / LIMIT_IP_HOUR / LIMIT_DAILY | 20 / 40 / 3000 | rate limits |
| SUPPORT_FROM | welcome@subora.com.ng | Brevo sender for ticket emails (must be a verified Brevo sender) |
| SUPPORT_EMAIL | support@subora.com.ng | where escalations are delivered |
| LIMIT_TICKETS_DAY | 3 | tickets per visitor per day |
| IP_SALT | subora | salt for hashing visitor IPs (raw IPs are never stored) |

## Try it
```
curl -s https://znywpatsqmmxkbqtybrr.supabase.co/functions/v1/support-chat \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Origin: https://www.subora.com.ng" -H "Content-Type: application/json" \
  -d '{"session_id":"7b1f6a3e-2c4d-4e8a-9b5f-0a1b2c3d4e5f","message":"How does escrow work?"}'
```
Expected: `{"reply":"...","escalate":false,"limited":false}`. Check `support_messages.provider` to see which model answered.

## Escalate to a human (phase 3)
```
curl -s https://znywpatsqmmxkbqtybrr.supabase.co/functions/v1/support-chat \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Origin: https://www.subora.com.ng" -H "Content-Type: application/json" \
  -d '{"session_id":"7b1f6a3e-2c4d-4e8a-9b5f-0a1b2c3d4e5f","action":"ticket","email":"you@example.com","note":"My payment is missing"}'
```
Expected: `{"ref":"CH-XXXXXX","emailed":true,"existing":false}`. The session must already have at least one chat message. Support gets the transcript with the customer's email as reply-to, and the customer gets a confirmation.
If `emailed` is false the ticket is still saved. Find unsent ones with `select ref, email_error from chat_tickets where emailed_at is null;`

## Tests (no keys or network needed)
`node --experimental-strip-types --test tests/chatbot.test.mjs`

## Notes
- Provider order: Token Harbor model 1, Token Harbor model 2, then Manus.
- Manus is an async agent API (task, then poll), capped at about 5,000 input tokens, so it gets a trimmed knowledge base and a 25 second wait. It is a last resort.
- The model ends a message with `[[ESCALATE]]` when a human is needed. The function strips it and returns `escalate: true`. The widget (phase 4) then asks for an email and calls the ticket action above.

## Website widget (phase 4)
`assets/chat-widget.js` is one self-contained file, loaded with a script tag on `index.html` and on every generated page (`tools/build-pages.mjs` adds the tag, `staff.html` does not get it).
- Static pages: a floating button opens the chat.
- The app (`index.html`): no extra button. The app's existing "Chat with support" buttons now open the bot first. Signed-in users get a "Message support in Subora" button in the escalation card, which opens the existing in-app support form, so plan-based priority support keeps working. Guests could not use that form before, so for them the bot plus the email ticket is the support route.
- Chat history and the session id live in the visitor's browser (localStorage) for 24 hours.
- Turn it off on one page with `window.SUBORA_CHAT_DISABLED = true` before the script. Override settings with `window.SUBORA_CHAT_CONFIG = { url, key, support }`.
- CORS: the function only accepts https://www.subora.com.ng and https://subora.com.ng by default. To test on a Vercel preview URL or localhost, add it to the `ALLOWED_ORIGINS` secret.

Browser tests (need Python Playwright with Chromium and a local server, `python3 -m http.server 8765` in the project folder):
`python3 tests/browser/widget_static_pages.py` and `python3 tests/browser/widget_in_app.py`. They mock the endpoint, so no keys are needed.
