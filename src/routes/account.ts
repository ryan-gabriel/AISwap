import { Router } from 'express'

const router = Router()

router.get('/account', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      [
        '<!doctype html><html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>Manage subscription</title>',
        '<style>',
        'body{font-family:system-ui,sans-serif;max-width:32rem;margin:6rem auto;padding:0 1rem;line-height:1.6;color:canvastext}',
        '.card{border:1px solid color-mix(in srgb, canvastext 30%, canvas);border-radius:12px;padding:1.5rem}',
        'h1{font-size:1.25rem;margin:0 0 0.5rem}', 'p{color:graytext}',
        '.status{margin:0 0 1rem;font-size:0.95rem}',
        'button{width:100%;padding:0.6rem;border-radius:8px;border:1px solid canvastext;background:canvas;cursor:pointer;font-size:0.9rem}',
        'button:disabled{opacity:0.6;cursor:default}', '.muted{font-size:0.8rem}',
        '</style></head><body>',
        '<div class="card">',
        '<h1>Manage subscription</h1>',
        '<p id="status" class="status">Loading\u2026</p>',
        '<button id="cancelBtn" type="button">Cancel subscription</button>',
        '<p id="message" class="muted" hidden></p>',
        '<p class="muted">Payment-method updates are handled by Lemon Squeezy. Contact support for card changes.</p>',
        '</div>',
        '<script>',
        '(function(){',
        'function tokenFromHash(){var h=location.hash.replace(/^#/,"");if(!h)return null;var p=new URLSearchParams(h);return p.get("token")}',
        'var token=tokenFromHash();',
        'if(token){history.replaceState(null,"",location.pathname+location.search)}',
        'var status=document.getElementById("status");',
        'var msg=document.getElementById("message");',
        'var btn=document.getElementById("cancelBtn");',
        'if(!token){status.textContent="Missing session token";return}',
        'function headers(){return{Authorization:"Bearer "+token}}',
        'fetch("/api/license",{headers:headers()})',
        '.then(function(r){return r.json()})',
        '.then(function(d){status.textContent=d.licenseTier+" \u00b7 "+(d.subscriptionStatus||"none")+" \u00b7 expires "+(d.expiresAt?new Date(d.expiresAt).toLocaleDateString():"never")})',
        '.catch(function(){status.textContent="Could not load subscription"})',
        'function show(text){msg.hidden=false;msg.textContent=text;window.setTimeout(function(){msg.hidden=true},5000)}',
        'btn.addEventListener("click",function(){',
        'btn.disabled=true;btn.textContent="Canceling\u2026";',
        'fetch("/api/account/cancel",{method:"POST",headers:headers()})',
        '.then(function(r){return r.json().then(function(b){return{ok:r.ok,b:b}});})',
        '.then(function(r){if(r.ok){show("Subscription canceled. You keep Pro until the end of the paid period.");status.textContent="canceled \u00b7 Pro until period end"}else{show((r.b&&r.b.error)||"Cancel failed");btn.disabled=false;btn.textContent="Cancel subscription"}})',
        '.catch(function(){show("Cancel failed");btn.disabled=false;btn.textContent="Cancel subscription"});',
        '});',
        '})();',
        '</script></body></html>',
      ].join(''),
    )
})

export default router