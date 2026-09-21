import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {validateSerpLiveAdvancedRequest,SERP_LIVE_ADVANCED_ROUTE} from '../lib/dataforseo-serp-contract.mjs';
import {validateDataForSeoEgressPolicy,createDataForSeoEgressHandler} from '../lib/dataforseo-egress.mjs';
import {estimateSerpLiveAdvancedMicrousd} from '../lib/provider-registry.mjs';
import {BillingGateway} from '../lib/billing-gateway.mjs';

const request={keyword:'免費架設網站',location_code:2158,language_code:'zh-TW',device:'desktop',os:'windows',depth:10,tag:'dfs-serp-calibration-01'};
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.test-snapshot.json',import.meta.url)));
const policy=JSON.parse(fs.readFileSync(new URL('../deploy/dataforseo-egress-policy.serp-canary.json',import.meta.url)));
policy.expires_at=new Date(Date.now()+10*60*1000).toISOString();
test('SERP contract rejects paid options, operators, wrong market and depth',()=>{
  assert.equal(validateSerpLiveAdvancedRequest(request).ok,true);
  for(const mutant of [
    {depth:20},{location_code:2840},{language_code:'en'},{device:'mobile'},
    {calculate_rectangles:true},{load_async_overview:true},{people_also_ask_click_depth:1},
    {keyword:'site:example.com seo'},{keyword:'filetype:pdf seo'},
    {tag:'other'}
  ])assert.equal(validateSerpLiveAdvancedRequest({...request,...mutant}).ok,false,JSON.stringify(mutant));
});
test('only the exact SERP route with singleton safe body reaches TLS',async()=>{
  assert.equal(validateDataForSeoEgressPolicy(policy).activation,'active');
  assert.throws(()=>validateDataForSeoEgressPolicy({...policy,expires_at:new Date(Date.now()-1000).toISOString()}),/SERP_CANARY_EXPIRY_INVALID/);
  let count=0;
  const handler=createDataForSeoEgressHandler({policy,verifyGatewayAssertion:async()=>({ok:true}),dispatchTls:async()=>{count++;return {ok:true};}});
  const envelope=(task,path=SERP_LIVE_ADVANCED_ROUTE)=>{const body=Buffer.from(JSON.stringify(task));return {method:'POST',path,body,body_sha256:crypto.createHash('sha256').update(body).digest('hex'),request_id:'r',lease_id:'l',gateway_assertion:'a'};};
  await assert.rejects(handler(envelope([{...request,depth:20}])),/SERP_CONTRACT_INVALID/);
  await assert.rejects(handler(envelope([request,request])),/SERP_CONTRACT_INVALID/);
  await assert.rejects(handler(envelope([request],'/v3/serp/google/organic/task_post')),/SCOPE_INVALID/);
  await handler(envelope([request]));assert.equal(count,1);
});
test('trusted $0.002 price and gateway reject caller understatement',async()=>{
  const fixed=Date.parse('2026-09-16T01:00:00Z');assert.equal(estimateSerpLiveAdvancedMicrousd(registry,fixed),2000);
  assert.throws(()=>estimateSerpLiveAdvancedMicrousd({...registry,serp_live_price_snapshot:{...registry.serp_live_price_snapshot,ten_result_task_microusd:1}},fixed));
  let reserves=0;const gateway=new BillingGateway({ledger:{reserve:async()=>{reserves++;return {status:'RESERVED'};}},registry:{...registry,activation:'canary'},budget_policy:{per_request_microusd:2000,per_project_daily_microusd:24000,global_daily_microusd:24000,global_monthly_microusd:24000},usage_reader:async()=>({project_day_used_microusd:0,global_day_used_microusd:0,global_month_used_microusd:0}),clock:()=>fixed,activation_mode:'canary'});
  const denied=await gateway.authorize({capability:'serp_live_advanced',request,estimated_microusd:1,project_id:'test',day:'2026-09-16'});
  assert.equal(denied.reason,'UNTRUSTED_COST_ESTIMATE');assert.equal(reserves,0);
});
