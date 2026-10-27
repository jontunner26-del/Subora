import json, re, sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:8765'
fails=[]
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ')+name+(' '+str(extra) if (extra and not cond) else ''))
    if not cond: fails.append(name)

def mock(page, handler):
    calls=[]
    def route(r):
        req=r.request
        if req.method=='OPTIONS':
            return r.fulfill(status=204, headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'})
        body=json.loads(req.post_data or '{}'); calls.append(body)
        status, payload = handler(body)
        r.fulfill(status=status, content_type='application/json', headers={'access-control-allow-origin':'*'}, body=json.dumps(payload))
    page.route('**/functions/v1/support-chat', route)
    page.route(re.compile(r'https://(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|js\.paystack).*'), lambda r: r.abort())
    return calls

def handler(body):
    if body.get('action')=='ticket':
        if body.get('email')=='limit@x.com': return 429, {'error':'rate_limited'}
        return 200, {'ref':'CH-7K3MQ2','emailed':True,'existing':False}
    m=body['message']
    if 'xss' in m: return 200, {'reply':'<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=1</script>','escalate':False}
    if 'refund' in m.lower(): return 200, {'reply':'Refunds are covered in /refunds.\n\n- Open **Report a problem** on the order\n- Wait for review\n\nEmail support@subora.com.ng if stuck.','escalate':True}
    if 'boom' in m: return 500, {'error':'server_error'}
    return 200, {'reply':'Escrow holds your payment until you confirm delivery. See /safety and /faq.','escalate':False}

with sync_playwright() as p:
    b=p.chromium.launch()
    # ---------- desktop, static page ----------
    ctx=b.new_context(viewport={'width':1280,'height':800}); page=ctx.new_page()
    errs=[]; page.on('pageerror', lambda e: errs.append(str(e)))
    calls=mock(page, handler)
    page.goto(BASE+'/faq.html'); page.wait_for_selector('.sbc-fab')
    check('fab visible on static page', page.is_visible('.sbc-fab'))
    page.click('.sbc-fab')
    check('panel opens', page.is_visible('.sbc-panel.on'))
    check('fab hidden while open', not page.is_visible('.sbc-fab'))
    check('greeting + 4 quick chips', page.locator('.sbc-chip').count()==4)
    check('AI label shown', 'AI' in page.inner_text('.sbc-hd'))
    page.screenshot(path='/tmp/desktop_open.png')
    page.click('.sbc-chip >> nth=0')
    page.wait_for_selector('.sbc-b:has-text("Escrow holds")')
    check('request has uuid session + message', len(calls)==1 and re.match(r'^[0-9a-f-]{36}$',calls[0]['session_id']) and calls[0]['message']=='How does escrow work?', calls)
    check('chips gone after first message', page.locator('.sbc-chip').count()==0)
    check('paths linked', page.locator('.sbc-b a[href="/safety"]').count()==1 and page.locator('.sbc-b a[href="/faq"]').count()==1)
    check('links open in new tab safely', page.get_attribute('.sbc-b a[href="/safety"]','rel')=='noopener' and page.get_attribute('.sbc-b a[href="/safety"]','target')=='_blank')
    # XSS
    page.fill('.sbc-in textarea','xss test'); page.press('.sbc-in textarea','Enter')
    page.wait_for_selector('.sbc-b:has-text("onerror")')
    check('HTML in reply shown as text, not executed', page.evaluate('window.__pwned')is None and page.locator('.sbc-msgs img, .sbc-msgs script').count()==0)
    # escalation
    page.fill('.sbc-in textarea','I want a refund'); page.press('.sbc-in textarea','Enter')
    page.wait_for_selector('.sbc-card')
    check('escalation card shown', page.is_visible('.sbc-card'))
    check('list + bold + mailto rendered', page.locator('.sbc-b ul li').count()==2 and page.locator('.sbc-b strong:has-text("Report a problem")').count()==1 and page.locator('a[href="mailto:support@subora.com.ng"]').count()==1)
    page.screenshot(path='/tmp/desktop_escalate.png')
    page.fill('#sbc-email','not-an-email'); page.click('.sbc-card .sbc-btn')
    check('invalid email blocked client-side', 'valid email' in page.inner_text('.sbc-err') and len(calls)==3)
    page.fill('#sbc-email','Jon@Example.com'); page.fill('#sbc-note','Order 123, payment missing')
    page.click('.sbc-card .sbc-btn')
    page.wait_for_selector('.sbc-s')
    tk=calls[-1]
    check('ticket request shape', tk.get('action')=='ticket' and tk['email']=='Jon@Example.com' and tk['note']=='Order 123, payment missing' and tk['session_id']==calls[0]['session_id'], tk)
    check('confirmation shows reference and email', 'CH-7K3MQ2' in page.inner_text('.sbc-s') and 'Jon@Example.com' in page.inner_text('.sbc-s'))
    check('card removed after ticket', page.locator('.sbc-card').count()==0)
    page.screenshot(path='/tmp/desktop_ticket.png')
    # persistence across reload
    page.reload(); page.wait_for_selector('.sbc-fab'); page.click('.sbc-fab')
    check('history restored after reload', page.locator('.sbc-u').count()==3 and page.locator('.sbc-s').count()==1)
    # human button while a ticket is fresh
    page.click('.sbc-ft button')
    check('duplicate human request explained', page.locator('.sbc-s:has-text("already have an open request")').count()==1)
    # escape closes + focus returns
    page.keyboard.press('Escape')
    check('Escape closes and returns focus to button', not page.is_visible('.sbc-panel.on') and page.evaluate("document.activeElement.className")=='sbc-fab')
    check('no page errors (desktop)', not errs, errs)
    ctx.close()

    # ---------- fresh visitor: Talk to a human first ----------
    ctx=b.new_context(viewport={'width':1280,'height':800}); page=ctx.new_page()
    calls=mock(page, handler); page.goto(BASE+'/about.html'); page.click('.sbc-fab')
    page.click('.sbc-ft button'); page.wait_for_selector('.sbc-card')
    check('human-first sends a message then shows the form', len(calls)==1 and 'human' in calls[0]['message'] and page.is_visible('.sbc-card'))
    page.fill('#sbc-email','limit@x.com'); page.click('.sbc-card .sbc-btn')
    page.wait_for_selector('.sbc-err:has-text("support@subora.com.ng")')
    check('ticket 429 shows the email fallback and keeps the form', page.locator('.sbc-card').count()==1)
    ctx.close()

    # ---------- server error ----------
    ctx=b.new_context(viewport={'width':1280,'height':800}); page=ctx.new_page()
    calls=mock(page, handler); page.goto(BASE+'/contact.html'); page.click('.sbc-fab')
    page.fill('.sbc-in textarea','boom'); page.press('.sbc-in textarea','Enter')
    page.wait_for_selector('.sbc-card')
    check('500 gives an apology and a human option', 'something went wrong' in page.inner_text('.sbc-msgs'))
    # offline
    page.route('**/functions/v1/support-chat', lambda r: r.abort())
    page.fill('.sbc-in textarea','hello'); page.press('.sbc-in textarea','Enter')
    page.wait_for_selector('.sbc-b:has-text("could not reach")')
    check('network failure handled', True)
    check('send re-enabled after failure', not page.is_disabled('.sbc-in .sbc-btn'))
    ctx.close()

    # ---------- mobile + dark ----------
    ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme='dark'); page=ctx.new_page()
    calls=mock(page, handler); page.goto(BASE+'/safety.html'); page.click('.sbc-fab')
    box=page.locator('.sbc-panel').bounding_box()
    check('mobile panel is full screen', box['width']>=389 and box['height']>=843, box)
    fs=page.evaluate("getComputedStyle(document.querySelector('.sbc-in textarea')).fontSize")
    check('input font 16px (no iOS zoom)', fs=='16px', fs)
    page.fill('.sbc-in textarea','I want a refund'); page.press('.sbc-in textarea','Enter'); page.wait_for_selector('.sbc-card')
    check('no horizontal overflow on mobile', page.evaluate('document.querySelector(".sbc-msgs").scrollWidth<=document.querySelector(".sbc-msgs").clientWidth+1'))
    page.screenshot(path='/tmp/mobile_dark.png')
    ctx.close()
    b.close()
print('\nFAILED:', fails if fails else 'none'); sys.exit(1 if fails else 0)
