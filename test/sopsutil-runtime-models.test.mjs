import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';
const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const fn=source.match(/async function configureModels\(config\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(fn);
const catalog=JSON.parse(await readFile('deploy/sopsutil/models.json','utf8'));
const make=(fragment=catalog,present=true)=>vm.runInNewContext('('+fn+')',{
 process:{env:{CLOUDFLARE_AI_API_TOKEN:present?'fixture-only':''}},
 request:async path=>{assert.equal(path,'/models');return {status:200,json:async()=>structuredClone(fragment)};},
});
test('two boots preserve native enrollment, model preferences, aliases, policies and unrelated settings',async()=>{
 const config={
  gateway:{auth:{mode:'password'},controlUi:{allowedOrigins:['https://sopsbot.tweai.dev']}},
  channels:{msteams:{enabled:true}},
  auth:{order:{anthropic:['anthropic:fixture'],'openai-codex':['openai-codex:fixture']},profiles:{'anthropic:fixture':{provider:'anthropic',mode:'api_key'}}},
  agents:{defaults:{workspace:'/workspace',maxConcurrent:2,
   model:{primary:'openai-codex/native-fixture',fallbacks:['anthropic/native-fixture']},
   modelPolicy:{allow:['cloudflare-workers/*','anthropic/*','openai/*']},
   models:{'anthropic/native-fixture':{alias:'My native preference',params:{temperature:0.2}},'cloudflare-workers/@cf/zai-org/glm-5.3':{alias:'My hosted preference'}}},
   entries:{sopsutil:{name:'SopsUtil',model:'anthropic/native-fixture'},codex:{model:{primary:'openai-codex/native-fixture',fallbacks:[]}},unqualified:{model:'user-custom-model'}}},
  models:{mode:'replace',providers:{anthropic:{apiKey:{source:'store',provider:'fixture',id:'ANTHROPIC_API_KEY'}},'openai-codex':{baseUrl:'https://native.fixture'},cloudflare:{baseUrl:'https://outdated.fixture'}}}
 };
 const preserved=JSON.stringify({gateway:config.gateway,channels:config.channels,auth:config.auth,defaults:config.agents.defaults,entries:config.agents.entries,nativeProviders:{anthropic:config.models.providers.anthropic,'openai-codex':config.models.providers['openai-codex']}});
 for(let boot=0;boot<2;boot++){
  await make()(config);
  const observed={gateway:config.gateway,channels:config.channels,auth:config.auth,defaults:{...config.agents.defaults,models:{'anthropic/native-fixture':config.agents.defaults.models['anthropic/native-fixture'],'cloudflare-workers/@cf/zai-org/glm-5.3':config.agents.defaults.models['cloudflare-workers/@cf/zai-org/glm-5.3']}},entries:config.agents.entries,nativeProviders:{anthropic:config.models.providers.anthropic,'openai-codex':config.models.providers['openai-codex']}};
  assert.equal(JSON.stringify(observed),preserved);
  assert.equal(config.models.mode,'merge');
  assert.equal(Object.keys(config.agents.defaults.models).length,115);
  assert.equal(Object.values(config.models.providers).filter(p=>Array.isArray(p.models)).flatMap(p=>p.models).length,114);
  assert.equal(config.models.providers.cloudflare.baseUrl,catalog.models.providers.cloudflare.baseUrl);
  assert.equal(Object.keys(config.models.providers).length,5);
 }
});
test('postpaid Cloudflare defaults apply only when the primary selection is unset',async()=>{
 const config={};await make()(config);await make()(config);
 assert.equal(config.agents.defaults.model.primary,'cloudflare-workers/@cf/zai-org/glm-5.3');
 assert.deepEqual([...config.agents.defaults.model.fallbacks],[]);
 assert.equal(Object.keys(config.agents.defaults.models).length,114);
 assert.equal(config.agents.defaults.modelPolicy.allow.length,116);
 assert.ok(config.agents.defaults.modelPolicy.allow.includes('anthropic/*'));
 assert.ok(config.agents.defaults.modelPolicy.allow.includes('openai/*'));
 const native={agents:{defaults:{model:'openai-codex/native-fixture'}}};
 await make()(native);assert.equal(native.agents.defaults.model,'openai-codex/native-fixture');
});
test('missing inference credential or wrong upstream URL refuses startup without changing config',async()=>{
 const c={gateway:{auth:{mode:'password'}}};const original=JSON.stringify(c);
 await assert.rejects(make(catalog,false)(c),/cloudflare_inference_secret_required/);
 const bad=structuredClone(catalog);bad.models.providers.cloudflare.baseUrl='https://api.openai.com/v1';
 await assert.rejects(make(bad)(c),/cloudflare_model_catalog_invalid/);assert.equal(JSON.stringify(c),original);
});

test('legacy hosted references migrate to isolated postpaid provider while preserving unrelated agent settings',async()=>{
 const config={agents:{entries:{sopsutil:{name:'preserve',model:{primary:'cloudflare/@cf/zai-org/glm-5.3',fallbacks:['cloudflare/@cf/zai-org/glm-5.3-flash']}}}}};
 await make()(config);
 assert.equal(config.agents.entries.sopsutil.name,'preserve');
 assert.equal(config.agents.entries.sopsutil.model.primary,'cloudflare-workers/@cf/zai-org/glm-5.3');
 assert.deepEqual([...config.agents.entries.sopsutil.model.fallbacks],['cloudflare-workers/@cf/zai-org/glm-5.3-flash']);
 assert.equal(config.agents.defaults.model.primary,'cloudflare-workers/@cf/zai-org/glm-5.3');
 assert.deepEqual([...config.agents.defaults.model.fallbacks],[]);
});

test('legacy alias restriction migrates once while retaining Cloudflare, custom choices and native provider wildcards',async()=>{
 const config={agents:{defaults:{models:{'custom/native-fixture':{alias:'Keep me'}}},entries:{inherits:{model:'anthropic/native-fixture'}}}};
 await make()(config);const policy=JSON.stringify(config.agents.defaults.modelPolicy);
 assert.equal(config.agents.defaults.modelPolicy.allow.length,117);
 assert.ok(config.agents.defaults.modelPolicy.allow.includes('custom/native-fixture'));
 for(const ref of Object.keys(catalog.agents.defaults.models))assert.ok(config.agents.defaults.modelPolicy.allow.includes(ref));
 assert.ok(config.agents.defaults.modelPolicy.allow.includes('anthropic/*'));
 assert.ok(config.agents.defaults.modelPolicy.allow.includes('openai/*'));
 assert.equal(config.agents.entries.inherits.modelPolicy,undefined);
 await make()(config);assert.equal(JSON.stringify(config.agents.defaults.modelPolicy),policy);
});
test('explicit nonempty policies admit native providers without dropping rules or broadening explicit empty policies',async()=>{
 const config={agents:{defaults:{modelPolicy:{allow:['custom/*'],deny:['custom/blocked']}},entries:{
  restricted:{modelPolicy:{allow:['cloudflare-workers/*'],deny:['anthropic/blocked']}},
  emptyObject:{modelPolicy:{}},emptyArray:{modelPolicy:{allow:[],deny:['custom/blocked']}}
 }}};
 for(let boot=0;boot<2;boot++){
  await make()(config);
  assert.deepEqual([...config.agents.defaults.modelPolicy.allow],['custom/*','anthropic/*','openai/*']);
  assert.deepEqual([...config.agents.defaults.modelPolicy.deny],['custom/blocked']);
  assert.deepEqual([...config.agents.entries.restricted.modelPolicy.allow],['cloudflare-workers/*','anthropic/*','openai/*']);
  assert.deepEqual([...config.agents.entries.restricted.modelPolicy.deny],['anthropic/blocked']);
  assert.equal(JSON.stringify(config.agents.entries.emptyObject.modelPolicy),'{}');
  assert.equal(JSON.stringify(config.agents.entries.emptyArray.modelPolicy),JSON.stringify({allow:[],deny:['custom/blocked']}));
 }
 for(const modelPolicy of [{},{allow:[]}]){
  const unrestricted={agents:{defaults:{modelPolicy}}};const before=JSON.stringify(modelPolicy);
  await make()(unrestricted);await make()(unrestricted);
  assert.equal(JSON.stringify(unrestricted.agents.defaults.modelPolicy),before);
 }
});
