import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildSopsutilModels,PRIMARY,FALLBACKS,providerFor} from '../scripts/build-sopsutil-models.mjs';
const external=(id,extra={})=>({model_id:id,name:id,task:'Text Generation',request_formats:['chat-completions'],metadata:{},...extra});
const hosted=(id,extra={})=>({name:id,task:{name:'Text Generation'},properties:[],...extra});
const build=(externalRows,workersRows=[])=>buildSopsutilModels(externalRows,workersRows,{asOf:'2026-11-06T00:00:00Z',requireDefaults:false});
const models=config=>Object.values(config.models.providers).flatMap(provider=>provider.models).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);

test('selects standard language models and excludes other modalities, decisions, private and expired entries',()=>{
 const config=build([
  external('openai/chat'),external('openai/image',{task:'Text-to-Image'}),external('openai/decisions',{request_formats:null}),
  external('openai/private',{private:true}),external('openai/expired',{metadata:{planned_deprecation_date:'2026-11-05'}}),
  external('openai/future',{metadata:{planned_deprecation_date:'2026-11-20'}})
 ],[
  hosted('@cf/cloudflare/clef'),hosted('@cf/cloudflare/clef-omni'),hosted('@cf/cloudflare/clairic'),hosted('@cf/meta/llama-guard-3-8b'),
  hosted('@cf/org/chat'),hosted('@cf/org/expired',{properties:[{property_id:'planned_deprecation_date',value:'2026-10-01'}]})
 ]);
 assert.deepEqual(models(config).map(x=>x.id),['@cf/org/chat','openai/chat','openai/future']);
});
test('uses supported native adapters and retains responses-only models',()=>{
 const config=build([
  external('openai/reasoner',{request_formats:['chat-completions','responses']}),
  external('anthropic/claude',{request_formats:['anthropic-messages']}),
  external('thinkingmachines/inkling',{request_formats:['anthropic-messages']}),
  external('meta/muse',{request_formats:['responses']}),external('google/gemini')
 ]);
 assert.deepEqual(Object.fromEntries(models(config).map(x=>[x.id,x.api])),{
  'anthropic/claude':'anthropic-messages','google/gemini':'openai-completions','meta/muse':'openai-responses','openai/reasoner':'openai-responses','thinkingmachines/inkling':'anthropic-messages'
 });
 const providers=config.models.providers;
 assert.equal(providers['cloudflare-messages'].baseUrl+'/v1/messages',providers.cloudflare.baseUrl+'/messages');
 assert.ok(providers['cloudflare-messages'].baseUrl.endsWith('/ai'));
 assert.ok(providers.cloudflare.baseUrl.endsWith('/ai/v1'));
 assert.ok(providers['cloudflare-messages'].models.every(model=>model.api==='anthropic-messages'));
 assert.ok(providers.cloudflare.models.every(model=>model.api!=='anthropic-messages'));
 assert.ok(config.agents.defaults.models['cloudflare-messages/anthropic/claude']);
 assert.ok(config.agents.defaults.models['cloudflare-messages/thinkingmachines/inkling']);
});
test('deduplicates by exact canonical ID, prefers unified metadata, and is input-order stable',()=>{
 const a=external('org/model',{name:'Canonical',context_length:100000});
 const config=build([a],[hosted('org/model')]);
 assert.equal(models(config).length,1);assert.equal(models(config)[0].name,'Canonical');
 assert.deepEqual(build([a,external('a/chat')]),build([external('a/chat'),a]));
});
test('preserves observed limits/capabilities and documents conservative unknown limits through behavior',()=>{
 const config=build([
  external('org/observed',{context_length:100000,max_output_tokens:24000,metadata:{Reasoning:'Yes',Vision:'Yes','Function Calling':'Yes'}}),
  external('org/unknown'),external('org/metadata-context',{metadata:{'Context Window':'1,048,576 tokens'}}),
  external('org/nonreasoner',{tags:['Reasoning'],metadata:{Reasoning:'No','Function Calling':'No'}}),
  external('org/tagged',{tags:['Reasoning','Multimodal']}),
  external('org/multi-key',{metadata:{Architecture:'Transformer','Input modalities':'Text, image'}})
 ],[hosted('@cf/org/small',{properties:[{property_id:'context_window',value:'3500'},{property_id:'reasoning',value:'true'}]})]);
 const byId=Object.fromEntries(models(config).map(x=>[x.id,x]));
 assert.equal(byId['org/observed'].maxTokens,24000);assert.equal(byId['org/observed'].contextWindow,100000);
 assert.deepEqual(byId['org/observed'].input,['text','image']);assert.equal(byId['org/observed'].reasoning,true);assert.equal(byId['org/observed'].compat.supportsTools,true);
 assert.equal(byId['org/unknown'].contextWindow,32768);assert.equal(byId['org/unknown'].maxTokens,8192);assert.equal(byId['org/unknown'].compat,undefined);
 assert.equal(byId['org/metadata-context'].contextWindow,1048576);assert.equal(byId['org/nonreasoner'].reasoning,false);assert.equal(byId['org/nonreasoner'].compat.supportsTools,false);
 assert.equal(byId['org/tagged'].reasoning,true);assert.deepEqual(byId['org/tagged'].input,['text','image']);assert.deepEqual(byId['org/multi-key'].input,['text','image']);
 assert.equal(byId['@cf/org/small'].maxTokens,3500);assert.equal(byId['@cf/org/small'].compat.supportsTools,false);
});
test('uses only inference SecretRefs and injected Bearer auth, routes every alias through Cloudflare, and refuses missing defaults',()=>{
 const config=build([external('org/model')]);
 for(const provider of Object.values(config.models.providers)){
  assert.deepEqual(provider.apiKey,{source:'env',provider:'default',id:'CLOUDFLARE_AI_API_TOKEN'});
  assert.deepEqual(provider.headers,{'cf-aig-gateway-id':'default'});assert.equal(provider.authHeader,true);
 }
 assert.equal(config.models.mode,'replace');
 assert.ok(Object.keys(config.agents.defaults.models).every(ref=>/^cloudflare(?:-messages|-workers)?\//.test(ref)));
 assert.equal(config.agents.defaults.model.primary,PRIMARY);assert.deepEqual(config.agents.defaults.model.fallbacks,FALLBACKS);
 assert.throws(()=>buildSopsutilModels([],[]),/required_default_model_missing/);
 assert.throws(()=>buildSopsutilModels([],[],{asOf:'not-a-date'}),/invalid_catalog_as_of/);
 assert.doesNotMatch(JSON.stringify(config),/sk-proj-|Bearer /);
});
test('checked-in deployment catalog is secret-free and every model has a unique Cloudflare alias',async()=>{
 const config=JSON.parse(await readFile(new URL('../deploy/sopsutil/models.json',import.meta.url),'utf8'));
 const list=models(config);assert.ok(list.length>90);assert.equal(new Set(list.map(x=>x.id)).size,list.length);
 assert.deepEqual(Object.keys(config.models.providers),['cloudflare','cloudflare-messages','cloudflare-workers']);
 assert.equal(Object.keys(config.agents.defaults.models).length,list.length);
 for(const model of list){assert.ok(model.contextWindow>0);assert.ok(model.maxTokens>0);assert.ok(config.agents.defaults.models[providerFor(model)+'/'+model.id]);}
 assert.ok(list.some(x=>providerFor(x)+'/'+x.id===PRIMARY));
 for(const provider of Object.values(config.models.providers)){
  assert.deepEqual(provider.apiKey,{source:'env',provider:'default',id:'CLOUDFLARE_AI_API_TOKEN'});assert.equal(provider.authHeader,true);
 }
 assert.doesNotMatch(JSON.stringify(config),/sk-proj-|Bearer /);
});
test('separates postpaid hosted inference from prepaid provider cooldowns without losing picker models',()=>{
 const config=build([external('openai/gpt-6.1-sol')],[hosted('@cf/zai-org/glm-5.3')]);
 assert.equal(config.agents.defaults.model.primary,'cloudflare-workers/@cf/zai-org/glm-5.3');
 assert.deepEqual(config.agents.defaults.model.fallbacks,[]);
 assert.equal(config.models.providers['cloudflare-workers'].models[0].id,'@cf/zai-org/glm-5.3');
 assert.equal(config.models.providers.cloudflare.models[0].id,'openai/gpt-6.1-sol');
 assert.match(config.agents.defaults.models[PRIMARY].alias,/Neurons.*postpaid/);
 assert.match(config.agents.defaults.models['cloudflare/openai/gpt-6.1-sol'].alias,/Unified Billing.*prepaid/);
 assert.doesNotThrow(()=>buildSopsutilModels([],[hosted('@cf/zai-org/glm-5.3')]));
});
