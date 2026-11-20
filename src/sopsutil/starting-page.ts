// Shown only to authorized top-level browser navigations while a cold container
// boots. API, WebSocket and Teams callers keep the original wait-for-ready path.
// Contains no configuration, version, host, identity or diagnostic details.
export const STARTING_REFRESH_SECONDS=15;
export function isBrowserNavigation(request:Request):boolean{
 if(request.method!=='GET')return false;
 if(request.headers.get('upgrade')?.toLowerCase()==='websocket')return false;
 const mode=request.headers.get('sec-fetch-mode');
 if(mode)return mode==='navigate'&&(request.headers.get('sec-fetch-dest')??'document')==='document';
 return /(^|[\s,;])text\/html([\s,;]|$)/i.test(request.headers.get('accept')??'');
}
const HTML=`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${STARTING_REFRESH_SECONDS}">
<meta name="robots" content="noindex">
<title>Sopsbot is starting</title>
<style>
html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;font-family:Poppins,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f7f5;color:#1f2a1f}
main{max-width:30rem;padding:2rem;text-align:center}
.bar{height:6px;border-radius:3px;background:linear-gradient(90deg,#2F8240,#50B147);margin-bottom:1.5rem}
h1{font-size:1.5rem;font-weight:600;margin:0 0 .75rem}
p{margin:.5rem 0;line-height:1.5}
.spinner{width:2.5rem;height:2.5rem;margin:1.5rem auto 0;border:4px solid #d7e9d4;border-top-color:#50B147;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation:none}}
</style></head>
<body><main>
<div class="bar"></div>
<h1>Sopsbot is starting &mdash; about 4 minutes</h1>
<p>It was asleep and is waking up now. This page refreshes automatically and opens Sopsbot as soon as it is ready.</p>
<p>You can leave this tab open.</p>
<div class="spinner" role="status" aria-label="Starting"></div>
</main></body></html>
`;
export function startingPage():Response{
 return new Response(HTML,{status:503,headers:{
  'Content-Type':'text/html; charset=utf-8',
  'Cache-Control':'no-store',
  'Retry-After':String(STARTING_REFRESH_SECONDS),
  'X-Robots-Tag':'noindex',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
 }});
}
