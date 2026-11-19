import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/sopsutil/index.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'container-stub',setup(b){b.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'container',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class Container{constructor(){this.env={};}};export class ContainerProxy{};export function getContainer(namespace,name){if(name!=="sopsutil-development")throw Error("wrong container");return namespace.stub;};export function switchPort(){};'}));b.onLoad({filter:/\/sopsutil\/runtime\.mjs$/},()=>({contents:'export default "not-executed";'}));}}]});
const {SopsutilContainer}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.FixedLengthStream=class extends TransformStream{constructor(size){let bytes=0;super({transform(chunk,c){bytes+=chunk.length;c.enqueue(chunk);},flush(){assert.equal(bytes,size);}});}};
function setup({running=true,backupExit=0,backupError=null,corruptHead=false,cleanupExit=0,ready=true,archiveSize}={}){
 const bytes=Buffer.alloc(2*1024*1024,7);const sha256=createHash('sha256').update(bytes).digest('hex');const calls=[],stored=new Map(),state=new Map();
 const c=new SopsutilContainer();c.env={SOPSUTIL_DATA:{async put(key,stream,options){const data=Buffer.from(await new Response(stream).arrayBuffer());assert.equal(createHash('sha256').update(data).digest('hex'),options.sha256);stored.set(key,{size:data.length,customMetadata:options.customMetadata});return {};},async head(key){calls.push({head:key});const h=stored.get(key);return corruptHead?{...h,size:0}:h;}}};
 c.env.SOPSUTIL_CONTAINER={stub:c};
 c.ctx={storage:{async get(key){return state.get(key);},async put(key,value){state.set(key,value);}},container:{running,getTcpPort(port){assert.equal(port,18790);return {async fetch(url){calls.push({ready:url});if(ready===null)throw new Error('not listening');return new Response('{}',{status:ready?200:503});}};},async exec(args,options){calls.push({args,options});if(args[0]==='cat')return {stdout:new Blob([bytes]).stream(),exitCode:Promise.resolve(0)};if(args[3]?.includes('await unlink(path)'))return {exitCode:Promise.resolve(cleanupExit)};return {exitCode:Promise.resolve(backupExit),async output(){return {exitCode:backupExit,stdout:Buffer.from(JSON.stringify(backupError??{archivePath:'/home/node/checkpoints/full.tar.gz',size:archiveSize??bytes.length,sha256,createdAt:'2026-11-06T00:00:00Z'}))};}};}}};c.stop=async()=>calls.push({stop:true});return {c,calls,stored};
}
test('stopped container is never started or checkpointed',async()=>{const {c,calls}=setup({running:false});await assert.rejects(c.checkpointAndStop(),/requires_running/);assert.equal(calls.length,0);});
test('native backup failure leaves running bot untouched',async()=>{const {c,calls,stored}=setup({backupExit:1});await assert.rejects(c.checkpointAndStop(),/native_checkpoint_failed/);assert.equal(stored.size,0);assert.ok(!calls.some(x=>x.stop));});
test('archive streams to immutable and latest objects with digest checks before exact-file cleanup and stop',async()=>{const {c,calls,stored}=setup();const r=await c.checkpointAndStop();assert.equal(r.ok,true);assert.equal(stored.size,2);assert.ok(stored.has('backups/latest.tar.gz'));assert.equal(calls.at(-1).stop,true);assert.equal(calls[0].ready,'http://localhost/status');assert.equal(calls[1].options.env.HOME,'/home/node');const cleanup=calls.findIndex(x=>x.args?.[3]?.includes('await unlink(path)'));assert.equal(calls[cleanup].args.at(-1),'/home/node/checkpoints/full.tar.gz');assert.equal(calls[cleanup-1].head,'backups/latest.tar.gz');assert.equal(calls.filter(x=>x.head).length,2);assert.ok(cleanup<calls.length-1);});
test('readback mismatch prevents archive removal and any stop',async()=>{const {c,calls}=setup({corruptHead:true});await assert.rejects(c.checkpointAndStop(),/readback_failed/);assert.ok(!calls.some(x=>x.stop||x.args?.[3]?.includes('await unlink(path)')));});
test('routine native checkpoints stream latest only without retaining another immutable copy',async()=>{const {c,calls,stored}=setup();const r=await c.checkpointArchive(false);assert.equal(r.key,'backups/latest.tar.gz');assert.deepEqual([...stored.keys()],['backups/latest.tar.gz']);assert.equal(calls.filter(x=>x.args?.[0]==='cat').length,1);assert.ok(calls.at(-1).args[3].includes('await unlink(path)'));assert.ok(!calls.some(x=>x.stop));});
test('cleanup failure prevents a successful checkpoint response or stop',async()=>{const {c,calls,stored}=setup({cleanupExit:1});await assert.rejects(c.checkpointAndStop(),/cleanup_failed/);assert.equal(stored.size,2);assert.ok(!calls.some(x=>x.stop));});
test('private container-only outbound RPC invokes latest-only streaming and returns its verified metadata',async()=>{const {c,calls,stored}=setup();const handler=SopsutilContainer.outboundByHost['sopsutil-storage.internal'];const response=await handler(new Request('http://sopsutil-storage.internal/checkpoint-native',{method:'POST'}),c.env);const report=await response.json();assert.equal(report.ok,true);assert.equal(report.key,'backups/latest.tar.gz');assert.equal(stored.size,1);assert.ok(!calls.some(x=>x.stop));const denied=await handler(new Request('http://sopsutil-storage.internal/checkpoint-native'),c.env);assert.equal(denied.status,403);});
test('account-only maintenance pause persists exact booleans without starting or touching the container',async()=>{const {c,calls}=setup({running:false});assert.equal(await c.maintenancePaused(),false);await c.setMaintenancePaused(true);assert.equal(await c.maintenancePaused(),true);await assert.rejects(c.setMaintenancePaused('false'),/requires_boolean/);assert.equal(await c.maintenancePaused(),true);await c.setMaintenancePaused(false);assert.equal(await c.maintenancePaused(),false);assert.equal(calls.length,0);});

test('structured native CLI failure never publishes an archive or stops the bot',async()=>{const {c,calls,stored}=setup({backupError:{error:'native_backup_cli_failed',code:143,stderr:'operational error'}});await assert.rejects(c.checkpointAndStop(),/native_backup_cli_failed/);assert.equal(stored.size,0);assert.ok(!calls.some(x=>x.stop||x.args?.[0]==='cat'));});

test('native checkpoint creates the output directory and preserves an earlier file collision before backup',async()=>{const {c,calls}=setup();await c.checkpointArchive();const script=calls.find(x=>x.args).args[3];assert.ok(script.indexOf('await mkdir(directory')<script.indexOf("const child=spawn"));assert.ok(script.includes("await rename(directory,'/home/node/checkpoints-preserved-'"));});

test('native full backup creation keeps a 15-minute budget beyond the former 240s abort',async()=>{
 mock.timers.enable({apis:['setTimeout']});
 try{
  let signal,finish;const done=new Promise(resolve=>finish=resolve);
  const c=new SopsutilContainer();c.env={};
  c.ctx={container:{running:true,getTcpPort(){return {fetch:async()=>new Response('{}')};},async exec(args,options){signal=options.signal;return {exitCode:new Promise(()=>{}),async output(){await done;return {exitCode:1,stdout:Buffer.from('{}')};}};}}};
  const pending=c.checkpointArchive().catch(e=>e);
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(signal);mock.timers.tick(240001);assert.equal(signal.aborted,false);
  mock.timers.tick(900000-240001-1);assert.equal(signal.aborted,false);
  mock.timers.tick(2);assert.equal(signal.aborted,true);
  finish();assert.match((await pending).message,/native_checkpoint_failed/);
 }finally{mock.timers.reset();}
});

test('a bootstrapping container (runtime status not listening) is never archived or stopped',async()=>{
 for(const ready of [null,false]){const {c,calls,stored}=setup({ready});await assert.rejects(c.checkpointAndStop(),/checkpoint_requires_ready_runtime/);assert.equal(stored.size,0);assert.ok(!calls.some(x=>x.stop||x.args));}
});
test('a near-empty verified archive is refused before any R2 write',async()=>{
 const {c,calls,stored}=setup({archiveSize:581});await assert.rejects(c.checkpointAndStop(),/checkpoint_size_invalid/);assert.equal(stored.size,0);assert.ok(!calls.some(x=>x.stop||x.args?.[0]==='cat'));
});
