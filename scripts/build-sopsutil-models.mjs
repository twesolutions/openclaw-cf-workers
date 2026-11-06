import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const ACCOUNT_ID='6eef883dec740547667d5a2522924a3b';
export const PRIMARY='cloudflare-workers/@cf/zai-org/glm-5.3';
export const FALLBACKS=[];
export const providerFor=model=>model.id.startsWith('@cf/')?'cloudflare-workers':model.api==='anthropic-messages'?'cloudflare-messages':'cloudflare';
export const aliasFor=model=>model.name+(providerFor(model)==='cloudflare-workers'?' (Cloudflare Neurons · postpaid)':' (Cloudflare Unified Billing · prepaid)');
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0?Math.floor(Number(value)):undefined;
const normalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const entries=rows=>Array.isArray(rows)?rows:rows?.result??[];
const properties=row=>Object.fromEntries((row.properties??[]).map(p=>[p.property_id,p.value]));
const affirmative=value=>value===true||/^(true|yes|always on|configurable|chain-of-thought)/i.test(String(value));
function metadataField(metadata,pattern){return Object.entries(metadata).find(([key])=>pattern.test(normalize(key)))?.[1];}
function metadataContext(metadata){
 const value=metadataField(metadata,/^context(window|length)$/);
 const match=String(value??'').replaceAll(',','').match(/^(\d+(?:\.\d+)?)\s*([km])?/i);
 return match?positive(Number(match[1])*({k:1000,m:1000000}[match[2]?.toLowerCase()]??1)):undefined;
}
function active(row,metadata,asOf){
 if(row.private===true)return false;
 const date=metadataField(metadata,/^planneddeprecationdate$/);
 const time=Date.parse(date);
 return !Number.isFinite(time)||time>Date.parse(asOf);
}
function selectApi(row){
 const formats=row.request_formats??[];
 if((row.model_id.startsWith('anthropic/')||row.model_id.startsWith('thinkingmachines/'))&&formats.includes('anthropic-messages'))return 'anthropic-messages';
 if(row.model_id.startsWith('openai/')&&formats.includes('responses'))return 'openai-responses';
 if(formats.includes('chat-completions'))return 'openai-completions';
 if(formats.includes('responses'))return 'openai-responses';
 if(formats.includes('anthropic-messages'))return 'anthropic-messages';
}
function toolsCapability(metadata,hosted){
 const raw=metadataField(metadata,/^(functioncalling|toolcalling|tooluse)$/);
 if(raw===false||/^(false|no|unsupported)$/i.test(String(raw)))return false;
 if(affirmative(raw)||/responses api only/i.test(String(raw)))return true;
 // A hosted catalog explicitly advertises function_calling per model. Do not
 // pass tools to older hosted text-only models lacking that capability flag.
 // Third-party entries omit this field even for standard tool-capable families:
 // absence is unknown, not an invented positive or negative declaration.
 return hosted?false:undefined;
}
function modelDefinition(row,hosted){
 const metadata=hosted?properties(row):row.metadata??{};
 const id=hosted?row.name:row.model_id;
 const contextWindow=positive(hosted?metadata.context_window:row.context_length)??metadataContext(metadata)??32768;
 const observedMax=positive(hosted?metadata.max_output_tokens:row.max_output_tokens);
 // Catalog output ceilings are preserved. Unknown limits get a conservative
 // request budget (not a claim about the model's native ceiling). Contexts
 // without catalog metadata use 32768; output fallback is at most 8192.
 const maxTokens=observedMax??Math.min(8192,contextWindow);
 const tags=Array.isArray(row.tags)?row.tags:[];
 const vision=affirmative(metadataField(metadata,/^vision$/))||Object.entries(metadata).some(([key,value])=>/^(inputmodalities|modalities|architecture)$/.test(normalize(key))&&/image|vision|multimodal/i.test(String(value)))||tags.some(tag=>/^(vision|multimodal)$/i.test(tag));
 const reasoningValue=metadataField(metadata,/^(reasoning|thinking|adaptivethinking|extendedthinking|defaultthinkinglevel|reasoningeffort)$/);
 const reasoning=reasoningValue!==undefined?!/^(false|no|none)$/i.test(String(reasoningValue)):tags.some(tag=>/^(reasoning|thinking)$/i.test(tag));
 const supportsTools=toolsCapability(metadata,hosted);
 const model={id,name:hosted?id.replace(/^@cf\//,''):row.name||id,api:hosted?'openai-completions':selectApi(row),reasoning,input:vision?['text','image']:['text'],contextWindow,maxTokens};
 if(supportsTools!==undefined)model.compat={supportsTools};
 return model;
}

/** Pure, deterministic config generation. Neither input nor output contains credentials. */
export function buildSopsutilModels(external,workers,{asOf=new Date().toISOString(),requireDefaults=true}={}){
 if(!Number.isFinite(Date.parse(asOf)))throw new Error('invalid_catalog_as_of');
 const models=new Map();
 for(const row of entries(workers)){
  const metadata=properties(row);
  if(row.task?.name!=='Text Generation'||!active(row,metadata,asOf))continue;
  if(/^@cf\/cloudflare\/(?:clef(?:-|$)|clairic(?:-|$))/.test(row.name)||/\/llama-guard(?:-|$)/.test(row.name))continue;
  const model=modelDefinition(row,true);models.set(model.id,model);
 }
 for(const row of entries(external)){
  if(row.task!=='Text Generation'||!active(row,row.metadata??{},asOf)||!selectApi(row))continue;
  const model=modelDefinition(row,false);models.set(model.id,model);
 }
 const sorted=[...models.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 if(requireDefaults&&!models.has(PRIMARY.slice('cloudflare-workers/'.length)))throw new Error('required_default_model_missing');
 const aliases=Object.fromEntries(sorted.map(model=>[providerFor(model)+'/'+model.id,{alias:aliasFor(model)}]));
 const base=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai`;
 const provider=(baseUrl,api,rows)=>({baseUrl,api,apiKey:{source:'env',provider:'default',id:'CLOUDFLARE_AI_API_TOKEN'},authHeader:true,headers:{'cf-aig-gateway-id':'default'},models:rows});
 return {
  // Native Anthropic SDK appends /v1/messages; OpenAI SDK appends /responses
  // or /chat/completions. Separate bases avoid accidental /ai/v1/v1/messages.
  // authHeader:true makes OpenClaw inject Bearer auth for the Anthropic SDK,
  // whose native default x-api-key alone does not meet Cloudflare's contract.
  models:{mode:'merge',providers:{
   cloudflare:provider(base+'/v1','openai-completions',sorted.filter(model=>providerFor(model)==='cloudflare')),
   'cloudflare-messages':provider(base,'anthropic-messages',sorted.filter(model=>providerFor(model)==='cloudflare-messages')),
   // A prepaid billing cooldown must not suppress account-hosted Neuron models.
   'cloudflare-workers':provider(base+'/v1','openai-completions',sorted.filter(model=>providerFor(model)==='cloudflare-workers'))
  }},
  agents:{defaults:{model:{primary:PRIMARY,fallbacks:[...FALLBACKS]},models:aliases}}
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [externalPath,workersPath,outputPath,asOf]=process.argv.slice(2);
 if(!externalPath||!workersPath||!outputPath)throw new Error('usage: node scripts/build-sopsutil-models.mjs external.json workers.json output.json [as-of]');
 const [external,workers]=await Promise.all([readFile(externalPath,'utf8'),readFile(workersPath,'utf8')]);
 const config=buildSopsutilModels(JSON.parse(external),JSON.parse(workers),asOf?{asOf}:undefined);
 await writeFile(outputPath,JSON.stringify(config,null,2)+'\n');
 console.log(JSON.stringify({models:Object.values(config.models.providers).reduce((count,provider)=>count+provider.models.length,0),output:outputPath}));
}
