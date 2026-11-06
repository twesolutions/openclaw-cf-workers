import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

const source=await readFile('src/sopsutil/runtime.mjs','utf8');
const fn=source.match(/async function checkpoint\(\)\{[\s\S]*?\n\}/)?.[0];assert.ok(fn);
const report={ok:true,key:'backups/latest.tar.gz',size:128*1024*1024,sha256:'a'.repeat(64),createdAt:'2026-11-06T00:00:00Z'};
function setup(request){
 const state={checkpointing:false,lastBackup:'previous-backup',failure:'previous-error',console:{log:()=>{}},request};
 return {state,checkpoint:vm.runInNewContext('('+fn+')',state)};
}
test('runtime delegates over-90MiB checkpoints to native streaming without buffering files',async()=>{
 const {state,checkpoint}=setup(async(path,options)=>{assert.equal(path,'/checkpoint-native');assert.deepEqual({...options},{method:'POST'});return {json:async()=>report};});
 const saved=await checkpoint();assert.equal(saved.size,128*1024*1024);assert.equal(saved.sha256,report.sha256);assert.equal(saved.lastBackup,report.createdAt);
 assert.equal(state.lastBackup,report.createdAt);assert.equal(state.failure,null);assert.equal(state.checkpointing,false);
});
test('runtime rejects unverified metadata while preserving last successful backup and releasing checkpoint guard',async()=>{
 for(const invalid of [{...report,ok:false},{...report,key:'other'},{...report,size:0},{...report,sha256:'bad'},{...report,createdAt:'not-a-date'}]){
  const {state,checkpoint}=setup(async()=>({json:async()=>invalid}));await assert.rejects(checkpoint(),/checkpoint_metadata_invalid/);
  assert.equal(state.lastBackup,'previous-backup');assert.equal(state.failure,'checkpoint_metadata_invalid');assert.equal(state.checkpointing,false);
 }
});
test('runtime transport failure preserves successful backup and reports failure',async()=>{
 const {state,checkpoint}=setup(async()=>{throw new Error('storage_http_503');});await assert.rejects(checkpoint(),/storage_http_503/);
 assert.equal(state.lastBackup,'previous-backup');assert.equal(state.failure,'storage_http_503');assert.equal(state.checkpointing,false);
});
test('runtime refuses overlapping checkpoints and permits the accepted native operation to complete',async()=>{
 let complete;const gate=new Promise(resolve=>complete=resolve);
 const {state,checkpoint}=setup(async()=>{await gate;return {json:async()=>report};});
 const pending=checkpoint();await assert.rejects(checkpoint(),/checkpoint_busy/);complete();await pending;assert.equal(state.checkpointing,false);
});
