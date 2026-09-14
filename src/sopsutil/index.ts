import {Container,getContainer,ContainerProxy} from '@cloudflare/containers';
import runtime from './runtime.mjs';
export {ContainerProxy};
interface Env {SOPSUTIL_CONTAINER:DurableObjectNamespace<SopsutilContainer>;SOPSUTIL_DATA:R2Bucket;PUBLIC_ORIGIN:string;SOPSUTIL_CF_GATEWAY_PASSWORD?:string;}
export class SopsutilContainer extends Container<Env>{
 defaultPort=18789;
 requiredPorts=[18789,18790];
 pingEndpoint='localhost/healthz';
 sleepAfter='15m';
 entrypoint=['node','--input-type=module','-e',runtime];
 envVars={PUBLIC_ORIGIN:this.env.PUBLIC_ORIGIN,OPENCLAW_GATEWAY_PASSWORD:this.env.SOPSUTIL_CF_GATEWAY_PASSWORD??''};
 async onActivityExpired(){
  // Keep running if the checkpoint is unavailable; never deliberately sleep
  // with unsaved SQLite, configuration, or workspace state.
  const checkpoint=await this.containerFetch('http://localhost/checkpoint',{method:'POST'},18790);
  if(!checkpoint.ok)throw new Error('checkpoint_required_before_sleep');
  await this.stop('SIGTERM');
 }
 async diagnostics(){const r=await this.containerFetch('http://localhost/status',{},18790);return r.json();}
}
SopsutilContainer.outboundByHost={
 'sopsutil-storage.internal':async(request,env:Env)=>{
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&(path==='/seed'||path==='/source'||path==='/backup'||path==='/gh')){
   const key=path==='/gh'?'bootstrap/gh-2.100.0-linux-amd64':path==='/seed'?'bootstrap/seed.json':path==='/source'?'bootstrap/source.bundle':'backups/latest.tar.gz';
   const object=await env.SOPSUTIL_DATA.get(key);return object?new Response(object.body,{headers:{'Cache-Control':'no-store'}}):new Response('Missing',{status:404});
  }
  if(path==='/backup'&&request.method==='PUT'){
   const bytes=await request.arrayBuffer();if(bytes.byteLength>90*1024*1024)return new Response('Too large',{status:413});
   const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   await env.SOPSUTIL_DATA.put('backups/latest.tar.gz',bytes,{customMetadata:{sha256:checksum,createdAt:new Date().toISOString()}});
   return Response.json({ok:true});
  }
  return new Response('Forbidden',{status:403});
 }
};
function allowedIP(value:string){const p=value.split('.');return p.length===4&&p.slice(0,3).join('.')==='63.251.196'&&/^\d{1,3}$/.test(p[3])&&Number(p[3])<=255;}
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const url=new URL(request.url);
 const isTeamsWebhook=url.pathname==='/api/messages';
 // Preserve the operator's existing datacenter boundary. The only public
 // exception is the exact Bot Framework webhook: POST only, no query string,
 // no browser preflight, and no forwarding of client-controlled proxy headers.
 if(isTeamsWebhook){
  if(request.method!=='POST'||url.search)return new Response('Method not allowed',{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
  const contentType=request.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
  if(contentType!=='application/json')return new Response('Unsupported media type',{status:415,headers:{'Cache-Control':'no-store'}});
  const length=Number(request.headers.get('content-length')??'0');
  if(Number.isFinite(length)&&length>1024*1024)return new Response('Too large',{status:413,headers:{'Cache-Control':'no-store'}});
 }else if(!allowedIP(request.headers.get('CF-Connecting-IP')??''))return new Response('Forbidden',{status:403});
 if(!env.SOPSUTIL_CF_GATEWAY_PASSWORD)return new Response('Secure bootstrap pending',{status:503,headers:{'Cache-Control':'no-store'}});
 if(url.pathname.startsWith('/_deployment/'))return new Response('Not found',{status:404});
 const container=getContainer(env.SOPSUTIL_CONTAINER,'sopsutil-development');
 try{await container.startAndWaitForPorts({cancellationOptions:{portReadyTimeoutMS:180000,instanceGetTimeoutMS:60000}});}catch(error){
  const text=error instanceof Error?error.message:'';
  await env.SOPSUTIL_DATA.put('diagnostics/startup.json',JSON.stringify({at:new Date().toISOString(),message:text.split(env.SOPSUTIL_CF_GATEWAY_PASSWORD).join('[redacted]').slice(0,1000)}));
  const category=/image/i.test(text)?'image_start_failed':/port/i.test(text)?'port_not_ready':/timeout|timed out/i.test(text)?'startup_timeout':/exited|exit code/i.test(text)?'process_exited':'container_start_failed';
  return Response.json({ok:false,error:category},{status:503,headers:{'Cache-Control':'no-store'}});
 }
 const clean=new Request(request);for(const name of ['forwarded','x-forwarded-for','x-real-ip','x-forwarded-user','cf-access-authenticated-user-email','x-openclaw-scopes'])clean.headers.delete(name);
 clean.headers.set('X-Forwarded-For',request.headers.get('CF-Connecting-IP')!);
 clean.headers.set('X-Forwarded-Proto','https');clean.headers.set('X-Forwarded-Host',url.host);
 return container.fetch(clean);
}};
