import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir, realpath} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {pathToFileURL} from 'node:url';

// Optional native integration test: use the already-installed OpenClaw without
// installing dependencies, reading credentials, or making a network request.
let packageRoot;
try {
 packageRoot=process.env.OPENCLAW_PACKAGE_ROOT??dirname(await realpath(execFileSync('which',['openclaw'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()));
 await readFile(join(packageRoot,'package.json'),'utf8');
} catch {packageRoot=undefined;}

test('native Messages adapter preserves Cloudflare bearer auth and gateway header without duplicating v1', {skip:!packageRoot,timeout:20000},async()=>{
 const config=JSON.parse(await readFile(new URL('../deploy/sopsutil/models.json',import.meta.url),'utf8'));
 const provider=config.models.providers['cloudflare-messages'];
 assert.ok(provider,'Messages models need their own native-adapter provider');
 assert.equal(provider.authHeader,true);
 assert.ok(provider.baseUrl.endsWith('/ai'));
 assert.deepEqual(provider.apiKey,{source:'env',provider:'default',id:'CLOUDFLARE_AI_API_TOKEN'});
 const authFile=(await readdir(join(packageRoot,'dist'))).find(name=>/^model-auth-[^.]+\.mjs$/.test(name));
 assert.ok(authFile,'installed OpenClaw auth projection must be available');
 const authModule=await import(pathToFileURL(join(packageRoot,'dist',authFile)).href);
 const applyAuthHeaderOverride=Object.values(authModule).find(value=>typeof value==='function'&&value.name==='applyAuthHeaderOverride');
 assert.ok(applyAuthHeaderOverride);
 const aiRoot=join(packageRoot,'node_modules','@openclaw','ai','dist');
 const {createAiTransportHost,runWithAiTransportHost}=await import(pathToFileURL(join(aiRoot,'index.mjs')).href);
 const {streamAnthropic}=await import(pathToFileURL(join(aiRoot,'internal','anthropic.mjs')).href);
 const fixtureKey='fixture-only-not-a-real-credential';
 const definition=provider.models.find(model=>model.id.startsWith('anthropic/'));
 assert.ok(definition);
 const model=applyAuthHeaderOverride({...definition,provider:'cloudflare-messages',baseUrl:provider.baseUrl,headers:provider.headers,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}},{apiKey:fixtureKey},config);
 let requests=0;
 const host=createAiTransportHost({buildModelFetch:()=>async(input,init)=>{
  requests++;
  assert.equal(String(input),provider.baseUrl+'/v1/messages');
  assert.ok(!String(input).includes('/v1/v1/'));
  const headers=new Headers(init.headers);
  assert.equal(headers.get('authorization'),'Bearer '+fixtureKey);
  assert.equal(headers.get('cf-aig-gateway-id'),'default');
  assert.equal(JSON.parse(init.body).model,definition.id);
  const events=[
   {type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model:definition.id,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},
   {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
   {type:'content_block_delta',index:0,delta:{type:'text_delta',text:'fixture'}},
   {type:'content_block_stop',index:0},
   {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}},
   {type:'message_stop'},
  ];
  return new Response(events.map(event=>'event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
 }});
 const result=await runWithAiTransportHost(host,()=>streamAnthropic(model,{messages:[{role:'user',content:'fixture',timestamp:0}]},{apiKey:fixtureKey,maxTokens:8,timeoutMs:2000,thinkingEnabled:false}).result());
 assert.equal(requests,1);
 assert.equal(result.stopReason,'stop');
 assert.equal(result.content.find(block=>block.type==='text')?.text,'fixture');
});
