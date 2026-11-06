// Runs only through the account-authorized Container RPC, never a public route.
export default String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
async function main(){
const apply=process.argv[1]==='apply';
const root='/home/node/.openclaw',primary='cloudflare-workers/@cf/zai-org/glm-5.3';
const configPath=root+'/openclaw.json';
const beforeRaw=await readFile(configPath,'utf8'),before=JSON.parse(beforeRaw);
const response=await fetch('http://sopsutil-storage.internal/models');
if(!response.ok)throw Error('catalog_unavailable');
const fragment=await response.json();
assert.equal(fragment.agents.defaults.model.primary,primary);
assert.deepEqual(fragment.agents.defaults.model.fallbacks,[]);
assert.equal(fragment.models.providers['cloudflare-workers'].baseUrl,'https://api.cloudflare.com/client/v4/accounts/6eef883dec740547667d5a2522924a3b/ai/v1');
assert.ok(fragment.models.providers['cloudflare-workers'].models.every(m=>m.id.startsWith('@cf/')));
function redact(value){let s=String(value??'');for(const[k,v]of Object.entries(process.env))if(v&&/PASSWORD|TOKEN|SECRET|KEY|CERTIFICATE/i.test(k))s=s.split(v).join('[redacted]');return s.replace(/[A-Za-z0-9_+=/-]{45,}/g,'[opaque]').slice(0,1400);}
async function cli(args){
 const child=spawn('node',['/app/openclaw.mjs',...args],{stdio:['ignore','pipe','pipe']});
 let text='',errors='';const closed=new Promise(resolve=>child.on('close',resolve));
 child.stderr.on('data',b=>errors=(errors+b).slice(-3000));
 for await(const b of child.stdout){text+=b;if(text.length>4e6)child.kill();}
 const code=await closed;
 if(code!==0){let parsed;try{parsed=JSON.parse(text);}catch{}throw Error(redact('native_'+args.slice(0,2).join('_')+'_'+code+' '+(parsed?.error?.message??parsed?.error??errors)));}
 return text;
}
const inventory=JSON.parse(await cli(['sessions','--all-agents','--limit','all','--json']));
const sessions=(inventory.sessions??[]).filter(s=>s.agentId==='sopsutil');
if(sessions.some(s=>!s.key||!s.sessionId))throw Error('session_identity_required');
const operations=[
 {path:'models',value:fragment.models},
 {path:'agents.defaults.models',value:fragment.agents.defaults.models},
 {path:'agents.defaults.model',value:fragment.agents.defaults.model},
 ...Object.entries(before.agents?.entries??{}).filter(([,a])=>a.model).map(([id])=>({path:'agents.entries.'+id+'.model',value:primary})),
];
const batchPath=root+'/.bootstrap/neuron-config-'+randomUUID()+'.json';
await writeFile(batchPath,JSON.stringify(operations),{mode:0o600});
try{
 await cli(['config','set','--batch-file',batchPath,'--replace','--dry-run']);
 assert.equal(await readFile(configPath,'utf8'),beforeRaw,'configuration_changed_during_plan');
 if(!apply){console.log(JSON.stringify({dryRun:true,primary,modelCount:Object.keys(fragment.agents.defaults.models).length,sessionCount:sessions.length,paths:operations.map(o=>o.path)}));}
 else{
  await cli(['config','set','--batch-file',batchPath,'--replace']);
  await cli(['config','validate']);
  const after=JSON.parse(await readFile(configPath,'utf8'));
  for(const key of ['gateway','channels','auth','bindings','secrets'])assert.deepEqual(after[key],before[key],key+'_changed');
  assert.equal(after.agents.defaults.workspace,before.agents.defaults.workspace);
  for(const[id,a]of Object.entries(before.agents?.entries??{})){
   const {model:oldModel,...rest}=a,{model:newModel,...saved}=after.agents.entries[id];assert.deepEqual(saved,rest);
  }
  let patched=0;
  for(const s of sessions){
   const params={key:s.key,agentId:s.agentId,expectedSessionId:s.sessionId,model:primary};
   await cli(['gateway','call','sessions.patch','--params',JSON.stringify(params),'--json']);patched++;
  }
  const final=JSON.parse(await cli(['sessions','--all-agents','--limit','all','--json']));
  const preserved=sessions.every(s=>(final.sessions??[]).some(a=>a.key===s.key&&a.agentId===s.agentId&&a.sessionId===s.sessionId));
  if(!preserved)throw Error('session_identity_changed');
  const selected=(final.sessions??[]).filter(s=>s.agentId==='sopsutil').map(s=>({key:s.key,sessionId:s.sessionId,provider:s.providerOverride??s.modelProvider,model:s.modelOverride??s.model}));
  if(selected.some(s=>s.provider!=='cloudflare-workers'||s.model!=='@cf/zai-org/glm-5.3'))throw Error('session_selection_not_postpaid');
  console.log(JSON.stringify({applied:true,primary,modelCount:Object.keys(after.agents.defaults.models).length,patched,identitiesPreserved:preserved,sessions:selected}));
 }
}finally{await unlink(batchPath);}
}
main().catch(error=>{let message=String(error.message??'');if(!message.startsWith('native_'))message=error.code==='ERR_ASSERTION'?'neuron_configuration_invariant_failed':'neuron_configuration_failed';for(const[k,v]of Object.entries(process.env))if(v&&/PASSWORD|TOKEN|SECRET|KEY|CERTIFICATE/i.test(k))message=message.split(v).join('[redacted]');console.log(JSON.stringify({ok:false,error:message.slice(0,1400)}));process.exitCode=1;});
`;
