import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {build} from 'esbuild';

// Business-hours keep-awake (approved 2026-11-20) and the cold-start page.
// No container is started and nothing is sent anywhere.
async function load(entry,stub){
 const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'stub',setup(b){
  b.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'containers',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:stub}));
  b.onLoad({filter:/\/sopsutil\/runtime\.mjs$/},()=>({contents:'export default "not-executed";'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const {isBusinessHours}=await load('src/sopsutil/business-hours.ts','');
const workerStub='export class Container{constructor(){this.env={};}};export class ContainerProxy{};export function getContainer(namespace,name){globalThis.__calls.getContainer++;if(name!=="sopsutil-development")throw Error("wrong container");return globalThis.__stub;};export function switchPort(r,p){const x=new Request(r);x.headers.set("cf-container-target-port",String(p));return x;};';
const mod=await load('src/sopsutil/index.ts',workerStub);
const worker=mod.default,{SopsutilContainer}=mod;

// Independent oracle: US rules since 2007 (second Sunday of March 02:00 PST to
// first Sunday of November 02:00 PDT), computed without Intl.
function pacificOracle(ms){
 const y=new Date(ms).getUTCFullYear();
 const nthSunday=(month,n)=>{const first=new Date(Date.UTC(y,month,1)).getUTCDay();return 1+((7-first)%7)+7*(n-1);};
 const dstStart=Date.UTC(y,2,nthSunday(2,2),10);  // 02:00 PST = 10:00Z
 const dstEnd=Date.UTC(y,10,nthSunday(10,1),9);   // 02:00 PDT = 09:00Z
 const local=new Date(ms-(ms>=dstStart&&ms<dstEnd?7:8)*3600000);
 const day=local.getUTCDay(),minute=local.getUTCHours()*60+local.getUTCMinutes();
 return day>=1&&day<=5&&minute>=420&&minute<1080;
}

test('business hours: exact weekday edges in PST and PDT',()=>{
 for(const [iso,expected] of [
  ['2026-11-23T14:55:00Z',false], // Mon 06:55 PST
  ['2026-11-23T15:00:00Z',true],  // Mon 07:00 PST
  ['2026-11-24T01:55:00Z',true],  // Mon 17:55 PST
  ['2026-11-24T02:00:00Z',false], // Mon 18:00 PST
  ['2026-11-20T15:10:00Z',true],  // Fri 07:10 PST
  ['2026-11-21T01:59:59Z',true],  // Fri 17:59:59 PST
  ['2026-11-21T02:00:00Z',false], // Fri 18:00 PST
  ['2026-07-06T13:55:00Z',false], // Mon 06:55 PDT
  ['2026-07-06T14:00:00Z',true],  // Mon 07:00 PDT
  ['2026-07-07T00:55:00Z',true],  // Mon 17:55 PDT
  ['2026-07-07T01:00:00Z',false], // Mon 18:00 PDT
 ])assert.equal(isBusinessHours(new Date(iso)),expected,iso);
});
test('business hours: weekends are never awake, including Monday-UTC Sunday evenings',()=>{
 for(const iso of ['2026-11-21T18:00:00Z','2026-11-22T20:00:00Z','2026-11-23T01:00:00Z','2026-11-21T15:00:00Z','2026-07-11T17:00:00Z','2026-07-12T21:00:00Z'])assert.equal(isBusinessHours(new Date(iso)),false,iso);
 // Friday 17:00 PST is Saturday 01:00 UTC but still a Pacific business hour.
 assert.equal(isBusinessHours(new Date('2026-11-21T01:00:00Z')),true);
});
test('business hours: DST transition weeks shift the UTC window by one hour',()=>{
 // Spring forward Sunday 2026-03-08: Friday before is PST, Monday after is PDT.
 assert.equal(isBusinessHours(new Date('2026-03-06T14:30:00Z')),false); // Fri 06:30 PST
 assert.equal(isBusinessHours(new Date('2026-03-06T15:00:00Z')),true);  // Fri 07:00 PST
 assert.equal(isBusinessHours(new Date('2026-03-09T14:00:00Z')),true);  // Mon 07:00 PDT
 assert.equal(isBusinessHours(new Date('2026-03-09T13:55:00Z')),false); // Mon 06:55 PDT
 assert.equal(isBusinessHours(new Date('2026-03-08T15:00:00Z')),false); // the Sunday itself
 // Fall back Sunday 2026-11-01: Friday before is PDT, Monday after is PST.
 assert.equal(isBusinessHours(new Date('2026-10-30T14:00:00Z')),true);  // Fri 07:00 PDT
 assert.equal(isBusinessHours(new Date('2026-10-31T01:00:00Z')),false); // Fri 18:00 PDT
 assert.equal(isBusinessHours(new Date('2026-11-02T14:30:00Z')),false); // Mon 06:30 PST
 assert.equal(isBusinessHours(new Date('2026-11-02T15:00:00Z')),true);  // Mon 07:00 PST
 assert.equal(isBusinessHours(new Date('2026-11-03T01:30:00Z')),true);  // Mon 17:30 PST
 assert.equal(isBusinessHours(new Date('2026-11-03T02:00:00Z')),false); // Mon 18:00 PST
});
test('business hours: every 5-minute cron tick of 2026-2027 matches an independent DST oracle',()=>{
 let awake=0;
 for(let t=Date.UTC(2026,0,1);t<Date.UTC(2028,0,1);t+=300000){const got=isBusinessHours(t);assert.equal(got,pacificOracle(t),new Date(t).toISOString());if(got)awake++;}
 // 261 weekdays in 2026 + 261 in 2027, 132 five-minute ticks per 11-hour day.
 assert.equal(awake,(261+261)*132);
 assert.equal(isBusinessHours(NaN),false);
});

// --- Cron handler -----------------------------------------------------------
function cronEnv(){const puts=[];return {puts,env:{PUBLIC_ORIGIN:'https://sopsbot.tweai.dev',SOPSUTIL_CF_GATEWAY_PASSWORD:'test-secret-value',SOPSUTIL_CONTAINER:{},SOPSUTIL_DATA:{async put(key,value){puts.push({key,value:JSON.parse(value)});}}}};}
async function runCron(iso,keepAwake=async()=>({action:'renewed'})){
 globalThis.__calls={getContainer:0,keepAwake:0};globalThis.__stub={keepAwake:async()=>{globalThis.__calls.keepAwake++;return keepAwake();}};
 const {puts,env}=cronEnv();await worker.scheduled({scheduledTime:Date.parse(iso),cron:'*/5 * * * *'},env,{waitUntil(){}});return puts;
}
test('cron outside business hours does nothing: no Durable Object, container or R2 access',async()=>{
 for(const iso of ['2026-11-21T18:00:00Z','2026-11-23T14:55:00Z','2026-11-24T02:00:00Z','2026-11-22T20:00:00Z']){
  const puts=await runCron(iso);assert.equal(globalThis.__calls.getContainer,0,iso);assert.equal(globalThis.__calls.keepAwake,0);assert.equal(puts.length,0);
 }
});
test('cron inside business hours keeps the container awake and records only the outcome',async()=>{
 const puts=await runCron('2026-11-23T15:00:00Z',async()=>({action:'started'}));
 assert.equal(globalThis.__calls.keepAwake,1);assert.equal(puts.length,1);assert.equal(puts[0].key,'diagnostics/keep-awake.json');
 assert.equal(puts[0].value.action,'started');assert.equal(puts[0].value.scheduledTime,'2026-11-23T15:00:00.000Z');
});
test('cron failure is recorded with secrets redacted and never throws',async()=>{
 const puts=await runCron('2026-11-23T16:00:00Z',async()=>{throw new Error('start failed test-secret-value');});
 assert.equal(puts[0].value.action,'failed');assert.ok(!JSON.stringify(puts).includes('test-secret-value'));
});
test('cron does nothing before the Gateway secret exists',async()=>{
 globalThis.__calls={getContainer:0};const {puts,env}=cronEnv();delete env.SOPSUTIL_CF_GATEWAY_PASSWORD;
 await worker.scheduled({scheduledTime:Date.parse('2026-11-23T16:00:00Z')},env,{});assert.equal(globalThis.__calls.getContainer,0);assert.equal(puts.length,0);
});

// --- Durable Object keep-awake / browser startup -----------------------------
function container({running=false,paused=false,ports=true,start}={}){
 const c=new SopsutilContainer();const state=new Map([['sopsutil-maintenance-paused',paused]]);const log={starts:[],renews:0,puts:[]};
 c.env={SOPSUTIL_CF_GATEWAY_PASSWORD:'test-secret-value',SOPSUTIL_DATA:{async put(key,value){log.puts.push({key,value});}}};
 c.requiredPorts=[18789,18790,3978];c.pingEndpoint='localhost/healthz';c.defaultPort=18789;
 c.ctx={storage:{async get(k){return typeof state.get(k)==='function'?state.get(k)():state.get(k);},async put(k,v){state.set(k,v);}},container:{running,getTcpPort(port){return {async fetch(){if(ports===true||(Array.isArray(ports)&&ports.includes(port)))return new Response('ok');throw new Error('the container is not listening');}};}}};
 c.renewActivityTimeout=()=>{log.renews++;};
 c.start=start??(async(...args)=>{log.starts.push(args);await new Promise(r=>setTimeout(r,5));c.ctx.container.running=true;});
 return {c,log,state};
}
test('keepAwake never starts or renews while maintenance has paused public starts',async()=>{
 for(const running of [false,true]){const {c,log}=container({running,paused:true});assert.deepEqual(await c.keepAwake(),{action:'paused'});assert.equal(log.starts.length,0);assert.equal(log.renews,0);}
 const {c,log}=container({paused:true});assert.equal(await c.browserStartup(),'paused');assert.equal(log.starts.length,0);
});
test('keepAwake renews a running container without restarting it',async()=>{
 const {c,log}=container({running:true});assert.deepEqual(await c.keepAwake(),{action:'renewed'});assert.equal(log.renews,1);assert.equal(log.starts.length,0);
});
test('keepAwake warm-starts a stopped container with the normal entrypoint and environment',async()=>{
 const {c,log}=container();assert.deepEqual(await c.keepAwake(),{action:'started'});assert.equal(log.starts.length,1);
 assert.equal(log.starts[0][0],undefined);assert.equal(log.starts[0][1].portToCheck,18789);assert.equal(log.starts[0][1].retries*log.starts[0][1].waitInterval>=60000,true);
});
test('cron and browser wakes are single-flight: one start for concurrent callers',async()=>{
 const {c,log}=container();
 const results=await Promise.all([c.keepAwake(),c.browserStartup(),c.browserStartup(),c.keepAwake()]);
 assert.equal(log.starts.length,1);assert.deepEqual(results.slice(1,3),['starting','starting']);
 // Once started and ports answer, the next browser check is ready without another start.
 assert.equal(await c.browserStartup(),'ready');assert.equal(log.starts.length,1);
});
test('a pause set between the first check and the start still prevents the start',async()=>{
 let reads=0;const {c,log,state}=container();state.set('sopsutil-maintenance-paused',()=>++reads>1);
 await assert.rejects(c.keepAwake(),/maintenance_paused/);assert.equal(log.starts.length,0);
});
test('browser readiness requires every required port; a booting container is not restarted',async()=>{
 const {c,log}=container({running:true,ports:[18789]});assert.equal(await c.browserStartup(),'starting');assert.equal(log.starts.length,0);
 const ready=container({running:true});assert.equal(await ready.c.browserStartup(),'ready');
});
test('browser startup returns the page promptly even if instance provisioning is slow',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 try{
  const {c}=container({start:()=>new Promise(()=>{})});let settled=false;
  const pending=c.browserStartup().then(v=>{settled=true;return v;});
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.equal(settled,false);mock.timers.tick(8000);assert.equal(await pending,'starting');
 }finally{mock.timers.reset();}
});
test('a failed wake records a redacted startup diagnostic',async()=>{
 const {c,log}=container({start:async()=>{throw new Error('boom test-secret-value');}});
 await assert.rejects(c.keepAwake(),/boom/);assert.equal(log.puts[0].key,'diagnostics/startup.json');assert.ok(!log.puts[0].value.includes('test-secret-value'));
 assert.equal(await c.browserStartup(),'starting');
});

// --- Worker starting page ----------------------------------------------------
const origin='https://sopsbot.tweai.dev',legacy='https://sopsutil-openclaw-dev.twe-technology-solutions.workers.dev';
const env={PUBLIC_ORIGIN:origin,SOPSUTIL_ACCESS_AUD:'this-app',SOPSUTIL_CF_GATEWAY_PASSWORD:'test-secret-value'};
const access={access:{aud:'this-app'}};
const nav={'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Accept:'text/html,application/xhtml+xml,*/*;q=0.8'};
async function visit(url,init={},ctx=access,{startup='starting',paused=false}={}){
 globalThis.__calls={getContainer:0,browserStartup:0,startAndWaitForPorts:0,forwards:0};
 globalThis.__stub={maintenancePaused:async()=>paused,browserStartup:async()=>{globalThis.__calls.browserStartup++;return startup;},startAndWaitForPorts:async()=>{globalThis.__calls.startAndWaitForPorts++;},fetch:async()=>{globalThis.__calls.forwards++;return new Response('gateway');}};
 return worker.fetch(new Request(new URL(url,origin),init),env,ctx);
}
test('authorized browser navigation during a cold start gets the starting page, not a hanging request',async()=>{
 const r=await visit('/chat?session=main',{headers:nav});
 assert.equal(r.status,503);assert.match(r.headers.get('content-type'),/^text\/html/);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.ok(Number(r.headers.get('retry-after'))>0);
 const body=await r.text();assert.match(body,/Sopsbot is starting &mdash; about 4 minutes/);assert.match(body,/http-equiv="refresh" content="\d+"/);
 for(const secret of ['test-secret-value','sopsutil-development','workers.dev','this-app','18789','R2','openclaw'])assert.ok(!body.includes(secret),secret);
 assert.equal(globalThis.__calls.browserStartup,1);assert.equal(globalThis.__calls.startAndWaitForPorts,0);assert.equal(globalThis.__calls.forwards,0);
 // Older clients without Fetch Metadata are recognised by Accept: text/html.
 assert.equal((await visit('/',{headers:{Accept:'text/html'}})).status,503);assert.equal(globalThis.__calls.browserStartup,1);
});
test('a ready container serves browser navigations normally',async()=>{
 const r=await visit('/',{headers:nav},access,{startup:'ready'});assert.equal(r.status,200);assert.equal(await r.text(),'gateway');
 assert.equal(globalThis.__calls.startAndWaitForPorts,1);assert.equal(globalThis.__calls.forwards,1);
});
test('API, asset, WebSocket, iframe and write requests never get the starting page',async()=>{
 for(const init of [
  {headers:{Accept:'application/json'}},
  {headers:{'Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty',Accept:'*/*'}},
  {headers:{'Sec-Fetch-Mode':'no-cors','Sec-Fetch-Dest':'script',Accept:'*/*'}},
  {headers:{...nav,'Sec-Fetch-Dest':'iframe'}},
  {headers:{...nav,Upgrade:'websocket',Connection:'Upgrade'}},
  {method:'POST',headers:{...nav,'Content-Type':'application/json'},body:'{}'},
  {method:'HEAD',headers:nav},
 ]){const r=await visit('/tools/invoke',init);assert.equal(r.status,200);assert.equal(globalThis.__calls.browserStartup,0);assert.equal(globalThis.__calls.startAndWaitForPorts,1);}
});
test('starting page is only after Access, and never during maintenance or for Teams',async()=>{
 const denied=await visit('/',{headers:nav},{});assert.equal(denied.status,403);assert.equal(globalThis.__calls.getContainer,0);
 const paused=await visit('/',{headers:nav},access,{paused:true});assert.equal(paused.status,503);assert.deepEqual(await paused.json(),{ok:false,error:'upgrade_in_progress'});assert.equal(globalThis.__calls.browserStartup,0);
 const pausedLate=await visit('/',{headers:nav},access,{startup:'paused'});assert.deepEqual(await pausedLate.json(),{ok:false,error:'upgrade_in_progress'});assert.equal(globalThis.__calls.forwards,0);
 const redirect=await visit(legacy+'/chat',{headers:nav});assert.equal(redirect.status,308);assert.equal(globalThis.__calls.getContainer,0);
 const teams=await visit(legacy+'/api/messages',{method:'POST',headers:{...nav,'Content-Type':'application/json',Authorization:'Bearer x'},body:'{}'},{});
 assert.equal(teams.status,200);assert.equal(globalThis.__calls.browserStartup,0);assert.equal(globalThis.__calls.startAndWaitForPorts,1);
});
