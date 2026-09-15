import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dispatchKeywordIdeasExpansion} from '../lib/expansion-dispatch.mjs';

const source=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-expansion-remainder.mjs',import.meta.url),'utf8');
const request=index=>({keywords:[`未送出主題${index}`],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:20,offset:20,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:`page-autodev-ideas-expand-seed-${index}`});
const four=[3,4,5,6].map(request);

test('remainder plan excludes settled first seed and cannot exceed prior total approval',()=>{
  assert.match(source,/plan\.requests\.slice\(1\)/);
  assert.match(source,/request\.keywords\[0\]==='網站架設'/);
  assert.match(source,/original\.actual_microusd\+remainingMax>original\.reserved_microusd/);
  assert.match(source,/original\.reconciliation\?\.provider_task_id!==approval\.original_provider_task_id/);
  assert.match(source,/remainingMax=57600/);
  assert.match(source,/REMAINDER_ALREADY_ATTEMPTED/);
  assert.match(source,/candidate-expansion-remainder-failure-v1\.json/);
});

test('four-task mode sends exactly four distinct paid tasks in sequence',async()=>{
  let calls=0;
  const result=await dispatchKeywordIdeasExpansion({requests:four,expected_task_count:4,path:'/v3/dataforseo_labs/google/keyword_ideas/live',lease_id:'a'.repeat(64),request_id:'remainder:test',authority:{issue:()=>({})},client:async()=>{calls++;return {status:200,body:Buffer.from(JSON.stringify({status_code:20000,tasks:[{status_code:20000,cost:0.0144,result:[{keyword:'測試'}]}]}))};},on_task:()=>{}});
  assert.equal(calls,4);
  assert.equal(result.actual_microusd,57600);
  assert.equal(result.envelope.tasks.length,4);
});

test('four-task mode rejects a fifth request before any transport',async()=>{
  let calls=0;
  await assert.rejects(dispatchKeywordIdeasExpansion({requests:[...four,request(7)],expected_task_count:4,client:async()=>{calls++;}}),/EXPANSION_BATCH_INVALID/);
  assert.equal(calls,0);
});
