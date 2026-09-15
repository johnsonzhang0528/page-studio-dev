import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dispatchKeywordIdeasExpansion} from '../lib/expansion-dispatch.mjs';

const source=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-expansion-recovery.mjs',import.meta.url),'utf8');
const request={keywords:['網站架設'],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:20,offset:20,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:'page-autodev-ideas-expand-seed-1'};

test('recovery is bound to lost first seed, settled remainder, extra approval and no retry',()=>{
  assert.match(source,/requests=\[plan\.requests\[0\]\]/);
  assert.match(source,/requests\[0\]\.keywords\[0\]!=='網站架設'/);
  assert.match(source,/remainder\.fingerprint!==requestFingerprint\(plan\.requests\.slice\(1\)\)/);
  assert.match(source,/original\.actual_microusd\+remainder\.actual_microusd\+recoveryMax!==86400/);
  assert.match(source,/recoveryMax=14400/);
  assert.match(source,/RECOVERY_ALREADY_ATTEMPTED/);
  assert.match(source,/automatic_retry_allowed:false/);
});

test('one-task mode submits exactly one bound request and checkpoints before settlement',async()=>{
  let calls=0,checkpoints=0;
  const result=await dispatchKeywordIdeasExpansion({requests:[request],expected_task_count:1,path:'/v3/dataforseo_labs/google/keyword_ideas/live',lease_id:'a'.repeat(64),request_id:'recovery:test',authority:{issue:()=>({})},client:async()=>{calls++;return {status:200,body:Buffer.from(JSON.stringify({status_code:20000,tasks:[{status_code:20000,cost:0.0144,result:[{keyword:'測試'}]}]}))};},on_task:()=>{checkpoints++;}});
  assert.equal(calls,1);assert.equal(checkpoints,1);assert.equal(result.actual_microusd,14400);
});

test('one-task mode refuses a second request before transport',async()=>{
  let calls=0;
  await assert.rejects(dispatchKeywordIdeasExpansion({requests:[request,request],expected_task_count:1,client:async()=>{calls++;}}),/EXPANSION_BATCH_INVALID/);
  assert.equal(calls,0);
});
