import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import vm from 'node:vm';

const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const teamsVersion=source.match(/const teamsVersion='([^']+)'/)?.[1];
assert.equal(teamsVersion,'2026.11.1');
const teamsMigrationPath='/state/.bootstrap/teams-pre-migration-'+teamsVersion+'.json';
const names=['migrateCore','installTeamsPlugin','main'];
const functions=names.map(name=>{
 const fn=source.match(new RegExp('async function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}'))?.[0];
 assert.ok(fn,name);return fn;
}).join('\n');
const initial={
 gateway:{auth:{mode:'password'},controlUi:{allowedOrigins:['https://sopsbot.tweai.dev']}},
 channels:{msteams:{enabled:true,customPreserved:'channel'},other:{enabled:false}},
 plugins:{entries:{msteams:{enabled:true,customPreserved:'plugin'},other:{enabled:false}}},
 agents:{defaults:{workspace:'/state/workspace-sopsutil'},entries:{sopsutil:{name:'Existing agent'}}},
};
function fixture({config=initial,doctorFailure=0,trusted=true,version='2026.11.1',marker=false,dependenciesInstalled=true}={}){
 const events=[];let doctors=0;
 const files=new Map([['/state/openclaw.json',JSON.stringify(config)]]);
 if(marker)files.set('/state/.bootstrap/msteams-native-install-2026.11.1','official npm install\n');
 const env={PUBLIC_ORIGIN:'https://sopsbot.tweai.dev',npm_config_offline:'true'};
 const context={
  root:'/state',cli:'/app/openclaw.mjs',teamsVersion,teamsMigrationPath,TWE_MEMBER_OBJECT_IDS:['fixture-member'],join,resolve,
  process:{env,on:()=>{}},console:{log:()=>{}},
  readFile:async path=>{if(!files.has(path))throw Object.assign(new Error('missing'),{code:'ENOENT'});return files.get(path);},
  writeFile:async(path,value,options)=>{assert.equal(options.mode,0o600);files.set(path,value);},
  stat:async path=>{if(files.has(path)||path.endsWith('/sopsutil/.git'))return {};throw Object.assign(new Error('missing'),{code:'ENOENT'});},
  mkdir:async()=>{},rm:async path=>{events.push(['remove',path]);files.delete(path);},
  diagnostic:async stage=>events.push(['diagnostic',stage]),installGitHubCli:async()=>{},restore:async()=>events.push(['restore']),
  configureModels:async c=>{c.models={providers:{cloudflare:{models:[],apiKey:{source:'env'}}}};c.agents.defaults.model={primary:'cloudflare/openai/gpt-6.1-sol'};},
  request:async path=>{assert.equal(path,'/seed');return {status:200,json:async()=>({})};},
  createServer:()=>({listen:()=>events.push(['listen']),close:()=>{}}),
  setInterval:()=>({unref:()=>{}}),clearInterval:()=>{},
  spawn:(_exe,args)=>{events.push(['spawn',...args]);return {on:()=>{}};},
  run:async args=>{
   events.push(['cli',...args]);
   if(args[0]==='doctor'){
    doctors++;const c=JSON.parse(files.get('/state/openclaw.json'));
    if(doctors===1){assert.equal(c.channels.msteams,undefined);assert.equal(c.plugins.entries.msteams.enabled,false);}
    else{assert.equal(c.channels.msteams.enabled,true);assert.equal(c.plugins.entries.msteams.enabled,true);}
    if(doctors===doctorFailure)throw new Error('migration_refused');
   }
   if(args[0]==='plugins'&&args[1]==='install')dependenciesInstalled=true;
   if(args[0]==='plugins'&&args[1]==='inspect')return JSON.stringify({install:{source:'npm',version},plugin:{trustedOfficialInstall:trusted,dependencyStatus:{requiredInstalled:dependenciesInstalled}}});
   return '';
  },
 };
 const api=vm.runInNewContext(functions+'\n({'+names.join(',')+'})',context);
 return {api,files,events,env};
}
test('restored older state migrates without loading old Teams, then enabled-plugin state migrates before Gateway',async()=>{
 const f=fixture();await f.api.main();
 const steps=f.events.filter(e=>e[0]==='cli'||e[0]==='spawn').map(e=>e.slice(1).join(' '));
 assert.deepEqual(steps,[
  'doctor --fix --non-interactive',
  'plugins install @openclaw/msteams@2026.11.1 --force --accept-capabilities',
  'plugins inspect msteams --json',
  'doctor --fix --non-interactive','config validate',
  '/app/openclaw.mjs gateway --bind lan --port 18789',
 ]);
 const saved=JSON.parse(f.files.get('/state/openclaw.json'));
 assert.equal(saved.channels.msteams.customPreserved,'channel');assert.equal(saved.plugins.entries.msteams.customPreserved,'plugin');
 assert.deepEqual(saved.channels.other,initial.channels.other);assert.deepEqual(saved.plugins.entries.other,initial.plugins.entries.other);
 assert.equal(saved.agents.entries.sopsutil.name,'SopsUtil Cloudflare');
 assert.equal(saved.agents.defaults.model.primary,'cloudflare/openai/gpt-6.1-sol');
 assert.equal(saved.gateway.auth.password.source,'env');assert.equal(saved.gateway.auth.password.id,'OPENCLAW_GATEWAY_PASSWORD');
 assert.equal(saved.channels.msteams.authType,'federated');assert.equal(saved.channels.msteams.groupPolicy,'disabled');
 assert.ok(f.files.has('/state/.bootstrap/msteams-native-install-2026.11.1'));
 assert.equal(f.files.has(teamsMigrationPath),false);
 assert.equal(f.env.npm_config_offline,undefined);
});
test('a core migration refusal prevents plugin replacement and Gateway startup',async()=>{
 const f=fixture({doctorFailure:1});await assert.rejects(f.api.main(),/migration_refused/);
 assert.equal(f.events.some(e=>e[0]==='remove'||e[0]==='spawn'||e[0]==='listen'),false);
});
test('an enabled-plugin migration refusal prevents serving or Gateway startup',async()=>{
 const f=fixture({doctorFailure:2});await assert.rejects(f.api.main(),/migration_refused/);
 assert.equal(f.events.some(e=>e[0]==='spawn'||e[0]==='listen'),false);
});
test('untrusted or mismatched plugin install cannot receive a successful bootstrap marker',async()=>{
 for(const options of [{trusted:false},{version:'2026.9.3'}]){
  const f=fixture(options);await assert.rejects(f.api.main(),/msteams_native_provenance_missing/);
  assert.equal(f.files.has('/state/.bootstrap/msteams-native-install-2026.11.1'),false);
  assert.equal(f.events.some(e=>e[0]==='spawn'),false);
 }
});
test('verified current plugin is reused after restore while Doctor still checks both state generations',async()=>{
 const f=fixture({marker:true});await f.api.main();
 assert.equal(f.events.some(e=>e[0]==='remove'&&e[1]==='/state/extensions/msteams'||e[0]==='cli'&&e[1]==='plugins'&&e[2]==='install'),false);
 assert.equal(f.events.filter(e=>e[0]==='cli'&&e[1]==='doctor').length,2);
});
test('a marker cannot suppress repair when restored native inspection reports missing plugin dependencies',async()=>{
 const f=fixture({marker:true,dependenciesInstalled:false});await f.api.main();
 assert.equal(f.events.filter(e=>e[0]==='cli'&&e[1]==='plugins'&&e[2]==='install').length,1);
});
test('failed-boot retry retains original Teams configuration rather than suppressed temporary config',async()=>{
 const first=fixture({doctorFailure:1});await assert.rejects(first.api.main(),/migration_refused/);
 const recovery=first.files.get(teamsMigrationPath);assert.ok(recovery);
 const retry=fixture({config:JSON.parse(first.files.get('/state/openclaw.json'))});
 retry.files.set(teamsMigrationPath,recovery);await retry.api.main();
 const saved=JSON.parse(retry.files.get('/state/openclaw.json'));
 assert.equal(saved.channels.msteams.customPreserved,'channel');assert.equal(saved.plugins.entries.msteams.customPreserved,'plugin');
 assert.equal(retry.files.has(teamsMigrationPath),false);
});
