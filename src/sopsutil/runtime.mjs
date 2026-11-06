import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir,rename,rm,stat,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
const root='/home/node/.openclaw';
const storage='http://sopsutil-storage.internal';
const cli='/app/openclaw.mjs';
const teamsVersion='2026.11.1';
const teamsMigrationPath=join(root,'.bootstrap','teams-pre-migration-'+teamsVersion+'.json');
const migrationReceiptPath=join(root,'.bootstrap','native-migration-complete.json');
const TWE_MEMBER_OBJECT_IDS=["0ba3858b-543d-414f-b735-5a1437fb882e","147d4c18-e7a2-42c8-93c7-0893cb76daa7","175241ec-a658-436d-82ed-af71dd02e11c","1a268372-f91e-4cb4-a44b-1885dd0b7e15","1d287c2d-be09-41aa-88b1-d502e35c91c8","2254960f-fe11-4165-bbe6-ee0136ff582c","24cac8f5-90a7-4b6c-844c-3795fb690c95","27eba615-8933-4d4e-9d26-498bcc3d61d1","298f9c79-bc7a-4702-ba6d-5acb909cbd79","2d529fd0-fd3a-4b07-b5fc-fcd519efcf90","2eee64a4-183f-487b-a976-15eed665771c","34c327b2-d179-4e07-8e21-c4913c6d2ffa","391e7a2a-19ea-44ff-8061-b2f753cc885d","4056c4f2-af3f-452c-b50c-e43bbc301867","40fade42-566f-4fab-8b15-b4ea4ce50238","42c5f73d-81b0-4f2d-bf5d-6f5262da7b13","43cbf298-04a1-4c55-a42b-9ebfa46810a4","4a62a7ac-d85d-4783-b7c3-e4af3eb86ed1","5244db03-e763-49e4-9163-bf9fd0e3b908","54357709-dae5-41f4-83ce-60d94161752b","587350a4-443d-422a-8df9-7403cec7b3eb","5d38cffb-5a06-4bb9-8c9f-a9e038eb3c3c","5f2c36fe-6913-4334-ad6a-b134584bacc0","624d1493-c251-4b56-995a-1ccb60a8d431","664e4170-ee00-474b-9304-d045ad4acb8c","68fc4822-4d27-410a-affd-d75009e97dcf","6cef8273-3e86-48af-8b30-6bf4b9cc19c1","6f48ab3c-a5e8-4fb1-8f16-00ac3c9cf0ff","7644ec1e-8baf-44ca-85e4-b88a46a8d402","7797cb12-8511-4891-878d-1f538c3670da","78bc99e1-47cd-4fb6-bc06-171b26eae4f3","7b1b431e-9484-4cbe-aea6-3fd769c5d87c","7f08a0f7-68d5-4702-8f28-f0d06bb7d2b6","80da54cc-a71c-4e9b-a4dd-e863432ba349","816b405e-7f5e-431d-8b7a-8b24ccc5df88","817a8b53-162a-409e-90b2-0cf1b84a8260","850ae75c-b968-4e15-ab0d-a975fbeef712","86771d02-aad8-4cfb-9ab8-9adb4f9187bb","8db48ed1-a93f-451e-b198-119aee86c716","98a17a7f-ddb2-40a1-91ea-3157d7768989","a054cd45-7f8a-4127-8664-2a0e29a0686a","a2ce053c-624e-4ba4-8ce2-8998b2985adb","a4d1a348-6931-41de-b185-37bdd7e02bab","a8171ced-255d-433f-918b-abfc47e14bd3","aa5ea7b9-01bc-4048-a2fa-c07fc9ee2b62","abcd81b0-bdbf-41bb-bd9e-dad1f2ec533e","abebcc68-42a2-4613-814f-06477ece2afd","b1367128-b270-43cb-85e1-b116418c3c59","b2aaa4f7-2ab6-470e-a820-b037d747ff11","b8e99ea7-dcf7-4968-b02e-d1e01dad0646","b9cd6fc1-b840-4667-8ba9-a19432cb06fc","bb176dd3-ffea-4dd8-90a6-b6a622668836","bc3101c5-b73a-4839-ade4-af22aff6182d","bf385f2c-c8f4-4670-869a-ba87ed4c5c3a","c399f068-9a87-46a7-b767-c5fc21f29395","c55b081f-def8-4240-bb79-d87c41ebbf10","c564235d-5d60-49c1-9db1-bf18f605adf3","c8c01021-7ae5-4f77-8a73-5187f853fbca","cadf034d-a193-4eab-bca4-8b9a000ea9d4","d09dfb37-2b00-4dd1-a915-420837f22082","d8d3a5b2-83a1-4000-8cb5-d4b09b3d5594","da0e449f-cba3-4767-a6a3-4ace4edaae9b","e61f05c0-3554-44d6-8b56-343a3ad3c863","e9d99f9b-1a07-4455-89e6-e608476193cf","ed579850-ba95-4166-9fad-c9af2b1f0732","f195b625-f695-4c86-ab4b-d15e834dad8f","f49469c3-6ddb-4078-8e8c-d190ef9189e2","f5517bef-b880-47dd-81ce-4a8a81542554","f86472cc-cb23-4755-b404-d85e774067bb","fb03153c-119d-40ef-8581-4252c816a5ba","fcecf509-9ec4-4fce-9d99-27280b92b09c","fd43c5d4-f7f1-43e5-8352-1eb2e9edd5be","fd710b1d-9758-4b80-b7d7-76cba14e9c57","fe32ef99-11f3-45ef-b93d-d38de9090276","fe85723c-ffca-4e9c-941a-70fae9b629a7","fea6df3d-158c-49bb-9f35-df7dc1e2c7ae","ff957d74-f696-42cb-8741-c27f42c9fe44"];
let ghVersion=null;
let gateway, checkpointing=false, lastBackup=null, failure=null, shuttingDown=false;
let lastCli=null;
function run(args,{capture=true}={}){
 return new Promise((res,rej)=>{
  const began=Date.now(),child=spawn('node',[cli,...args],{stdio:['ignore','pipe','pipe']});
  const command=args.slice(0,2).map(arg=>/^[a-z-]+$/.test(arg)?arg:'[argument]').join(' ');
  const report={command,pid:child.pid??null,elapsedMS:0,stdoutBytes:0,stderrBytes:0,code:null,signal:null,ownKillReason:null};
  let output='',errors='',settled=false;
  lastCli=report;const started=diagnostic('cli_started',{...report});
  child.stdout.on('data',b=>{
   report.stdoutBytes+=Buffer.byteLength(b);if(!capture)return;
   output+=b;if(output.length>4e6&&!report.ownKillReason){report.ownKillReason='stdout_capture_limit';child.kill();}
  });
  child.stderr.on('data',b=>{report.stderrBytes+=Buffer.byteLength(b);errors=(errors+b).slice(-2000);});
  const finish=async(code,signal,error)=>{
   if(settled)return;settled=true;
   Object.assign(report,{elapsedMS:Date.now()-began,code:code??null,signal:signal??null});lastCli=report;
   await started;await diagnostic('cli_closed',{...report,...(error?{spawnError:error.message}:{})});
   if(error){rej(error);return;}
   if(code===0){res(output);return;}
   rej(new Error(redactDiagnostic((report.ownKillReason?'cli_output_limit_':'cli_failed_')+args[0]+'_'+code+' '+errors).slice(0,1000)));
  };
  child.on('error',error=>finish(null,null,error));child.on('close',(code,signal)=>finish(code,signal));
 });
}
async function request(path,init){const r=await fetch(storage+path,{...init,signal:AbortSignal.timeout(240000)});if(!r.ok&&r.status!==404)throw new Error('storage_http_'+r.status);return r;}
async function configureModels(config){
 if(!process.env.CLOUDFLARE_AI_API_TOKEN)throw new Error('cloudflare_inference_secret_required');
 const response=await request('/models');if(response.status===404)throw new Error('cloudflare_model_catalog_missing');
 const fragment=await response.json();const providers=fragment.models?.providers??{};
 const bases={cloudflare:'https://api.cloudflare.com/client/v4/accounts/6eef883dec740547667d5a2522924a3b/ai/v1','cloudflare-messages':'https://api.cloudflare.com/client/v4/accounts/6eef883dec740547667d5a2522924a3b/ai','cloudflare-workers':'https://api.cloudflare.com/client/v4/accounts/6eef883dec740547667d5a2522924a3b/ai/v1'};
 if(!providers.cloudflare||!providers['cloudflare-workers']||Object.entries(providers).some(([id,p])=>!Object.hasOwn(bases,id)||p.baseUrl!==bases[id]||!p.models?.length||p.apiKey?.source!=='env'||p.apiKey?.id!=='CLOUDFLARE_AI_API_TOKEN'||(id==='cloudflare-messages'&&p.authHeader!==true)))throw new Error('cloudflare_model_catalog_invalid');
 // Cloudflare owns only its managed routes. Native provider enrollment and
 // model preferences belong to the user and must survive every cold start.
 config.models={...config.models,mode:'merge',providers:{...config.models?.providers,...providers}};
 config.agents??={};config.agents.defaults??={};
 const defaults=config.agents.defaults;
 defaults.models={...fragment.agents.defaults.models,...defaults.models};
 defaults.model??=fragment.agents.defaults.model;
 // The sole legacy migration is hosted Cloudflare's old shared provider name.
 // Never rewrite a native provider or another exact user selection.
 const route=ref=>typeof ref==='string'?ref.replace(/^cloudflare\/(?=@cf\/)/,'cloudflare-workers/'):ref;
 const migrate=model=>typeof model==='string'?route(model):model&&{
  ...model,...(model.primary!==undefined?{primary:route(model.primary)}:{}),
  ...(Array.isArray(model.fallbacks)?{fallbacks:model.fallbacks.map(route)}:{})
 };
 defaults.model=migrate(defaults.model);
 for(const agent of Object.values(config.agents.entries??{}))if(agent.model)agent.model=migrate(agent.model);
}
function redactDiagnostic(value){
 let text=String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
 for(const [key,secret]of Object.entries(process.env))if(secret&&/PASSWORD|TOKEN|SECRET|API_KEY|PRIVATE_KEY|CERTIFICATE|CREDENTIAL/i.test(key)){
  for(const form of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1)]))if(form)text=text.split(form).join('[redacted]');
 }
 return text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi,'[url]')
  .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [redacted]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[redacted]')
  .replace(/(["']?\b[A-Za-z0-9_-]*(?:api[-_ ]?key|token|password|secret|authorization|credential)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'$1[redacted]')
  .replace(/[A-Za-z0-9_+\/=\-]{40,}/g,'[opaque-token]');
}
async function diagnostic(stage,details={}){
 const controller=new AbortController();let timer;
 try{await Promise.race([(async()=>{
  let openclawVersion='unavailable';try{openclawVersion=JSON.parse(await readFile('/app/package.json','utf8')).version??'unavailable';}catch{}
  const report={at:new Date().toISOString(),openclawVersion,nodeVersion:process.version,stage,...details};
  for(const key of Object.keys(report))if(typeof report[key]==='string')report[key]=redactDiagnostic(report[key]);
  while(Buffer.byteLength(JSON.stringify(report))>4096){const key=Object.keys(report).filter(key=>typeof report[key]==='string').sort((a,b)=>report[b].length-report[a].length)[0];report[key]=report[key].slice(Math.max(1,Math.ceil(report[key].length/4)));}
  await fetch(storage+'/diagnostic',{method:'PUT',body:JSON.stringify(report),signal:controller.signal});
 })(),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve();},2000);})]);}catch{}finally{clearTimeout(timer);}
}
function watchGateway(child,started){
 let tail=Buffer.alloc(0),finishing=false;
 const remember=data=>{tail=Buffer.concat([tail,Buffer.from(data)]).subarray(-16384);};
 child.stdout.on('data',remember);child.stderr.on('data',remember);
 child.on('error',error=>remember('gateway_spawn_error '+error.message));
 const finish=async(code,signal)=>{
  if(shuttingDown||finishing)return;finishing=true;
  await started;await diagnostic('gateway_exited',{code:code??null,signal:signal??null,tail:tail.toString('utf8')});
  process.exit(code??1);
 };
 child.once('exit',finish);child.once('close',finish);
}
async function restore(){
 const r=await request('/backup');if(r.status===404)return;
 const archive='/home/node/restore.tar.gz';await writeFile(archive,Buffer.from(await r.arrayBuffer()),{mode:0o600});
 const target='/home/node/restore-stage';await run(['backup','restore',archive,'--target',target,'--json'],{capture:false});
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
 try{
  const response=await request('/checkpoint-native',{method:'POST'});const report=await response.json();
  if(report.ok!==true||report.key!=='backups/latest.tar.gz'||!Number.isSafeInteger(report.size)||report.size<=0||!/^[a-f0-9]{64}$/.test(report.sha256)||typeof report.createdAt!=='string'||!Number.isFinite(Date.parse(report.createdAt)))throw new Error('checkpoint_metadata_invalid');
  lastBackup=report.createdAt;failure=null;
  console.log('checkpoint_uploaded');return {...report,lastBackup};
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
async function migrateCore(){
 const configPath=join(root,'openclaw.json');let config;
 try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e;}
 // The custom container entrypoint bypasses the official image's Doctor pass.
 // Do not load the restored, older Teams runtime during core migration. Keep its
 // configuration for the final enabled-plugin migration after the pinned install.
 let teams;
 try{teams=JSON.parse(await readFile(teamsMigrationPath,'utf8'));}catch(e){
  if(e.code!=='ENOENT')throw e;
  teams={channel:config.channels?.msteams,entry:config.plugins?.entries?.msteams};
  await mkdir(resolve(teamsMigrationPath,'..'),{recursive:true,mode:0o700});
  await writeFile(teamsMigrationPath,JSON.stringify(teams),{mode:0o600});
 }
 if(config.channels)delete config.channels.msteams;
 config.plugins??={};config.plugins.entries??={};config.plugins.entries.msteams={...teams.entry,enabled:false};
 config.agents??={};config.agents.entries??={};
 if(Array.isArray(config.agents.list))for(const legacy of config.agents.list){if(!legacy?.id)continue;const {id,default:wasDefault,...entry}=legacy;config.agents.entries[id]={...(config.agents.entries[id]??{}),...entry};}
 delete config.agents.list;
 await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});
 await run(['doctor','--fix','--non-interactive']);await diagnostic('core_migration_ready');
 return {...teams,coreMigrationCompleted:true};
}
async function installTeamsPlugin(){
 const pluginDir=join(root,'extensions','msteams');
 const pluginMarker=join(root,'.bootstrap','msteams-native-install-'+teamsVersion);
 let nativeInstalled=false;
 try{await stat(pluginMarker);const p=JSON.parse(await run(['plugins','inspect','msteams','--json']));nativeInstalled=p.install?.source==='npm'&&p.install?.version===teamsVersion&&p.plugin?.trustedOfficialInstall===true&&p.plugin?.dependencyStatus?.requiredInstalled!==false;}catch{}
 if(!nativeInstalled){
  await rm(pluginDir,{recursive:true,force:true});
  delete process.env.npm_config_offline;process.env.npm_config_audit='false';process.env.npm_config_fund='false';
  await diagnostic('plugin_install_start');
  await run(['plugins','install','@openclaw/msteams@'+teamsVersion,'--force','--accept-capabilities']);
  await diagnostic('plugin_install_complete');
  const pluginInfo=JSON.parse(await run(['plugins','inspect','msteams','--json']));
  if(pluginInfo.install?.source!=='npm'||pluginInfo.install?.version!==teamsVersion||pluginInfo.plugin?.trustedOfficialInstall!==true||pluginInfo.plugin?.dependencyStatus?.requiredInstalled===false)throw new Error('msteams_native_provenance_missing');
  await mkdir(resolve(pluginMarker,'..'),{recursive:true,mode:0o700});
  await writeFile(pluginMarker,'official npm install\n',{mode:0o600});
 }
 await diagnostic('plugin_ready');
}
async function main(){
 await diagnostic('starting');await installGitHubCli();await diagnostic('github_ready');
 await restore();await mkdir(root,{recursive:true,mode:0o700});await diagnostic('restore_ready');
 const openclawVersion=JSON.parse(await readFile('/app/package.json','utf8')).version;
 if(typeof openclawVersion!=='string'||!openclawVersion)throw new Error('runtime_version_missing');
 const migrationReceipt={format:1,openclawVersion,teamsVersion};
 let migrationNeeded=true;
 try{
  const receipt=JSON.parse(await readFile(migrationReceiptPath,'utf8'));
  if(receipt?.format===1&&receipt.openclawVersion===openclawVersion&&receipt.teamsVersion===teamsVersion){
   try{await stat(teamsMigrationPath);}catch(e){if(e.code!=='ENOENT')throw e;migrationNeeded=false;}
  }
 }catch(e){if(e.code!=='ENOENT'&&e.name!=='SyntaxError')throw e;}
 let restoredTeams;
 if(migrationNeeded)restoredTeams=await migrateCore();
 else{
  const restored=JSON.parse(await readFile(join(root,'openclaw.json'),'utf8'));
  restoredTeams={channel:restored.channels?.msteams,entry:restored.plugins?.entries?.msteams};
  await diagnostic('migration_receipt_reused');
 }
 await installTeamsPlugin();
 // Import the dedicated Teams certificate from a runtime-only secret. The PEM
 // never enters Worker source, configuration JSON, logs, or the R2 seed.
 const teamsCert=process.env.SOPSUTIL_TEAMS_CERTIFICATE_B64;
 if(teamsCert){
  const certDir=join(root,'certs','sopsutil-teams');await mkdir(certDir,{recursive:true,mode:0o700});
  await writeFile(join(certDir,'bot.pem'),Buffer.from(teamsCert,'base64'),{mode:0o600});
 }
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
 config.agents.entries??={};
 if(Array.isArray(config.agents.list))for(const legacy of config.agents.list){if(!legacy?.id)continue;const {id,default:wasDefault,...entry}=legacy;config.agents.entries[id]={...(config.agents.entries[id]??{}),...entry};}
 delete config.agents.list;
 config.agents.entries.sopsutil={...(config.agents.entries.sopsutil??{}),name:'SopsUtil Cloudflare',workspace};
 config.plugins??={};config.plugins.entries??={};config.plugins.entries.msteams={...restoredTeams.entry,...(config.plugins.entries.msteams??{}),enabled:true};
 config.channels??={};
 config.channels.msteams={...restoredTeams.channel,...(config.channels.msteams??{}),enabled:true,appId:'16d7d6d1-a6ec-4de8-a0b8-cd5e3d083682',tenantId:'ca9f5f30-4e27-43e6-a6dc-097d9877bd7a',authType:'federated',certificatePath:join(root,'certs','sopsutil-teams','bot.pem'),dmPolicy:'allowlist',allowFrom:TWE_MEMBER_OBJECT_IDS,groupPolicy:'disabled',configWrites:false,dangerouslyAllowNameMatching:false,historyLimit:0,dmHistoryLimit:10,graphMediaFallback:false,mediaAllowHosts:[],mediaAuthAllowHosts:[],typingIndicator:false,welcomeCard:false,groupWelcomeCard:false,feedbackEnabled:false,feedbackReflection:false,sso:{enabled:false},delegatedAuth:{enabled:false,scopes:[]},legacyWebhook:{port:3978},webhook:{path:'/api/messages'}};
 config.bindings=[...(config.bindings??[]).filter(b=>!(b?.match?.channel==='msteams')),{type:'route',agentId:'sopsutil',comment:'Route Teams personal messages to the existing SopsUtil agent',match:{channel:'msteams',accountId:'*'},session:{dmScope:'per-account-channel-peer'}}];
 await configureModels(config);
 await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});
 // The enabled plugin's own durable state must migrate with the current core.
 if(migrationNeeded)await run(['doctor','--fix','--non-interactive']);
 await run(['config','validate']);
 const readyConfig=JSON.parse(await readFile(configPath,'utf8'));
 if(readyConfig.channels?.msteams?.legacyWebhook?.port!==3978||readyConfig.channels?.msteams?.webhook?.path!=='/api/messages')throw new Error('teams_callback_route_changed');
 await rm(teamsMigrationPath,{force:true});
 // Only a completed core + enabled-plugin migration may authorize future skips.
 if(migrationNeeded&&restoredTeams.coreMigrationCompleted)await writeFile(migrationReceiptPath,JSON.stringify(migrationReceipt),{mode:0o600});
 await diagnostic('config_ready');
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  try{
   if(req.url==='/status'&&req.method==='GET'){res.end(JSON.stringify({ok:true,lastBackup,failure,checkpointing,ghVersion,migrationReceiptReused:!migrationNeeded,proxyPeer:req.socket.remoteAddress}));return;}
   if(req.url==='/model-status'&&req.method==='GET'){res.end(JSON.stringify({primary:config.agents.defaults.model,providers:Object.keys(config.models.providers),models:Object.entries(config.models.providers).flatMap(([provider,p])=>p.models.map(m=>({provider,id:m.id,api:m.api}))),allowedCount:Object.keys(config.agents.defaults.models).length,baseUrl:config.models.providers.cloudflare.baseUrl,credentialSource:config.models.providers.cloudflare.apiKey,credentialPresent:!!process.env.CLOUDFLARE_AI_API_TOKEN}));return;}
   if(req.url==='/model-report'&&req.method==='GET'){try{res.end(await readFile(join(root,'.bootstrap','cloudflare-model-report.json'),'utf8'));}catch{res.statusCode=404;res.end('{}');}return;}
   if(req.url==='/msteams-status'&&req.method==='GET'){
    const inspected=JSON.parse(await run(['plugins','inspect','msteams','--json']));const status=JSON.parse(await run(['channels','status','--json']));const channel=status.channels?.msteams;const accounts=status.channelAccounts?.msteams;
    res.end(JSON.stringify({plugin:{id:inspected.plugin?.id,version:inspected.plugin?.version,status:inspected.plugin?.status,activated:inspected.plugin?.activated,imported:inspected.plugin?.imported,dependenciesInstalled:inspected.plugin?.dependencyStatus?.requiredInstalled},install:{source:inspected.install?.source,version:inspected.install?.version,resolvedName:inspected.install?.resolvedName},channel,accounts}));return;
   }
   if(req.url==='/checkpoint'&&req.method==='POST'){res.end(JSON.stringify(await checkpoint()));return;}
   if(req.url==='/devices'&&req.method==='GET'){res.end(await run(['devices','list','--json']));return;}
   res.statusCode=404;res.end('{}');
  }catch{res.statusCode=503;res.end(JSON.stringify({error:'operation_failed'}));}
 });server.listen(18790,'0.0.0.0');
 gateway=spawn('node',[cli,'gateway','--bind','lan','--port','18789'],{stdio:['ignore','pipe','pipe']});
 const started=diagnostic('gateway_spawned',{pid:gateway.pid??null});watchGateway(gateway,started);await started;
 const timer=setInterval(()=>checkpoint().catch(()=>console.error('checkpoint_failed')),300000);timer.unref();
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(shuttingDown)return;shuttingDown=true;clearInterval(timer);gateway.kill('SIGTERM');await new Promise(r=>gateway.once('exit',r));try{await checkpoint();}catch{console.error('final_checkpoint_failed');process.exit(1);}server.close();process.exit(0);});
}
main().catch(async e=>{console.error('bootstrap_failed');await diagnostic('bootstrap_failed',{...lastCli,message:String(e?.message??e)});process.exit(1);});
