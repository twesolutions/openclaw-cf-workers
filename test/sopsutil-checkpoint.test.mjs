import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/sopsutil/index.ts'],bundle:true,write:false,format:'esm',plugins:[{name:'container-stub',setup(b){b.onResolve({filter:/^@cloudflare\/containers$/},()=>({path:'container',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export class Container{constructor(){this.env={};}};export class ContainerProxy{};export function getContainer(){};export function switchPort(){};'}));b.onLoad({filter:/\/sopsutil\/runtime\.mjs$/},()=>({contents:'export default "not-executed";'}));}}]});
const {SopsutilContainer}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
globalThis.FixedLengthStream=class extends TransformStream{constructor(size){let bytes=0;super({transform(chunk,c){bytes+=chunk.length;c.enqueue(chunk);},flush(){assert.equal(bytes,size);}});}};
function setup({running=true,backupExit=0,corruptHead=false}={}){
 const bytes=Buffer.from('verified archive bytes');const sha256=createHash('sha256').update(bytes).digest('hex');const calls=[],stored=new Map();
 const c=new SopsutilContainer();c.env={SOPSUTIL_DATA:{async put(key,stream,options){const data=Buffer.from(await new Response(stream).arrayBuffer());assert.equal(createHash('sha256').update(data).digest('hex'),options.sha256);stored.set(key,{size:data.length,customMetadata:options.customMetadata});return {};},async head(key){const h=stored.get(key);return corruptHead?{...h,size:0}:h;}}};
 c.ctx={container:{running,async exec(args,options){calls.push({args,options});if(args[0]==='cat')return {stdout:new Blob([bytes]).stream(),exitCode:Promise.resolve(0)};return {async output(){return {exitCode:backupExit,stdout:Buffer.from(JSON.stringify({archivePath:'/home/node/checkpoints/full.tar.gz',size:bytes.length,sha256,createdAt:'2026-11-06T00:00:00Z'}))};}};}}};c.stop=async()=>calls.push({stop:true});return {c,calls,stored};
}
test('stopped container is never started or checkpointed',async()=>{const {c,calls}=setup({running:false});await assert.rejects(c.checkpointAndStop(),/requires_running/);assert.equal(calls.length,0);});
test('native backup failure leaves running bot untouched',async()=>{const {c,calls,stored}=setup({backupExit:1});await assert.rejects(c.checkpointAndStop(),/native_checkpoint_failed/);assert.equal(stored.size,0);assert.ok(!calls.some(x=>x.stop));});
test('archive streams to immutable and latest objects with digest checks before stop',async()=>{const {c,calls,stored}=setup();const r=await c.checkpointAndStop();assert.equal(r.ok,true);assert.equal(stored.size,2);assert.ok(stored.has('backups/latest.tar.gz'));assert.equal(calls.at(-1).stop,true);assert.equal(calls[0].options.env.HOME,'/home/node');});
test('readback mismatch prevents any stop',async()=>{const {c,calls}=setup({corruptHead:true});await assert.rejects(c.checkpointAndStop(),/readback_failed/);assert.ok(!calls.some(x=>x.stop));});
