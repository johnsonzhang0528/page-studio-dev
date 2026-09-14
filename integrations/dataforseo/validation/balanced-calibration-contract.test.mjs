import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildSeedDiscoveryPlan} from '../lib/query-candidate-builder.mjs';
import {validateBalancedKeywordIdeasBatch} from '../lib/dataforseo-contract.mjs';
import {estimateBalancedKeywordIdeasMicrousd} from '../lib/provider-registry.mjs';
import {validateBalancedCalibrationApproval} from '../lib/canary-approval.mjs';
import {normalizeBalancedKeywordIdeas} from '../lib/dataforseo-normalizer.mjs';
import {BillingGateway} from '../lib/billing-gateway.mjs';

const seeds=['網站架設','SEO','記帳軟體','空氣清淨機','日本自由行','英文學習'];
const requests=buildSeedDiscoveryPlan(seeds).map(item=>item.request);
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));

test('balanced batch binds six ordered one-seed tasks and trusted total cost',()=>{
  const result=validateBalancedKeywordIdeasBatch(requests);
  assert.equal(result.ok,true);
  assert.equal(estimateBalancedKeywordIdeasMicrousd(registry,requests),86400);
  assert.equal(validateBalancedKeywordIdeasBatch([...requests].reverse()).ok,false);
  assert.equal(validateBalancedKeywordIdeasBatch(requests.slice(0,5)).ok,false);
  const smuggled=structuredClone(requests);smuggled[0].keywords.push('extra');assert.equal(validateBalancedKeywordIdeasBatch(smuggled).ok,false);
});

test('balanced approval is short-lived and bound to exact request plan and budget',()=>{
  const now=Date.parse('2026-09-14T00:00:00Z'),item={schema_version:2,approval_id:'calibration-0123456789abcdef',expires_at:'2026-09-14T00:10:00Z',request_plan_sha256:'a'.repeat(64),seed_count:6,per_seed_limit:20,max_microusd:86400};
  assert.equal(validateBalancedCalibrationApproval({approval:item,mode:0o600,uid:0,now,expected_request_plan_sha256:'a'.repeat(64)}).max_microusd,86400);
  for(const mutation of [x=>x.seed_count=5,x=>x.per_seed_limit=21,x=>x.max_microusd=86401,x=>x.request_plan_sha256='b'.repeat(64)]){const copy=structuredClone(item);mutation(copy);assert.throws(()=>validateBalancedCalibrationApproval({approval:copy,mode:0o600,uid:0,now,expected_request_plan_sha256:'a'.repeat(64)}),/SCOPE/);}
});

test('gateway rejects understated balanced batch cost before reserving spend',async()=>{
  let reserved=false;const active=structuredClone(registry);active.activation='canary';
  const gateway=new BillingGateway({ledger:{async reserve(){reserved=true;return {status:'RESERVED'};}},registry:active,budget_policy:{per_request_microusd:100000,per_project_daily_microusd:100000,global_daily_microusd:100000,global_monthly_microusd:500000},usage_reader:async()=>({project_day_used_microusd:0,global_day_used_microusd:0,global_month_used_microusd:0}),clock:()=>Date.parse('2026-09-14T00:00:00Z'),activation_mode:'canary'});
  const result=await gateway.authorize({capability:'keyword_ideas_balanced',request:requests,estimated_microusd:1,project_id:'calibration',day:'2026-09-14'});
  assert.equal(result.reason,'UNTRUSTED_COST_ESTIMATE');assert.equal(result.trusted_estimated_microusd,86400);assert.equal(reserved,false);
});

test('normalizer attributes every returned row to its exact source task',()=>{
  const tasks=requests.map((request,index)=>({id:`task-${index}`,status_code:20000,status_message:'Ok.',cost:0.0144,result:[{items:[{keyword:`${request.keywords[0]} 指南`,keyword_info:{search_volume:100,competition:0.1,cpc:1},keyword_properties:{keyword_difficulty:20},search_intent_info:{main_intent:'informational'}}]}]}));
  const envelope={version:'0.1',status_code:20000,status_message:'Ok.',tasks};
  const contexts=seeds.map((source_seed,index)=>({source_seed,request_fingerprint:String(index+1).repeat(64).slice(0,64),retrieved_at:'2026-09-14T00:00:00Z',location_code:2158,language_code:'zh-TW',endpoint:'dataforseo_labs/google/keyword_ideas/live'}));
  const rows=normalizeBalancedKeywordIdeas(envelope,contexts);
  assert.deepEqual(rows.map(row=>row.source_seed),seeds);
  assert.deepEqual(rows.map(row=>row.source_task_index),[0,1,2,3,4,5]);
  assert.ok(rows.every(row=>row.provider_cost===0.0144));
  assert.throws(()=>normalizeBalancedKeywordIdeas(envelope,contexts.slice(1)),/CARDINALITY/);
});
