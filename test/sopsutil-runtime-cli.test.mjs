import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import vm from 'node:vm';
const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const fn=source.match(/^function run\(.*$/m)[0];
function fixture(){let killed=false;const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed=true;};const spawn=()=>{queueMicrotask(()=>{child.stdout.emit('data','x'.repeat(4_000_001));child.emit('close',killed?143:0);});return child;};return {run:vm.runInNewContext('('+fn+')',{spawn,cli:'/app/openclaw.mjs'}),killed:()=>killed};}
test('large unused restore reports are drained without terminating a successful restore',async()=>{const f=fixture();assert.equal(await f.run(['backup','restore'],{capture:false}),'');assert.equal(f.killed(),false);assert.match(source,/run\(\['backup','restore'.*capture:false/);});
test('commands whose JSON is consumed retain their bounded output refusal',async()=>{const f=fixture();await assert.rejects(f.run(['plugins','inspect']),/cli_output_limit_plugins_143/);assert.equal(f.killed(),true);});
