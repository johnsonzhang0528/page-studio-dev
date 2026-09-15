import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchKeywordIdeasExpansion} from '../lib/expansion-dispatch.mjs';

const request=index=>({keywords:[`網站架設${index}`],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:20,offset:20,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:`page-autodev-ideas-expand-seed-${index}`});
const requests=[1,2,3,4,5].map(request);
const authority={issue:()=>({scope:'test'})};
const success=()=>({status:200,body:Buffer.from(JSON.stringify({status_code:20000,tasks:[{status_code:20000,cost:0.0144,result:[{keyword:'測試'}]}]}))});
const input={requests,path:'/v3/dataforseo_labs/google/keyword_ideas/live',lease_id:'a'.repeat(64),request_id:'expansion:test',authority};

test('five single-task requests checkpoint and never exceed approved estimate',async()=>{
  const checkpoints=[];const result=await dispatchKeywordIdeasExpansion({...input,client:async()=>success(),on_task:state=>checkpoints.push(state)});
  assert.equal(result.actual_microusd,72000);assert.equal(result.envelope.tasks.length,5);assert.equal(checkpoints.length,5);
});
test('ambiguous transport after a known first task never settles known cost as total',async()=>{
  let calls=0;await assert.rejects(dispatchKeywordIdeasExpansion({...input,client:async()=>++calls===1?success():Promise.reject(new Error('timeout')),on_task:()=>{}}),error=>error.message==='TRANSPORT_OUTCOME_UNKNOWN'&&error.known_microusd===null);
  assert.equal(calls,2);
});
test('checkpoint failure stops before sending next paid task',async()=>{
  let calls=0;await assert.rejects(dispatchKeywordIdeasExpansion({...input,client:async()=>{calls++;return success();},on_task:()=>{throw new Error('disk full');}}),error=>error.message==='CHECKPOINT_WRITE_FAILED'&&error.known_microusd===14400);
  assert.equal(calls,1);
});
test('provider cost missing cannot be interpreted as zero',async()=>{
  await assert.rejects(dispatchKeywordIdeasExpansion({...input,client:async()=>({status:200,body:Buffer.from(JSON.stringify({status_code:20000,tasks:[{status_code:20000}]}))}),on_task:()=>{}}),error=>error.message==='PROVIDER_COST_INVALID'&&error.known_microusd===null);
});
