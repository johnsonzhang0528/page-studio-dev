import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAffiliateEconomicsStressTest} from '../lib/affiliate-economics-stress-test.mjs';

const source={mode:'FREE_BUSINESS_MODEL_DEATH_TEST',paid_api_spend_microusd:0,candidates:[{candidate_id:'TW-012',topic:'貓砂比較'},{candidate_id:'TW-077',topic:'筆記軟體比較'}]};

test('physical affiliate stress test exposes assumptions and break-even burden',()=>{
  const out=buildAffiliateEconomicsStressTest(source);
  const physical=out.candidates[0];
  assert.equal(physical.decision,'HOLD_UNIT_ECONOMICS_UNVERIFIED');
  assert.deepEqual(physical.scenarios.map(row=>row.break_even_qualified_clicks_per_month),[40000,6667,2223]);
  assert.ok(physical.scenarios.every(row=>row.evidence_status==='STRESS_TEST_ASSUMPTION_NOT_OBSERVED'));
});

test('unknown SaaS commission remains incalculable instead of fabricating economics',()=>{
  const out=buildAffiliateEconomicsStressTest(source);
  assert.equal(out.candidates[1].decision,'HOLD_INCALCULABLE');
  assert.deepEqual(out.candidates[1].scenarios,[]);
});

test('stress test cannot authorize spend, build, or automatic entry',()=>{
  const out=buildAffiliateEconomicsStressTest(source);
  assert.equal(out.paid_research_authorized,false);
  assert.equal(out.can_build_site,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.paid_api_spend_microusd,0);
});

test('paid or unrelated source fails closed',()=>{
  assert.throws(()=>buildAffiliateEconomicsStressTest({...source,paid_api_spend_microusd:1}),/VERIFIED_FREE_DEATH_TEST_REQUIRED/);
});
