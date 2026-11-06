import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const functions=['redactDiagnostic','diagnostic','watchGateway'].map(name=>{
 const fn=source.match(new RegExp('(?:async )?function '+name+'\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}'))?.[0];assert.ok(fn,name);return fn;
}).join('\n');
function setup({fetchImpl,timeoutMS}={}){
 const reports=[],exits=[];let exited;
 const exit=new Promise(resolve=>exited=resolve);
 const context={Buffer,AbortController,Object,Date,Promise,encodeURIComponent,storage:'http://sopsutil-storage.internal',shuttingDown:false,
  process:{version:'v24.8.0',env:{OPENCLAW_GATEWAY_PASSWORD:'fixture-secret-value',CLOUDFLARE_AI_API_TOKEN:'fixture-inference-token'},exit:code=>{exits.push(code);exited();}},
  readFile:async path=>{assert.equal(path,'/app/package.json');return JSON.stringify({version:'2026.11.1'});},
  fetch:fetchImpl??(async(url,options)=>{assert.equal(url,'http://sopsutil-storage.internal/diagnostic');reports.push(options.body);return {ok:true};}),
  setTimeout:timeoutMS===undefined?setTimeout:(fn,ms)=>{assert.equal(ms,2000);return setTimeout(fn,timeoutMS);},clearTimeout,
 };
 return {api:vm.runInNewContext(functions+'\n({redactDiagnostic,diagnostic,watchGateway})',context),context,reports,exits,exit};
}
function child(){const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();return c;}
test('unexpected nonzero Gateway failure persists actual version, signal/code and redacted output before exit',async()=>{
 const f=setup(),c=child();f.api.watchGateway(c,Promise.resolve());
 c.stdout.emit('data',Buffer.from('startup detail\npassword fixture-'));
 c.stderr.emit('data',Buffer.from('secret-value\napiKey=unknown-key\nBearer unknown-bearer\nhttps://proxy.example/?key=private\nsk-proj-unknowncredential\nfatal: database schema refused\n'));
 c.emit('exit',1,null);c.emit('close',1,null);await f.exit;
 assert.deepEqual(f.exits,[1]);assert.equal(f.reports.length,1);
 const report=JSON.parse(f.reports[0]);assert.equal(report.stage,'gateway_exited');assert.equal(report.code,1);assert.equal(report.signal,null);
 assert.equal(report.openclawVersion,'2026.11.1');assert.equal(report.nodeVersion,'v24.8.0');assert.match(report.tail,/database schema refused/);
 for(const secret of ['fixture-secret-value','unknown-key','unknown-bearer','proxy.example','sk-proj-unknowncredential'])assert.equal(f.reports[0].includes(secret),false);
});
test('Gateway exit report follows the pending spawned diagnostic rather than being overwritten by it',async()=>{
 const f=setup(),c=child();let release;const started=new Promise(resolve=>release=resolve);
 f.api.watchGateway(c,started);c.stderr.emit('data',Buffer.from('fatal startup failure'));c.emit('exit',2,'SIGABRT');
 assert.equal(f.exits.length,0);assert.equal(f.reports.length,0);release();await f.exit;
 assert.equal(JSON.parse(f.reports[0]).signal,'SIGABRT');assert.deepEqual(f.exits,[2]);
});
test('all diagnostics are valid bounded JSON with versions and retain the operational error tail',async()=>{
 const f=setup();await f.api.diagnostic('bootstrap_failed',{message:'fixture-inference-token',tail:'💥'.repeat(6000)+'\nfatal: import missing'});
 assert.ok(Buffer.byteLength(f.reports[0])<=4096);const r=JSON.parse(f.reports[0]);assert.match(r.tail,/fatal: import missing$/);
 assert.equal(r.message,'[redacted]');assert.equal(r.openclawVersion,'2026.11.1');assert.equal(r.nodeVersion,'v24.8.0');
});
test('stalled diagnostic persistence is bounded and still permits the Gateway failure exit',async()=>{
 const f=setup({fetchImpl:async()=>new Promise(()=>{}),timeoutMS:10}),c=child();f.api.watchGateway(c,Promise.resolve());
 c.emit('exit',7,null);await f.exit;assert.deepEqual(f.exits,[7]);
});
test('expected shutdown does not overwrite failure diagnostics or trigger a second process exit',async()=>{
 const f=setup(),c=child();f.context.shuttingDown=true;f.api.watchGateway(c,Promise.resolve());c.emit('exit',0,null);c.emit('close',0,null);
 await Promise.resolve();assert.equal(f.reports.length,0);assert.equal(f.exits.length,0);
});
