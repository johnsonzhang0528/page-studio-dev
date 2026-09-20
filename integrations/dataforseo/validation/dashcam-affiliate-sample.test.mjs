import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDashcamAffiliateSample} from '../lib/dashcam-affiliate-sample.mjs';

const source={mode:'RAKUTEN_PRODUCT_EVIDENCE_SNAPSHOT',paid_api_spend_microusd:0};

test('dashcam sample passes diversity requirements',()=>{
  const out=buildDashcamAffiliateSample(source);
  assert.equal(out.distinct_product_count,5);
  assert.equal(out.distinct_seller_count,5);
  assert.equal(out.maximum_single_seller_share_bps,2000);
});

test('median price and stable rate produce bounded scenarios',()=>{
  const out=buildDashcamAffiliateSample(source);
  assert.equal(out.median_price_twd,6290);
  assert.equal(out.median_rate_bps,100);
  assert.deepEqual(out.scenarios.map(row=>row.break_even_qualified_clicks_per_month),[3180,1590,1060]);
});

test('better economics advance only to free validation',()=>{
  const out=buildDashcamAffiliateSample(source);
  assert.equal(out.decision,'HOLD_PRIORITY_FREE_DEMAND_AND_CONVERSION_VALIDATION');
  assert.equal(out.unit_economics_proven,false);
  assert.ok(out.scenarios.every(row=>row.evidence_status==='CONVERSION_ASSUMPTION_NOT_OBSERVED'));
});

test('sample cannot authorize spend, site build, or automatic entry',()=>{
  const out=buildDashcamAffiliateSample(source);
  assert.equal(out.paid_research_authorized,false);
  assert.equal(out.can_build_site,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.paid_api_spend_microusd,0);
});
