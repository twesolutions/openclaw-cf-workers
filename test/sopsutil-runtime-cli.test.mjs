import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import vm from 'node:vm';
const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const fn=source.slice(source.indexOf('function run('),source.indexOf('async function request('));
function fixture({chunks=['x'.repeat(4_000_001)],stderr=[],code,signal=null,spawnError,stallStarted=false}={}){
 let killed=false,release;const reports=[];
 const child=new EventEmitter();child.pid=123;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed=true;};
 const spawn=()=>{queueMicrotask(()=>{
  for(const chunk of chunks)child.stdout.emit('data',chunk);
  for(const chunk of stderr)child.stderr.emit('data',chunk);
  if(spawnError)child.emit('error',spawnError);
  child.emit('close',code??(killed?143:0),signal);
 });return child;};
 const diagnostic=async(stage,details)=>{if(stallStarted&&stage==='cli_started')await new Promise(resolve=>release=resolve);reports.push({stage,...details});};
 return {run:vm.runInNewContext('let lastCli=null;'+fn+'\nrun',{spawn,cli:'/app/openclaw.mjs',Buffer,Date,diagnostic,redactDiagnostic:v=>v}),killed:()=>killed,reports,release:()=>release()};
}
test('large unused restore reports are drained and counted without terminating a successful restore',async()=>{
 const f=fixture();assert.equal(await f.run(['backup','restore'],{capture:false}),'');assert.equal(f.killed(),false);
 assert.match(source,/run\(\['backup','restore'.*capture:false/);
 assert.equal(f.reports.length,2);assert.equal(f.reports[0].stage,'cli_started');assert.equal(f.reports[0].stdoutBytes,0);
 const r=f.reports[1];assert.equal(r.command,'backup restore');assert.equal(r.pid,123);assert.equal(r.stdoutBytes,4_000_001);assert.equal(r.code,0);assert.equal(r.signal,null);assert.equal(r.ownKillReason,null);assert.ok(r.elapsedMS>=0);
});
test('commands whose JSON is consumed retain bounded output refusal with an explicit own-kill reason',async()=>{
 const f=fixture();await assert.rejects(f.run(['plugins','inspect']),/cli_output_limit_plugins_143/);assert.equal(f.killed(),true);
 assert.equal(f.reports[1].ownKillReason,'stdout_capture_limit');assert.equal(f.reports[1].code,143);
});
test('external SIGTERM is distinguished from runtime output-limit termination and counts stderr bytes',async()=>{
 const f=fixture({chunks:['💥'],stderr:['é'],code:143,signal:'SIGTERM'});
 await assert.rejects(f.run(['plugins','install','private-unreported-argument']),/cli_failed_plugins_143/);
 const r=f.reports[1];assert.equal(r.stdoutBytes,4);assert.equal(r.stderrBytes,2);assert.equal(r.signal,'SIGTERM');assert.equal(r.ownKillReason,null);assert.equal(f.killed(),false);
 assert.equal(JSON.stringify(f.reports).includes('private-unreported-argument'),false);
});
test('closed telemetry is ordered after start telemetry even when start persistence is delayed',async()=>{
 const f=fixture({chunks:[],stallStarted:true});const result=f.run(['doctor','--fix']);await Promise.resolve();assert.equal(f.reports.length,0);f.release();await result;
 assert.deepEqual(f.reports.map(r=>r.stage),['cli_started','cli_closed']);
});
test('spawn failure is reported once even when the child later closes',async()=>{
 const f=fixture({chunks:[],spawnError:new Error('spawn unavailable')});await assert.rejects(f.run(['doctor','--fix']),/spawn unavailable/);
 assert.equal(f.reports.length,2);assert.equal(f.reports[1].spawnError,'spawn unavailable');assert.equal(f.reports[1].ownKillReason,null);
});
