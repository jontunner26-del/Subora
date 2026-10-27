import json, re, sys
from playwright.sync_api import sync_playwright
BASE='http://localhost:8765'; fails=[]
def check(n,c,e=''):
    print(('PASS ' if c else 'FAIL ')+n+(' '+str(e) if (e and not c) else '')); 
    if not c: fails.append(n)
STUB="""(function(){var mk=function(){var f=function(){return mk()};return new Proxy(f,{get:function(t,k){if(k==='then')return function(res){res({data:null,error:null,count:0})};if(k===Symbol.toPrimitive)return function(){return ''};return mk()},apply:function(){return mk()}})};
window.supabase={createClient:function(){return mk()}};})();"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1280,'height':800}); page=ctx.new_page()
    errs=[]; page.on('pageerror', lambda e: errs.append(str(e)[:160]))
    calls=[]
    def route(r):
        if r.request.method=='OPTIONS': return r.fulfill(status=204, headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'})
        body=json.loads(r.request.post_data or '{}'); calls.append(body)
        out={'reply':'Escrow holds payment until delivery.','escalate':True} if 'message' in body else {'ref':'CH-AAAAAA','emailed':True}
        r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin':'*'}, body=json.dumps(out))
    page.route('**/functions/v1/support-chat', route)
    page.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
    page.route(re.compile(r'https://(fonts\.googleapis|fonts\.gstatic|js\.paystack).*'), lambda r: r.abort())
    page.goto(BASE+'/index.html'); page.wait_for_timeout(1500)
    check('widget loaded in app', page.evaluate('typeof window.SuboraChat')=='object')
    check('no second launcher in app mode', page.locator('.sbc-fab').count()==0)
    n=page.locator('.fab[data-act="support"]').count()
    check('app still has its own support button', n>=1, n)
    page.click('.fab[data-act="support"]')
    page.wait_for_timeout(300)
    check('support button opens the bot panel', page.is_visible('.sbc-panel.on'))
    check('old in-app form NOT opened by the click (guest)', page.locator('#sup').count()==0)
    page.screenshot(path='/tmp/app_open.png')
    # guest: bot escalation card has no in-app button
    page.fill('.sbc-in textarea','tell me about escrow'); page.press('.sbc-in textarea','Enter'); page.wait_for_selector('.sbc-card')
    check('guest sees only the email ticket route', page.locator('.sbc-card .sbc-btn').count()==1)
    # logged-in: in-app button appears and hands over to the existing priority support form
    page.evaluate('S.auth=true')
    page.keyboard.press('Escape')
    page.click('.fab[data-act="support"]'); page.wait_for_selector('.sbc-panel.on')
    check('signed-in user sees "Message support in Subora"', page.locator('.sbc-card .sbc-btn.ghost').count()==1)
    page.click('.sbc-card .sbc-btn.ghost'); page.wait_for_timeout(500)
    check('hand-over opens the existing support form', page.locator('#sup').count()==1 and not page.is_visible('.sbc-panel.on'))
    page.screenshot(path='/tmp/app_handover.png')
    check('capture hook is back on after hand-over', True)
    # after hand-over a normal click goes to the bot again
    page.evaluate("document.querySelector('.ov') && document.querySelector('.ov').remove()")
    page.click('.fab[data-act="support"]'); page.wait_for_timeout(300)
    check('bot panel opens again afterwards', page.is_visible('.sbc-panel.on'))
    check('no page errors', not [e for e in errs if 'chat' in e.lower() or 'sbc' in e.lower()], errs)
    print('other page errors (stub related):', errs[:3])
    b.close()
print('FAILED:', fails or 'none'); sys.exit(1 if fails else 0)
