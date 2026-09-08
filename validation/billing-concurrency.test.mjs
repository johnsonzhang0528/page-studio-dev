import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const worker=fileURLToPath(new URL('./billing-reservation-worker.mjs',import.meta.url));
const now=Date.parse('2026-09-08T01:00:00Z');
const runWorker=(root,index,cap)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[worker,root,String(index),String(now),String(cap)],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH}});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk);
  child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',reject);
  child.on('close',code=>{
    if(code!==0)return reject(new Error(`worker ${index} exit ${code}: ${stderr}`));
    try{resolve(JSON.parse(stdout));}catch{reject(new Error(`worker ${index} invalid output: ${stdout} ${stderr}`));}
  });
});
const runBounded=async(items,limit,operation)=>{
  const results=new Array(items.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){const index=cursor++;if(index>=items.length)return;results[index]=await operation(items[index]);}
  }));
  return results;
};

const counts=(process.env.BILLING_CONCURRENCY_COUNTS??'2,10').split(',').map(Number);
for(const count of counts){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`billing-concurrency-${count}-`)),cap=223;
  const parallelLimit=Math.min(count,Number(process.env.BILLING_CONCURRENCY_PARALLEL_LIMIT??count));
  const results=await runBounded(Array.from({length:count},(_,index)=>index),parallelLimit,index=>runWorker(root,index,cap));
  const accepted=results.filter(item=>item.ok),rejected=results.filter(item=>!item.ok),expected=Math.min(3,count);
  const unexpected=rejected.filter(item=>!['BILLING_HARD_CAP','BILLING_STORE_UNAVAILABLE'].includes(item.code));
  assert.equal(accepted.length,expected,`${count} workers 中最多只能有三筆 74 microUSD reservation 被 223 cap 覆蓋`);
  assert.deepEqual(unexpected,[],`unexpected rejections: ${JSON.stringify(unexpected)}`);
  const state=JSON.parse(fs.readFileSync(path.join(root,'billing-state.json'),'utf8'));
  const exposure=Object.values(state.reservations).reduce((sum,row)=>sum+row.reserved_microusd,0);
  assert.equal(exposure,74*expected);
  assert.ok(exposure<=cap);
  fs.rmSync(root,{recursive:true,force:true});
}
console.log('BILLING_CONCURRENCY_TESTS_OK');
