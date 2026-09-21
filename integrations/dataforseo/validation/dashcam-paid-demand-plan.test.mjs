import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDashcamPaidDemandPlan} from '../lib/dashcam-paid-demand-plan.mjs';

const source={mode:'FREE_SERP_COMMERCIAL_REVIEW',decision:'PROPOSE_BOUNDED_PAID_DEMAND_CHECK',paid_research_authorized:false,candidate_id:'TW-083'};
const now=Date.parse('2026-09-20T17:15:00Z');

test('plan binds exactly five keywords and three shallow SERPs',()=>{
  const out=buildDashcamPaidDemandPlan(source,{now});
  assert.equal(out.keyword_count,5);
  assert.equal(out.serp_task_count,3);
  assert.equal(out.request_count,4);
  assert.ok(out.requests.slice(1).every(row=>row.body.depth===10));
});

test('official current pricing produces an exact hard maximum',()=>{
  const out=buildDashcamPaidDemandPlan(source,{now});
  assert.equal(out.requests[0].maximum_cost_microusd,12600);
  assert.equal(out.maximum_cost_microusd,18600);
  assert.equal(out.maximum_cost_usd,0.0186);
});

test('cost multipliers, clickstream, expansion, and retry are forbidden',()=>{
  const out=buildDashcamPaidDemandPlan(source,{now});
  assert.equal(out.requests[0].body.include_clickstream_data,false);
  assert.equal(out.no_optional_paid_parameters,true);
  assert.equal(out.no_expansion,true);
  assert.equal(out.automatic_retry,false);
  assert.equal(out.maximum_attempts_per_request,1);
});

test('plan is deterministic but never self-authorizes',()=>{
  const a=buildDashcamPaidDemandPlan(source,{now});
  const b=buildDashcamPaidDemandPlan(source,{now});
  assert.equal(a.plan_sha256,b.plan_sha256);
  assert.equal(a.dispatch_authorized,false);
  assert.equal(a.approval_required,true);
  assert.equal(a.can_build_site,false);
});

test('stale pricing or altered source fails closed',()=>{
  assert.throws(()=>buildDashcamPaidDemandPlan(source,{now:Date.parse('2026-09-27T17:00:00Z')}),/PRICE_SNAPSHOT_NOT_CURRENT/);
  assert.throws(()=>buildDashcamPaidDemandPlan(source,{now:Date.parse('2026-09-20T16:59:59Z')}),/PRICE_SNAPSHOT_NOT_CURRENT/);
  assert.throws(()=>buildDashcamPaidDemandPlan({...source,paid_research_authorized:true},{now}),/VERIFIED_FREE_SERP_REVIEW_REQUIRED/);
});
