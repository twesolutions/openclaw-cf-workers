// Native config changes and model publication, callable only by account RPC.
export default String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
async function main(){
 const apply=process.argv[1]==='apply',root='/home/node/.openclaw';
 const path=root+'/openclaw.json',raw=await readFile(path,'utf8'),before=JSON.parse(raw);
 const operations=[{path:'models.mode',value:'merge'},{path:'agents.defaults.modelPolicy',value:{}}];
 for(const[id,a]of Object.entries(before.agents?.entries??{}))if(a.modelPolicy!==undefined)operations.push({path:'agents.entries.'+id+'.modelPolicy',value:{}});
 const file=root+'/.bootstrap/native-picker-'+randomUUID()+'.json';
 async function cli(args){
  const p=spawn('node',['/app/openclaw.mjs',...args],{stdio:['ignore','pipe','pipe']});let out='',err='';
  const closed=new Promise(r=>p.on('close',r));p.stderr.on('data',b=>err=(err+b).slice(-3000));
  for await(const b of p.stdout){out+=b;if(out.length>4e6)p.kill();}
  const code=await closed;if(code!==0)throw Error('native_'+args.slice(0,2).join('_')+'_failed_'+code);return out;
 }
 await writeFile(file,JSON.stringify(operations),{mode:0o600});
 try{
  await cli(['config','set','--batch-file',file,'--replace','--dry-run']);
  assert.equal(await readFile(path,'utf8'),raw);
  if(!apply){console.log(JSON.stringify({dryRun:true,mode:'merge',paths:operations.map(o=>o.path),unrestricted:true}));return;}
  await cli(['config','set','--batch-file',file,'--replace']);await cli(['config','validate']);
  const after=JSON.parse(await readFile(path,'utf8'));
  for(const key of ['gateway','channels','auth','bindings','secrets'])assert.deepEqual(before[key],after[key]);
  assert.deepEqual(before.models.providers,after.models.providers);
  assert.deepEqual(before.agents.defaults.models,after.agents.defaults.models);
  assert.deepEqual(before.agents.defaults.model,after.agents.defaults.model);
  const published=JSON.parse(await cli(['gateway','call','models.list','--params',JSON.stringify({agentId:'sopsutil',view:'all',refresh:true}),'--json']));
  const rows=published.models??published.result?.models??[];
  const native=rows.filter(m=>['anthropic','openai'].includes(m.provider));
  console.log(JSON.stringify({applied:true,mode:after.models.mode,defaultModel:after.agents.defaults.model,policy:after.agents.defaults.modelPolicy,providerCount:Object.keys(after.models.providers).length,aliasCount:Object.keys(after.agents.defaults.models).length,nativeModels:native.map(m=>({provider:m.provider,id:m.id,name:m.name,available:m.available,reasonPresent:!!m.unavailableReason})),pendingProviders:published.pendingProviders,refreshFailed:published.refreshFailed}));
 }finally{await unlink(file);}
}
main().catch(e=>{console.log(JSON.stringify({ok:false,error:e.code==='ERR_ASSERTION'?'native_picker_preservation_check_failed':String(e.message).slice(0,300)}));process.exitCode=1;});
`;
