import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFreeBusinessDeathTest} from '../lib/free-business-death-test.mjs';

const candidate=(id,topic)=>({candidate_id:id,topic,free_commercial_assessment:{decision:'DEATH_TEST_REQUIRED'}});
const source={mode:'FREE_COMMERCIAL_EVIDENCE_SHORTLIST',paid_research_authorized:false,shortlist_count:2,candidates:[candidate('TW-012','貓砂比較'),candidate('TW-077','筆記軟體比較')]};

test('free evidence cannot silently approve a business model',()=>{
  const out=buildFreeBusinessDeathTest(source);
  assert.equal(out.evaluated_count,2);
  assert.equal(out.decision_counts.HOLD_BUSINESS_MODEL_NOT_VALIDATED,2);
  assert.equal(out.can_build_site,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.paid_api_spend_microusd,0);
});

test('marketplace channel existence is not product revenue proof',()=>{
  const out=buildFreeBusinessDeathTest(source);
  const model=out.candidates[0].models[0];
  assert.equal(model.decision,'HOLD');
  assert.ok(model.blockers.includes('CHANNEL_ELIGIBILITY_UNVERIFIED'));
  assert.ok(model.blockers.includes('REVENUE_RATE_UNVERIFIED'));
  assert.ok(model.blockers.includes('THREE_ECONOMIC_SCENARIOS_REQUIRED'));
});

test('SaaS network cannot stand in for a verified product program',()=>{
  const out=buildFreeBusinessDeathTest(source);
  assert.equal(out.candidates[1].models[0].decision,'HOLD');
  assert.match(out.candidates[1].models[0].evidence_notes.join(' '),/PRODUCT_LEVEL_ELIGIBILITY/);
});

test('input must be free and fail closed',()=>{
  assert.throws(()=>buildFreeBusinessDeathTest({...source,paid_research_authorized:true}),/VERIFIED_FREE_SHORTLIST_REQUIRED/);
});
