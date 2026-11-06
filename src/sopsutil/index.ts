import {Container,getContainer,ContainerProxy,switchPort} from '@cloudflare/containers';
import runtime from './runtime.mjs';
import modelConfig from '../../deploy/sopsutil/models.json';
import {hasApplicationAccess} from './access';
export {ContainerProxy};
interface Env {SOPSUTIL_CONTAINER:DurableObjectNamespace<SopsutilContainer>;SOPSUTIL_DATA:R2Bucket;PUBLIC_ORIGIN:string;SOPSUTIL_ACCESS_AUD?:string;SOPSUTIL_CF_GATEWAY_PASSWORD?:string;SOPSUTIL_CF_AI_TOKEN?:string;SOPSUTIL_TEAMS_CERTIFICATE_B64?:string;}
const LEGACY_ORIGIN='https://sopsutil-openclaw-dev.twe-technology-solutions.workers.dev';
export class SopsutilContainer extends Container<Env>{
 defaultPort=18789;
 requiredPorts=[18789,18790,3978];
 pingEndpoint='localhost/healthz';
 sleepAfter='15m';
 entrypoint=['node','--input-type=module','-e',runtime];
 envVars={PUBLIC_ORIGIN:this.env.PUBLIC_ORIGIN,OPENCLAW_GATEWAY_PASSWORD:this.env.SOPSUTIL_CF_GATEWAY_PASSWORD??'',CLOUDFLARE_AI_API_TOKEN:this.env.SOPSUTIL_CF_AI_TOKEN??'',SOPSUTIL_TEAMS_CERTIFICATE_B64:this.env.SOPSUTIL_TEAMS_CERTIFICATE_B64??''};
 async onActivityExpired(){
  // Keep running if the checkpoint is unavailable; never deliberately sleep
  // with unsaved SQLite, configuration, or workspace state.
  const checkpoint=await this.containerFetch('http://localhost/checkpoint',{method:'POST'},18790);
  if(!checkpoint.ok)throw new Error('checkpoint_required_before_sleep');
  await this.stop('SIGTERM');
 }
 async diagnostics(){const r=await this.containerFetch('http://localhost/status',{},18790);return r.json();}
 async modelEnvironment(){return {containerRunning:this.ctx.container?.running??false,workerSecretPresent:!!this.env.SOPSUTIL_CF_AI_TOKEN,runtimeSecretPresent:!!this.envVars.CLOUDFLARE_AI_API_TOKEN,environmentNames:Object.keys(this.envVars)};}
 async #nativeExec(args:string[],timeoutMS=240000){
  if(!this.ctx.container?.running)throw new Error('maintenance_requires_running');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMS);
  try{const process=await this.ctx.container.exec(args,{env:{HOME:'/home/node',OPENCLAW_STATE_DIR:'/home/node/.openclaw',...this.envVars},signal:controller.signal});process.exitCode.then(()=>clearTimeout(timer),()=>clearTimeout(timer));return process;}catch(e){clearTimeout(timer);throw e;}
 }
 // Account-only RPC maintenance; never routed from the public Worker.
 async maintenanceInfo():Promise<unknown>{
  if(!this.ctx.container?.running)throw new Error('maintenance_requires_running');
  const process=await this.#nativeExec(['node','--input-type=module','-e',`import{readFile,readdir,stat}from'node:fs/promises';import{spawnSync}from'node:child_process';const root='/home/node/.openclaw';const c=JSON.parse(await readFile(root+'/openclaw.json','utf8'));const backups=[];for(const name of await readdir('/home/node/checkpoints').catch(()=>[])){const s=await stat('/home/node/checkpoints/'+name);if(s.isFile())backups.push({name,size:s.size});}console.log(JSON.stringify({version:spawnSync('node',['/app/openclaw.mjs','--version'],{encoding:'utf8'}).stdout.trim(),node:process.version,primary:c.agents?.defaults?.model,reloadMode:c.gateway?.reload?.mode??'hybrid',backups}));`],60000);
  const out=await process.output();if(out.exitCode!==0)throw new Error('maintenance_inspect_failed');return JSON.parse(new TextDecoder().decode(out.stdout));
 }
 async checkpointArchive():Promise<{ok:boolean;key:string;size:number;sha256:string;createdAt:string}>{
  if(!this.ctx.container?.running)throw new Error('checkpoint_requires_running');
  const process=await this.#nativeExec(['node','--input-type=module','-e',`import{spawn}from'node:child_process';import{stat}from'node:fs/promises';import{createReadStream}from'node:fs';import{createHash}from'node:crypto';const child=spawn('node',['/app/openclaw.mjs','backup','create','--output','/home/node/checkpoints','--verify','--json'],{stdio:['ignore','pipe','ignore']});const closed=new Promise(r=>child.on('close',r));let data='';for await(const b of child.stdout)data+=b;const code=await closed;if(code!==0)throw Error('native_backup_failed');const b=JSON.parse(data);if(!b.verified||b.dryRun||b.onlyConfig||b.includeWorkspace!==true||!b.assets?.some(a=>a.kind==='state'&&a.sourcePath==='/home/node/.openclaw')||!b.archivePath?.startsWith('/home/node/checkpoints/'))throw Error('full_verified_backup_required');const size=(await stat(b.archivePath)).size;const h=createHash('sha256');for await(const data of createReadStream(b.archivePath))h.update(data);console.log(JSON.stringify({archivePath:b.archivePath,size,sha256:h.digest('hex'),createdAt:b.createdAt,verified:true}));`]);
  const out=await process.output();if(out.exitCode!==0)throw new Error('native_checkpoint_failed');
  const report=JSON.parse(new TextDecoder().decode(out.stdout));if(!report.size||report.size>2*1024*1024*1024)throw new Error('checkpoint_size_invalid');
  const key='backups/verified-'+new Date().toISOString().replace(/[:.]/g,'-')+'.tar.gz';
  for(const destination of [key,'backups/latest.tar.gz']){
   const copy=await this.#nativeExec(['cat',report.archivePath]);
   if(!copy.stdout)throw new Error('checkpoint_stream_missing');const stream=new FixedLengthStream(report.size);
   const [,stored,exitCode]=await Promise.all([copy.stdout.pipeTo(stream.writable),this.env.SOPSUTIL_DATA.put(destination,stream.readable,{sha256:report.sha256,customMetadata:{sha256:report.sha256,createdAt:report.createdAt}}),copy.exitCode]);
   if(exitCode!==0||!stored)throw new Error('checkpoint_stream_failed');
   const head=await this.env.SOPSUTIL_DATA.head(destination);if(head?.size!==report.size||head?.customMetadata?.sha256!==report.sha256)throw new Error('checkpoint_readback_failed');
  }
  return {ok:true,key,size:report.size,sha256:report.sha256,createdAt:report.createdAt};
 }
 async checkpointAndStop():Promise<unknown>{const checkpoint=await this.checkpointArchive();await this.stop('SIGTERM');return checkpoint;}
 async msteamsStatus(){const r=await this.containerFetch('http://localhost/msteams-status',{},18790);return r.json();}
 async checkpointAndRestart(){const r=await this.containerFetch('http://localhost/checkpoint',{method:'POST'},18790);if(!r.ok)throw new Error('checkpoint_required_before_restart');const result=await r.json();await this.stop('SIGTERM');return result;}
}
SopsutilContainer.outboundByHost={
 'sopsutil-storage.internal':async(request,env:Env)=>{
  const path=new URL(request.url).pathname;
  if(path==='/models'&&request.method==='GET')return Response.json(modelConfig,{headers:{'Cache-Control':'no-store'}});
  if(request.method==='GET'&&(path==='/seed'||path==='/source'||path==='/backup'||path==='/gh'||path==='/msteams')){
   const key=path==='/msteams'?'bootstrap/openclaw-msteams-2026.9.3-bundle.tgz':path==='/gh'?'bootstrap/gh-2.100.0-linux-amd64':path==='/seed'?'bootstrap/seed.json':path==='/source'?'bootstrap/source.bundle':'backups/latest.tar.gz';
   const object=await env.SOPSUTIL_DATA.get(key);return object?new Response(object.body,{headers:{'Cache-Control':'no-store'}}):new Response('Missing',{status:404});
  }
  if(path==='/backup'&&request.method==='PUT'){
   const bytes=await request.arrayBuffer();if(bytes.byteLength>90*1024*1024)return new Response('Too large',{status:413});
   const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   await env.SOPSUTIL_DATA.put('backups/latest.tar.gz',bytes,{customMetadata:{sha256:checksum,createdAt:new Date().toISOString()}});
   return Response.json({ok:true});
  }
  if(path==='/diagnostic'&&request.method==='PUT'){
   const bytes=await request.arrayBuffer();if(bytes.byteLength>4096)return new Response('Too large',{status:413});
   await env.SOPSUTIL_DATA.put('diagnostics/runtime.json',bytes,{customMetadata:{createdAt:new Date().toISOString()}});return Response.json({ok:true});
  }
  return new Response('Forbidden',{status:403});
 }
};
export default {async fetch(request:Request,env:Env,ctx:ExecutionContext & {access?:{aud:string}}):Promise<Response>{
 const url=new URL(request.url);
 // Only the canonical hostname and the original signed Teams callback exist.
 // Preview URLs and alternate hostnames must never bypass hostname Access.
 const isLegacy=url.origin===LEGACY_ORIGIN;
 if(url.origin!==env.PUBLIC_ORIGIN&&!isLegacy)return new Response('Forbidden',{status:403});
 if(url.pathname.startsWith('/__restart-')||url.pathname.startsWith('/_deployment/'))return new Response('Not found',{status:404});
 const isTeamsWebhook=isLegacy&&url.pathname==='/api/messages';
 // The exact Bot Framework webhook retains its separate Microsoft signature
 // validation at port 3978. It grants no browser or Gateway API access.
 if(isTeamsWebhook){
  if(request.method!=='POST'||url.search)return new Response('Method not allowed',{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
  const contentType=request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
  if(contentType!=='application/json')return new Response('Unsupported media type',{status:415,headers:{'Cache-Control':'no-store'}});
  const length=Number(request.headers.get('content-length')??'0');
  if(Number.isFinite(length)&&length>1024*1024)return new Response('Too large',{status:413,headers:{'Cache-Control':'no-store'}});
  if(!/^Bearer \S+$/i.test(request.headers.get('authorization')??''))return new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store'}});
 }else{
  if(!hasApplicationAccess(ctx,env.SOPSUTIL_ACCESS_AUD))return new Response('Cloudflare One access required',{status:403,headers:{'Cache-Control':'no-store'}});
  if(isLegacy){
   if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
   const destination=new URL(env.PUBLIC_ORIGIN);destination.pathname=url.pathname;destination.search=url.search;
   return new Response(null,{status:308,headers:{Location:destination.href,'Cache-Control':'no-store'}});
  }
 }
 if(!env.SOPSUTIL_CF_GATEWAY_PASSWORD)return new Response('Secure bootstrap pending',{status:503,headers:{'Cache-Control':'no-store'}});
 const container=getContainer(env.SOPSUTIL_CONTAINER,'sopsutil-development');
 try{
  try{await container.startAndWaitForPorts({cancellationOptions:{portReadyTimeoutMS:180000,instanceGetTimeoutMS:60000}});}catch(first){
   if(!/not running/i.test(first instanceof Error?first.message:''))throw first;
   await container.start();
   await container.startAndWaitForPorts({cancellationOptions:{portReadyTimeoutMS:180000,instanceGetTimeoutMS:60000}});
  }
 }catch(error){
  const text=error instanceof Error?error.message:'';
  await env.SOPSUTIL_DATA.put('diagnostics/startup.json',JSON.stringify({at:new Date().toISOString(),message:text.split(env.SOPSUTIL_CF_GATEWAY_PASSWORD).join('[redacted]').slice(0,1000)}));
  const category=/image/i.test(text)?'image_start_failed':/port/i.test(text)?'port_not_ready':/timeout|timed out/i.test(text)?'startup_timeout':/exited|exit code/i.test(text)?'process_exited':'container_start_failed';
  return Response.json({ok:false,error:category},{status:503,headers:{'Cache-Control':'no-store'}});
 }
 const clean=new Request(request);for(const name of ['forwarded','x-forwarded-for','x-real-ip','x-forwarded-user','cf-access-authenticated-user-email','x-openclaw-scopes','cf-container-target-port'])clean.headers.delete(name);
 clean.headers.set('X-Forwarded-For',request.headers.get('CF-Connecting-IP')!);
 clean.headers.set('X-Forwarded-Proto','https');clean.headers.set('X-Forwarded-Host',url.host);
 return container.fetch(isTeamsWebhook?switchPort(clean,3978):clean);
}};
