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
test('model integration preserves gateway, Teams, workspace and identity while replacing direct routes',async()=>{
 const config={gateway:{auth:{mode:'password'},controlUi:{allowedOrigins:['https://sopsbot.tweai.dev']}},channels:{msteams:{enabled:true}},auth:{order:{openai:['old']}},agents:{defaults:{workspace:'/workspace',maxConcurrent:2},entries:{sopsutil:{name:'SopsUtil',model:'openai/gpt-5.6-sol'}}},models:{providers:{openai:{apiKey:'invalid-fixture'}}}};
 const preserved=JSON.stringify({gateway:config.gateway,channels:config.channels,auth:config.auth});
 await make()(config);
 assert.equal(JSON.stringify({gateway:config.gateway,channels:config.channels,auth:config.auth}),preserved);
 assert.equal(config.agents.defaults.workspace,'/workspace');assert.equal(config.agents.defaults.maxConcurrent,2);
 assert.equal(config.agents.entries.sopsutil.model,'cloudflare/openai/gpt-5.6-sol');
 assert.deepEqual(Object.keys(config.models.providers).sort(),['cloudflare','cloudflare-messages','cloudflare-workers']);
 assert.equal(config.models.mode,'replace');assert.equal(Object.keys(config.agents.defaults.models).length,114);
 assert.equal(JSON.stringify(config).includes('invalid-fixture'),false);
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
