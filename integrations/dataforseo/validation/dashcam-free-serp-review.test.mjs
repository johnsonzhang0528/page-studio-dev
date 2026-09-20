import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDashcamFreeSerpReview} from '../lib/dashcam-free-serp-review.mjs';

const source={mode:'DASHCAM_AFFILIATE_SAMPLE',candidate_id:'TW-083',topic:'行車記錄器比較',paid_api_spend_microusd:0};

test('four query families show explicit commercial intent',()=>{
  const out=buildDashcamFreeSerpReview(source);
  assert.equal(out.query_count,4);
  assert.equal(out.commercial_intent_queries,4);
  assert.ok(out.findings.includes('COMMERCIAL_INTENT_VISIBLE'));
});

test('independent publishers create an opening but do not prove attainability',()=>{
  const out=buildDashcamFreeSerpReview(source);
  assert.ok(out.independent_editorial_domains>=3);
  assert.ok(out.blockers.includes('CANONICAL_TAIWAN_SERP_DEPTH_UNVERIFIED'));
  assert.ok(out.blockers.includes('HANDS_ON_EVIDENCE_CAPABILITY_UNVERIFIED'));
});

test('free review can only propose a bounded paid check',()=>{
  const out=buildDashcamFreeSerpReview(source);
  assert.equal(out.decision,'PROPOSE_BOUNDED_PAID_DEMAND_CHECK');
  assert.equal(out.proposed_paid_check.maximum_queries,5);
  assert.equal(out.proposed_paid_check.maximum_serp_tasks,3);
  assert.equal(out.proposed_paid_check.approval_required,true);
  assert.equal(out.paid_research_authorized,false);
});

test('review cannot enter, build, or record paid spend',()=>{
  const out=buildDashcamFreeSerpReview(source);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.can_build_site,false);
  assert.equal(out.paid_api_spend_microusd,0);
});
