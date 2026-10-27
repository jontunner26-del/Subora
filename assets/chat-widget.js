/* Subora support chat widget (phase 4). Talks to the support-chat Edge Function.
   - Static pages: shows its own floating button.
   - The app (index.html): no extra button; the existing "Chat with support" buttons open this panel,
     and signed-in users can still reach the in-app support form (priority support) from here.
   Disable on a page with: window.SUBORA_CHAT_DISABLED = true  (before this script loads). */
(function () {
  'use strict';

  /* ---------- pure helpers (also exported for tests) ---------- */
  var PATHS = /^\/(store|login|signup|sell|help|faq|safety|how-it-works|about|contact|terms|privacy|refunds)$/;
  var TOKEN_RE = /(\*\*[^*\n]+\*\*)|((?:^|[\s(])\/[a-z-]+(?=$|[\s).,!?:;]))|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

  function tokens(s) {
    var out = [], last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s))) {
      if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
      if (m[1]) out.push({ t: 'b', v: m[1].slice(2, -2) });
      else if (m[2]) {
        var lead = m[2].charAt(0) === '/' ? '' : m[2].charAt(0), path = m[2].slice(lead.length);
        if (lead) out.push({ t: 'text', v: lead });
        out.push(PATHS.test(path) ? { t: 'path', v: path } : { t: 'text', v: path });
      } else out.push({ t: 'mail', v: m[3] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
    return out;
  }
  function validEmail(s) {
    s = String(s || '').trim();
    return s.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(s) ? s : '';
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    (typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : { getRandomValues: function (a) { for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } }).getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  var PURE = { tokens: tokens, validEmail: validEmail, uuid: uuid };
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__suboraChat || window.SUBORA_CHAT_DISABLED) return;
  window.__suboraChat = true;

  /* ---------- config ---------- */
  var CFG = {
    url: 'https://znywpatsqmmxkbqtybrr.supabase.co/functions/v1/support-chat',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpueXdwYXRzcW1teGticXR5YnJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzAxODEsImV4cCI6MjEwNzY0NjE4MX0.F3XtaNmuOXFsC8r6UjfbtnZdxoz0HDUDtieY6bSyqqc',
    support: 'support@subora.com.ng'
  };
  var UC = window.SUBORA_CHAT_CONFIG || {};
  for (var k in UC) if (Object.prototype.hasOwnProperty.call(UC, k)) CFG[k] = UC[k];
  var APP = !!document.getElementById('app');
  var TTL = 24 * 3600 * 1000, MAXLOG = 40;
  var QUICK = ['How does escrow work?', 'Is it safe to pay?', 'How do I sell on Subora?', 'Refunds and disputes'];

  /* ---------- state (kept in localStorage so a refresh does not lose the chat) ---------- */
  var SK = 'subora_chat_v1';
  var st = load();
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(SK) || 'null');
      if (o && o.sid && Date.now() - o.ts < TTL) return o;
    } catch (e) { /* ignore */ }
    return { sid: uuid(), ts: Date.now(), log: [], esc: false, ticket: null };
  }
  function save() {
    st.ts = Date.now();
    if (st.log.length > MAXLOG) st.log = st.log.slice(-MAXLOG);
    try { localStorage.setItem(SK, JSON.stringify(st)); } catch (e) { /* ignore */ }
  }

  /* ---------- styles ---------- */
  var css = [
    '.sbc,.sbc *{box-sizing:border-box}',
    '.sbc{font:15px/1.5 var(--fb,var(--fd,system-ui,-apple-system,"Segoe UI",sans-serif));color:var(--fg,#0e1f10)}',
    '.sbc-fab{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);z-index:9990;width:56px;height:56px;border-radius:50%;background:var(--lime,#d1fe17);color:var(--lime-ink,#102208);border:1.5px solid var(--edge-pri,#0e1f10);box-shadow:0 4px 0 var(--edge-pri,#0e1f10);display:grid;place-items:center;cursor:pointer;padding:0}',
    '.sbc-fab:active{transform:translateY(3px);box-shadow:none}',
    '.sbc-fab:focus-visible,.sbc button:focus-visible,.sbc textarea:focus-visible,.sbc input:focus-visible{outline:3px solid var(--info,#1f5fa8);outline-offset:2px}',
    '.sbc-panel{position:fixed;z-index:9995;right:16px;bottom:16px;width:380px;max-width:calc(100vw - 32px);height:min(600px,calc(100dvh - 32px));display:none;flex-direction:column;background:var(--surface,#fff);color:var(--fg,#0e1f10);border:1.5px solid var(--edge,#0e1f10);border-radius:18px;box-shadow:var(--shadow,0 10px 28px rgba(14,31,16,.18));overflow:hidden}',
    '.sbc-panel.on{display:flex}',
    '.sbc-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--ink,#0e1f10);color:var(--ink-fg,#fff)}',
    '.sbc-hd b{font-size:16px;line-height:1.2}.sbc-hd small{display:block;opacity:.8;font-size:12px}',
    '.sbc-tag{font-size:11px;font-weight:800;border-radius:6px;padding:2px 6px;background:var(--ink-fg,#fff);color:var(--ink,#0e1f10);margin-left:6px;vertical-align:1px}',
    '.sbc-x{margin-left:auto;width:44px;height:44px;border:0;background:transparent;color:inherit;border-radius:10px;cursor:pointer;display:grid;place-items:center}',
    '.sbc-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg,#fff);overscroll-behavior:contain}',
    '.sbc-m{max-width:86%;padding:9px 12px;border-radius:14px;word-wrap:break-word;overflow-wrap:anywhere}',
    '.sbc-m p{margin:0}.sbc-m p+p,.sbc-m p+ul,.sbc-m ul+p{margin-top:8px}.sbc-m ul{margin:0;padding-left:18px}',
    '.sbc-m a{color:var(--link,#1d5d12);font-weight:700;text-decoration:underline}',
    '.sbc-b{align-self:flex-start;background:var(--surface2,#f3f6ec);border:1px solid var(--line,#e1e6d6)}',
    '.sbc-u{align-self:flex-end;background:var(--lime,#d1fe17);color:var(--lime-ink,#102208);border:1.5px solid var(--edge-pri,#0e1f10)}',
    '.sbc-u a{color:inherit}',
    '.sbc-s{align-self:center;max-width:94%;text-align:center;font-size:13px;background:var(--good-soft,#dff4e3);color:var(--good,#1a7a35);border:1px solid var(--good,#1a7a35)}',
    '.sbc-chips{display:flex;flex-wrap:wrap;gap:8px}',
    '.sbc-chip{border:1.5px solid var(--edge,#0e1f10);background:var(--surface,#fff);color:var(--fg,#0e1f10);border-radius:999px;padding:8px 13px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;min-height:40px}',
    '.sbc-chip:hover{background:var(--lime-soft,#f1fbc4)}',
    '.sbc-typing{display:inline-flex;gap:4px;align-items:center;height:20px}',
    '.sbc-typing i{width:7px;height:7px;border-radius:50%;background:var(--muted,#5a6a55);animation:sbcb 1.1s infinite ease-in-out}',
    '.sbc-typing i:nth-child(2){animation-delay:.15s}.sbc-typing i:nth-child(3){animation-delay:.3s}',
    '@keyframes sbcb{0%,70%,100%{transform:translateY(0);opacity:.5}35%{transform:translateY(-4px);opacity:1}}',
    '@media (prefers-reduced-motion:reduce){.sbc-typing i{animation:none;opacity:.8}}',
    '.sbc-card{align-self:stretch;background:var(--lime-soft,#f1fbc4);border:1.5px solid var(--edge,#0e1f10);border-radius:14px;padding:12px}',
    '.sbc-card h4{margin:0 0 4px;font-size:15px}.sbc-card p{margin:0 0 8px;font-size:14px;color:var(--muted,#5a6a55)}',
    '.sbc-card label{display:block;font-size:13px;font-weight:700;margin:8px 0 3px}',
    '.sbc-card input,.sbc-card textarea,.sbc-in textarea{width:100%;font:inherit;font-size:16px;color:var(--fg,#0e1f10);background:var(--surface,#fff);border:1.5px solid var(--line,#c9d2bd);border-radius:10px;padding:9px 11px}',
    '.sbc-card textarea{resize:vertical;min-height:60px;max-height:140px}',
    '.sbc-err{color:var(--bad,#b3261e);font-size:13px;margin-top:6px;min-height:0}',
    '.sbc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 16px;border-radius:11px;border:1.5px solid var(--edge-pri,#0e1f10);background:var(--lime,#d1fe17);color:var(--lime-ink,#102208);font:inherit;font-weight:800;cursor:pointer}',
    '.sbc-btn.ghost{background:var(--surface,#fff);border-color:var(--edge,#0e1f10);color:var(--fg,#0e1f10)}',
    '.sbc-btn[disabled]{opacity:.55;cursor:not-allowed}',
    '.sbc-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}',
    '.sbc-in{display:flex;gap:8px;align-items:flex-end;padding:10px 12px;border-top:1px solid var(--line,#e1e6d6);background:var(--surface,#fff)}',
    '.sbc-in textarea{resize:none;max-height:96px;min-height:44px;line-height:1.35}',
    '.sbc-ft{padding:6px 12px calc(env(safe-area-inset-bottom,0px) + 8px);font-size:12px;color:var(--muted,#5a6a55);text-align:center;background:var(--surface,#fff)}',
    '.sbc-ft button{border:0;background:none;color:var(--link,#1d5d12);font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;padding:6px 4px;min-height:32px}',
    '@media (max-width:599px){.sbc-panel{right:0;bottom:0;left:0;top:0;width:100%;max-width:none;height:100dvh;border-radius:0;border:0}.sbc-hd{padding-top:calc(env(safe-area-inset-top,0px) + 12px)}.sbc-m{max-width:92%}}'
  ].join('\n');
  var styleEl = document.createElement('style');
  styleEl.id = 'sbc-style'; styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ---------- DOM ---------- */
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var ICON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var XICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var root = el('div', 'sbc');
  var fab = null;
  if (!APP) {
    fab = el('button', 'sbc-fab'); fab.type = 'button'; fab.innerHTML = ICON;
    fab.setAttribute('aria-label', 'Chat with Subora assistant'); fab.setAttribute('aria-expanded', 'false');
    root.appendChild(fab);
  }
  var panel = el('div', 'sbc-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Subora support chat'); panel.setAttribute('aria-modal', 'false');
  var hd = el('div', 'sbc-hd');
  var ht = el('div'); var hb = el('b', null, 'Subora Assistant'); var tag = el('span', 'sbc-tag', 'AI'); hb.appendChild(tag);
  ht.appendChild(hb); ht.appendChild(el('small', null, 'Answers from our help pages'));
  var xb = el('button', 'sbc-x'); xb.type = 'button'; xb.setAttribute('aria-label', 'Close chat'); xb.innerHTML = XICON;
  hd.appendChild(ht); hd.appendChild(xb);
  var msgs = el('div', 'sbc-msgs'); msgs.setAttribute('role', 'log'); msgs.setAttribute('aria-live', 'polite');
  var inb = el('div', 'sbc-in');
  var ta = el('textarea'); ta.rows = 1; ta.maxLength = 1000; ta.placeholder = 'Type your question'; ta.setAttribute('aria-label', 'Your message');
  var sb = el('button', 'sbc-btn', 'Send'); sb.type = 'button';
  inb.appendChild(ta); inb.appendChild(sb);
  var ft = el('div', 'sbc-ft');
  ft.appendChild(document.createTextNode('AI assistant, it can make mistakes. Never share passwords or codes. '));
  var human = el('button', null, 'Talk to a human'); human.type = 'button'; ft.appendChild(human);
  panel.appendChild(hd); panel.appendChild(msgs); panel.appendChild(inb); panel.appendChild(ft);
  root.appendChild(panel);
  document.body.appendChild(root);

  /* ---------- rendering ---------- */
  function addInline(parent, s) {
    tokens(s).forEach(function (t) {
      if (t.t === 'text') parent.appendChild(document.createTextNode(t.v));
      else if (t.t === 'b') parent.appendChild(el('strong', null, t.v));
      else if (t.t === 'path') { var a = el('a', null, t.v); a.href = t.v; a.target = '_blank'; a.rel = 'noopener'; parent.appendChild(a); }
      else if (t.v.toLowerCase() === String(CFG.support).toLowerCase()) { var m = el('a', null, t.v); m.href = 'mailto:' + t.v; parent.appendChild(m); }
      else parent.appendChild(document.createTextNode(t.v));
    });
  }
  function fmt(parent, text) {
    String(text).split(/\n{2,}/).forEach(function (blk) {
      var lines = blk.split('\n').filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      var LI = /^\s*([-*\u2022]|\d+[.)])\s+/;
      if (lines.every(function (l) { return LI.test(l); })) {
        var ul = el('ul');
        lines.forEach(function (l) { var li = el('li'); addInline(li, l.replace(LI, '')); ul.appendChild(li); });
        parent.appendChild(ul);
      } else {
        var p = el('p');
        lines.forEach(function (l, i) { if (i) p.appendChild(document.createElement('br')); addInline(p, l); });
        parent.appendChild(p);
      }
    });
  }
  function bubble(role, text) {
    var m = el('div', 'sbc-m ' + (role === 'u' ? 'sbc-u' : role === 's' ? 'sbc-s' : 'sbc-b'));
    if (role === 'u') m.textContent = text; else fmt(m, text);
    msgs.appendChild(m); return m;
  }
  function toEnd() { msgs.scrollTop = msgs.scrollHeight; }

  var typingEl = null;
  function typing(on) {
    if (on && !typingEl) {
      typingEl = el('div', 'sbc-m sbc-b'); var d = el('span', 'sbc-typing'); d.setAttribute('aria-label', 'Assistant is typing');
      d.appendChild(el('i')); d.appendChild(el('i')); d.appendChild(el('i')); typingEl.appendChild(d); msgs.appendChild(typingEl); toEnd();
    } else if (!on && typingEl) { typingEl.remove(); typingEl = null; }
  }

  function loggedIn() { try { return typeof S !== 'undefined' && !!S.auth; } catch (e) { return false; } }

  function escCard() {
    var c = el('div', 'sbc-card'); c.setAttribute('data-sbc', 'esc');
    c.appendChild(el('h4', null, 'Talk to our support team'));
    c.appendChild(el('p', null, 'Leave your email and we will reply there, usually within 24 hours.'));
    var l1 = el('label', null, 'Your email'); l1.setAttribute('for', 'sbc-email');
    var em = el('input'); em.id = 'sbc-email'; em.type = 'email'; em.autocomplete = 'email'; em.inputMode = 'email'; em.maxLength = 254; em.placeholder = 'you@example.com';
    var l2 = el('label', null, 'Anything we should know? (optional)'); l2.setAttribute('for', 'sbc-note');
    var nt = el('textarea'); nt.id = 'sbc-note'; nt.maxLength = 1000; nt.placeholder = 'Order or payment details, without passwords or codes';
    var err = el('div', 'sbc-err'); err.setAttribute('role', 'alert');
    var row = el('div', 'sbc-row');
    var go = el('button', 'sbc-btn', 'Send to support'); go.type = 'button';
    row.appendChild(go);
    if (APP && loggedIn()) {
      var inapp = el('button', 'sbc-btn ghost', 'Message support in Subora'); inapp.type = 'button';
      inapp.addEventListener('click', openInApp); row.appendChild(inapp);
    }
    c.appendChild(l1); c.appendChild(em); c.appendChild(l2); c.appendChild(nt); c.appendChild(err); c.appendChild(row);
    go.addEventListener('click', function () { submitTicket(em, nt, err, go); });
    return c;
  }

  function renderAll() {
    msgs.textContent = ''; typingEl = null;
    if (!st.log.length) {
      bubble('b', 'Hi! I am the Subora AI assistant. Ask me about buying, selling, escrow, refunds or your account. For a problem with a specific order, I can pass you to our team.');
      var ch = el('div', 'sbc-chips');
      QUICK.forEach(function (q) { var b = el('button', 'sbc-chip', q); b.type = 'button'; b.addEventListener('click', function () { send(q); }); ch.appendChild(b); });
      msgs.appendChild(ch);
    }
    st.log.forEach(function (m) { bubble(m.r, m.t); });
    if (st.esc && !(st.ticket && st.ticket.done)) msgs.appendChild(escCard());
    toEnd();
  }

  /* ---------- network ---------- */
  var busy = false;
  function post(body, ms) {
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, ms || 45000) : null;
    return fetch(CFG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CFG.key, 'apikey': CFG.key },
      body: JSON.stringify(body), signal: ac ? ac.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  function addLog(r, t) { st.log.push({ r: r, t: t }); save(); }
  function recentTicket() { return st.ticket && st.ticket.ts && Date.now() - st.ticket.ts < 30 * 60 * 1000; }

  function send(text, opts) {
    text = String(text || '').trim();
    if (!text || busy) return;
    opts = opts || {};
    busy = true; sb.disabled = true; ta.value = ''; autosize();
    if (!st.log.length) msgs.textContent = '';
    var old = msgs.querySelector('[data-sbc="esc"]'); if (old) old.remove();
    addLog('u', text); bubble('u', text); typing(true); toEnd();
    post({ session_id: st.sid, message: text }).then(function (res) {
      typing(false);
      if (res.ok && res.j && res.j.reply) {
        addLog('b', res.j.reply); bubble('b', res.j.reply);
        if ((res.j.escalate || opts.forceEsc) && !recentTicket()) { st.esc = true; st.ticket = null; save(); }
      } else {
        var m = 'Sorry, something went wrong on our side. You can try again, or talk to our support team.';
        addLog('b', m); bubble('b', m); st.esc = true; save();
      }
    }).catch(function () {
      typing(false);
      var m = 'I could not reach the server. Check your connection and try again, or talk to our support team.';
      addLog('b', m); bubble('b', m); st.esc = true; save();
    }).then(function () {
      busy = false; sb.disabled = false;
      if (st.esc && !(st.ticket && st.ticket.done) && !msgs.querySelector('[data-sbc="esc"]')) msgs.appendChild(escCard());
      toEnd();
      if (panel.classList.contains('on')) ta.focus();
    });
  }

  function submitTicket(em, nt, err, go) {
    err.textContent = '';
    var email = validEmail(em.value);
    if (!email) { err.textContent = 'Please enter a valid email address so we can reply.'; em.focus(); return; }
    go.disabled = true; go.textContent = 'Sending...';
    post({ session_id: st.sid, action: 'ticket', email: email, note: nt.value.trim() }, 30000).then(function (res) {
      if (res.ok && res.j && res.j.ref) {
        st.ticket = { ref: res.j.ref, ts: Date.now(), done: true }; st.esc = false; save();
        var card = msgs.querySelector('[data-sbc="esc"]'); if (card) card.remove();
        var line = res.j.emailed
          ? 'Sent. Your reference is ' + res.j.ref + '. We will reply to ' + email + ', usually within 24 hours.'
          : 'Your request is saved under reference ' + res.j.ref + ' and our team will pick it up. If it is urgent, email ' + CFG.support + '.';
        addLog('s', line); bubble('s', line); toEnd();
      } else {
        go.disabled = false; go.textContent = 'Send to support';
        err.textContent = res.status === 429 ? 'You have sent several requests today. Please email ' + CFG.support + ' instead.'
          : res.j && res.j.error === 'bad_email' ? 'That email address does not look right.'
          : 'Could not send right now. Please try again, or email ' + CFG.support + '.';
      }
    }).catch(function () {
      go.disabled = false; go.textContent = 'Send to support';
      err.textContent = 'Could not send right now. Please try again, or email ' + CFG.support + '.';
    });
  }

  /* ---------- hand-over to the existing in-app support form (keeps plan priority) ---------- */
  var bypass = false;
  function openInApp() {
    close();
    bypass = true;
    var b = document.createElement('button'); b.setAttribute('data-act', 'support'); b.style.display = 'none';
    document.body.appendChild(b); try { b.click(); } finally { bypass = false; b.remove(); }
  }
  if (APP) {
    // On window (capture phase) so it runs before any document-level listener the app has registered.
    window.addEventListener('click', function (e) {
      if (bypass) return;
      var t = e.target && e.target.closest ? e.target.closest('[data-act="support"]') : null;
      if (!t) return;
      e.preventDefault(); e.stopImmediatePropagation(); open();
    }, true);
  }

  /* ---------- open / close ---------- */
  var lastFocus = null;
  function autosize() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 96) + 'px'; }
  function open() {
    if (panel.classList.contains('on')) { ta.focus(); return; }
    lastFocus = document.activeElement;
    renderAll(); panel.classList.add('on');
    if (fab) { fab.style.display = 'none'; fab.setAttribute('aria-expanded', 'true'); }
    setTimeout(function () { ta.focus(); }, 30);
  }
  function close() {
    panel.classList.remove('on');
    if (fab) { fab.style.display = ''; fab.setAttribute('aria-expanded', 'false'); }
    var f = fab || lastFocus; if (f && f.focus) try { f.focus(); } catch (e) { /* ignore */ }
  }
  if (fab) fab.addEventListener('click', open);
  xb.addEventListener('click', close);
  panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  sb.addEventListener('click', function () { send(ta.value); });
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); }
  });
  human.addEventListener('click', function () {
    if (busy) return;
    if (st.ticket && st.ticket.done && recentTicket()) {
      var m = 'You already have an open request (' + st.ticket.ref + '). Our team will reply by email.'; bubble('s', m); toEnd(); return;
    }
    if (!st.log.length) { send('I would like to talk to a human.', { forceEsc: true }); return; }
    st.esc = true; st.ticket = null; save();
    if (!msgs.querySelector('[data-sbc="esc"]')) msgs.appendChild(escCard());
    toEnd();
    var em = msgs.querySelector('#sbc-email'); if (em) em.focus();
  });

  window.SuboraChat = { open: open, close: close };
})();
