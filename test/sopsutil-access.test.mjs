import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

// Exercise the actual Worker boundary without starting a container or sending mail.
const bundle=await build({entryPoints:['src/sopsutil/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{
 name:'private-container-stub',setup(build){
  build.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'containers',namespace:'test'}));
  build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`
   export class Container{}; export class ContainerProxy{};
   export function getContainer(){globalThis.__boundaryCalls++;return globalThis.__boundaryContainer;}
   export function switchPort(request,port){const r=new Request(request);r.headers.set('cf-container-target-port',String(port));return r;}
  `}));
  build.onLoad({filter:/\/sopsutil\/runtime\.mjs$/},()=>({contents:'export default "unchanged-runtime-not-executed";'}));
 }
}]} );
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const origin='https://sopsbot.tweai.dev';
const legacy='https://sopsutil-openclaw-dev.twe-technology-solutions.workers.dev';
const env={PUBLIC_ORIGIN:origin,SOPSUTIL_ACCESS_AUD:'this-app',SOPSUTIL_CF_GATEWAY_PASSWORD:'test-only'};
const context={access:{aud:'this-app'}};
async function invoke(path,options={},ctx={},paused=false){
 globalThis.__boundaryCalls=0;
 globalThis.__boundaryStarts=0;globalThis.__boundaryForwards=0;
 globalThis.__boundaryContainer={maintenancePaused:async()=>paused,startAndWaitForPorts:async()=>{globalThis.__boundaryStarts++;},fetch:async request=>{
  globalThis.__boundaryForwards++;
  globalThis.__forwardedRequest=request;
  return new Response('container reached');
 }};
 return worker.fetch(new Request(new URL(path,origin),options),env,ctx);
}
test('anonymous and forged identity headers cannot reach a container',async()=>{
 for(const headers of [{},{'CF-Connecting-IP':'63.251.196.131','Cf-Access-Authenticated-User-Email':'jmarcato@twe-solutions.com','Cf-Access-Jwt-Assertion':'forged'}]){
  assert.equal((await invoke('/',{headers})).status,403);assert.equal(globalThis.__boundaryCalls,0);
 }
});
test('missing or wrong audience fails closed even with native context',async()=>{
 assert.equal((await invoke('/',{},{access:{aud:'different-app'}})).status,403);
 assert.equal((await worker.fetch(new Request(origin),{...env,SOPSUTIL_ACCESS_AUD:undefined},context)).status,403);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('native context for this exact application reaches Gateway, preserving auth headers',async()=>{
 assert.equal((await invoke('/',{headers:{authorization:'Bearer gateway-test','X-Forwarded-For':'evil','Cf-Access-Authenticated-User-Email':'evil','CF-Connecting-IP':'192.0.2.1'}},context)).status,200);
 assert.equal(globalThis.__boundaryCalls,1);
 assert.equal(globalThis.__forwardedRequest.headers.get('X-Forwarded-For'),'192.0.2.1');
 assert.equal(globalThis.__forwardedRequest.headers.get('Cf-Access-Authenticated-User-Email'),null);
 assert.equal(globalThis.__forwardedRequest.headers.get('Authorization'),'Bearer gateway-test');
});
test('maintenance gate preserves Access denial and refuses authorized public startup without exposing configuration',async()=>{
 const denied=await invoke('/',{},{},true);assert.equal(denied.status,403);assert.equal(globalThis.__boundaryCalls,0);
 const paused=await invoke('/',{},context,true);assert.equal(paused.status,503);assert.deepEqual(await paused.json(),{ok:false,error:'upgrade_in_progress'});
 assert.equal(paused.headers.get('Cache-Control'),'no-store');assert.equal(globalThis.__boundaryStarts,0);assert.equal(globalThis.__boundaryForwards,0);
 const resumed=await invoke('/',{},context,false);assert.equal(resumed.status,200);assert.equal(globalThis.__boundaryStarts,1);assert.equal(globalThis.__boundaryForwards,1);
});
test('maintenance gate prevents signed Teams callback startup without broadening its authentication exception',async()=>{
 const paused=await invoke(legacy+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-not-a-real-token'},body:'{}'},{},true);
 assert.equal(paused.status,503);assert.equal(globalThis.__boundaryStarts,0);assert.equal(globalThis.__boundaryForwards,0);
 const unsigned=await invoke(legacy+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'},{},true);
 assert.equal(unsigned.status,401);assert.equal(globalThis.__boundaryCalls,0);
});
test('a request admitted just before maintenance cannot restart the old image through not-running recovery',async()=>{
 await invoke('/',{},context);let checks=0,restarts=0;
 globalThis.__boundaryContainer.maintenancePaused=async()=>++checks>1;
 globalThis.__boundaryContainer.startAndWaitForPorts=async()=>{throw new Error('container not running');};
 globalThis.__boundaryContainer.start=async()=>{restarts++;};
 const paused=await worker.fetch(new Request(origin),env,context);
 assert.equal(paused.status,503);assert.deepEqual(await paused.json(),{ok:false,error:'upgrade_in_progress'});assert.equal(restarts,0);
});
test('preview and alternate origin rejected, even with valid Access context',async()=>{
 assert.equal((await invoke('https://version-preview.example.workers.dev/',{},context)).status,403);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('client port override cannot reach the private diagnostic service',async()=>{
 assert.equal((await invoke('/checkpoint',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.1','cf-container-target-port':'18790'}},context)).status,200);
 assert.equal(globalThis.__forwardedRequest.headers.get('cf-container-target-port'),null);
});
test('retired public administration endpoints never invoke the container',async()=>{
 for(const path of ['/__restart-20260915','/_deployment/status']){
  assert.equal((await invoke(path,{method:'POST'},context)).status,404);assert.equal(globalThis.__boundaryCalls,0);
 }
});
test('Teams bypass does not extend to adjacent paths',async()=>{
 for(const path of ['/api/messages/','/api/messages/admin','/tools/invoke','/healthz'].flatMap(path=>[path,legacy+path])){
  assert.equal((await invoke(path,{method:'POST'})).status,403);assert.equal(globalThis.__boundaryCalls,0);
 }
});
test('unsigned Teams requests denied without waking a container',async()=>{
 assert.equal((await invoke(legacy+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('Teams method, query, type and size restrictions preserved',async()=>{
 for(const [path,options,status] of [
  ['/api/messages',{method:'GET'},405],
  ['/api/messages?x=1',{method:'POST'},405],
  ['/api/messages',{method:'POST',headers:{'Content-Type':'text/plain'}},415],
  ['/api/messages',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':String(1024*1024+1)}},413]
 ]){assert.equal((await invoke(legacy+path,options)).status,status);assert.equal(globalThis.__boundaryCalls,0);}
});
test('Teams bearer goes only to the existing Microsoft signature validator port',async()=>{
 assert.equal((await invoke(legacy+'/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-not-a-real-token'},body:'{}'})).status,200);
 assert.equal(globalThis.__forwardedRequest.headers.get('cf-container-target-port'),'3978');
});
test('legacy browser links redirect to canonical path and query only after Access',async()=>{
 for(const method of ['GET','HEAD']){
  const response=await invoke(legacy+'/chat/session?name=renewals%20work&view=one',{method},context);
  assert.equal(response.status,308);
  assert.equal(response.headers.get('location'),origin+'/chat/session?name=renewals%20work&view=one');
  assert.equal(globalThis.__boundaryCalls,0);
 }
 assert.equal((await invoke(legacy+'/chat/session?name=private')).status,403);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('legacy redirect cannot become an open redirect or forward API writes',async()=>{
 const response=await invoke(legacy+'//attacker.example/path?next=https://evil.example',{},context);
 assert.equal(response.status,308);
 assert.equal(new URL(response.headers.get('location')).origin,origin);
 assert.equal(new URL(response.headers.get('location')).pathname,'//attacker.example/path');
 assert.equal((await invoke(legacy+'/tools/invoke',{method:'POST'},context)).status,405);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('new canonical hostname has no public Teams exception',async()=>{
 assert.equal((await invoke('/api/messages',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-not-a-real-token'},body:'{}'})).status,403);
 assert.equal(globalThis.__boundaryCalls,0);
});
test('legacy administration endpoints remain retired before any redirect',async()=>{
 for(const path of ['/__restart-20260915','/_deployment/status']){
  assert.equal((await invoke(legacy+path,{method:'POST'},context)).status,404);
  assert.equal(globalThis.__boundaryCalls,0);
 }
});
