import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,rename,rm,stat,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
const root='/home/node/.openclaw';
const storage='http://sopsutil-storage.internal';
const cli='/app/openclaw.mjs';
let ghVersion=null;
let gateway, checkpointing=false, lastBackup=null, failure=null, shuttingDown=false;
function run(args){return new Promise((res,rej)=>{const child=spawn('node',[cli,...args],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;if(output.length>4e6)child.kill();});child.stderr.resume();child.on('error',rej);child.on('close',code=>code===0?res(output):rej(new Error('cli_failed_'+args[0]+'_'+code)));});}
async function request(path,init){const r=await fetch(storage+path,{...init,signal:AbortSignal.timeout(240000)});if(!r.ok&&r.status!==404)throw new Error('storage_http_'+r.status);return r;}
async function restore(){
 const r=await request('/backup');if(r.status===404)return;
 const archive='/home/node/restore.tar.gz';await writeFile(archive,Buffer.from(await r.arrayBuffer()),{mode:0o600});
 const target='/home/node/restore-stage';await run(['backup','restore',archive,'--target',target,'--json']);
 const roots=await readdir(target);if(roots.length!==1)throw new Error('restore_root_count');
 const manifest=JSON.parse(await readFile(join(target,roots[0],'manifest.json'),'utf8'));
 const asset=manifest.assets.find(a=>a.kind==='state');if(!asset||asset.sourcePath!==root)throw new Error('restore_state_identity');
 const source=resolve(target,asset.archivePath);if(!source.startsWith(target+'/'))throw new Error('restore_path');
 // The official image has only an empty bootstrap workspace here on a fresh disk.
 const entries=await readdir(root).catch(()=>[]);if(entries.some(e=>e!=='workspace'))throw new Error('refuse_existing_state');
 if(entries.includes('workspace')&&(await readdir(join(root,'workspace'))).length)throw new Error('refuse_existing_workspace');
 await rm(root,{recursive:true,force:true});await rename(source,root);
 await rm(target,{recursive:true,force:true});await rm(archive);console.log('state_restore_verified');
}
async function checkpoint(){
 if(checkpointing)throw new Error('checkpoint_busy');checkpointing=true;
 const out='/home/node/checkpoints';
 try{
  await mkdir(out,{recursive:true,mode:0o700});
  const report=JSON.parse(await run(['backup','create','--output',out,'--verify','--json']));
  const file=report.archivePath;if(typeof file!=='string'||!file.startsWith(out+'/'))throw new Error('backup_path');
  if((await stat(file)).size>90*1024*1024)throw new Error('backup_size_limit');
  await request('/backup',{method:'PUT',body:await readFile(file)});await rm(file);lastBackup=new Date().toISOString();failure=null;
  console.log('checkpoint_uploaded');return {ok:true,lastBackup};
 }catch(e){failure=e.message;throw e;}finally{checkpointing=false;}
}
async function installGitHubCli(){
 // Verified official release binary, delivered via the private Worker binding.
 // Reinstall outside the archived state on every cold start; never copy auth.
 const response=await request('/gh');if(response.status===404)throw new Error('github_cli_missing');
 const binary=Buffer.from(await response.arrayBuffer());
 if(createHash('sha256').update(binary).digest('hex')!=='553949e2efa12842771efe6012aa4de21f1d591530ec17fc435f610f10e017ee')throw new Error('github_cli_checksum');
 const bin='/home/node/.local/bin';await mkdir(bin,{recursive:true});
 await writeFile(join(bin,'gh'),binary,{mode:0o755});await chmod(join(bin,'gh'),0o755);
 process.env.PATH=bin+':'+(process.env.PATH??'/usr/local/bin:/usr/bin:/bin');
 ghVersion=await new Promise((res,rej)=>{const child=spawn('gh',['--version'],{stdio:['ignore','pipe','ignore']});let output='';child.stdout.on('data',b=>output+=b);child.on('error',rej);child.on('close',code=>code===0?res(output.split('\n')[0]):rej(new Error('github_cli_version_failed')));});
}
async function main(){
 await installGitHubCli();
 await restore();await mkdir(root,{recursive:true,mode:0o700});
 const seedResponse=await request('/seed');if(seedResponse.status===404)throw new Error('seed_missing');
 const seed=await seedResponse.json();const workspace=join(root,'workspace-sopsutil');await mkdir(workspace,{recursive:true,mode:0o700});
 for(const [name,content]of Object.entries(seed)){
  if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.split('/').includes('..')||name.startsWith('/'))throw new Error('unsafe_seed_path');
  const file=join(workspace,name);try{await stat(file);}catch(e){if(e.code!=='ENOENT')throw e;await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,content,{mode:0o600});}
 }
 const checkout=join(workspace,'sopsutil');
 try{await stat(join(checkout,'.git'));}catch(e){
  if(e.code!=='ENOENT')throw e;
  const bundleResponse=await request('/source');if(bundleResponse.status===404)throw new Error('source_missing');
  const bundle='/home/node/source.bundle';await writeFile(bundle,Buffer.from(await bundleResponse.arrayBuffer()),{mode:0o600});
  const git=(args)=>new Promise((res,rej)=>{const child=spawn('git',args,{stdio:'ignore'});child.on('error',rej);child.on('close',code=>code===0?res():rej(new Error('git_bootstrap_failed')));});
  await git(['clone',bundle,checkout]);await git(['-C',checkout,'remote','set-url','origin','https://github.com/twesolutions/sopsutil.git']);
  await git(['-C',checkout,'config','user.name','SopsUtil Cloudflare']);await git(['-C',checkout,'config','user.email','sopsutil@twe.ai']);await rm(bundle);
 }
 const configPath=join(root,'openclaw.json');let config={};try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 config.gateway={...config.gateway,mode:'local',port:18789,bind:'lan',trustedProxies:[...new Set([...(config.gateway?.trustedProxies??[]),'10.1.0.0'])],auth:{mode:'password',password:{source:'env',provider:'default',id:'OPENCLAW_GATEWAY_PASSWORD'}},controlUi:{...config.gateway?.controlUi,allowedOrigins:[process.env.PUBLIC_ORIGIN]}};
 config.agents??={};config.agents.defaults={...config.agents.defaults,workspace};
 config.agents.list??=[{id:'sopsutil',name:'SopsUtil Cloudflare',default:true,workspace}];
 await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});await run(['config','validate']);
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  try{
   if(req.url==='/status'&&req.method==='GET'){res.end(JSON.stringify({ok:true,lastBackup,failure,checkpointing,ghVersion,proxyPeer:req.socket.remoteAddress}));return;}
   if(req.url==='/checkpoint'&&req.method==='POST'){res.end(JSON.stringify(await checkpoint()));return;}
   if(req.url==='/devices'&&req.method==='GET'){res.end(await run(['devices','list','--json']));return;}
   res.statusCode=404;res.end('{}');
  }catch{res.statusCode=503;res.end(JSON.stringify({error:'operation_failed'}));}
 });server.listen(18790,'0.0.0.0');
 gateway=spawn('node',[cli,'gateway','--bind','lan','--port','18789'],{stdio:'inherit'});
 gateway.on('exit',code=>{if(!shuttingDown)process.exit(code??1);});
 const timer=setInterval(()=>checkpoint().catch(()=>console.error('checkpoint_failed')),300000);timer.unref();
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(shuttingDown)return;shuttingDown=true;clearInterval(timer);gateway.kill('SIGTERM');await new Promise(r=>gateway.once('exit',r));try{await checkpoint();}catch{console.error('final_checkpoint_failed');process.exit(1);}server.close();process.exit(0);});
}
main().catch(e=>{console.error('bootstrap_failed',e.message);process.exit(1);});
