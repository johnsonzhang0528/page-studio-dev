import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCategoryAffiliateSample} from '../lib/category-affiliate-sample.mjs';

const source={mode:'RAKUTEN_PRODUCT_EVIDENCE_SNAPSHOT',paid_api_spend_microusd:0};

test('baking mold sample passes five-product three-seller diversity gate',()=>{
  const out=buildCategoryAffiliateSample(source);
  assert.equal(out.distinct_product_count,5);
  assert.equal(out.distinct_seller_count,5);
  assert.equal(out.maximum_single_seller_share_bps,2000);
  assert.equal(out.sample_quality,'PASS_DIVERSITY_GATE');
});

test('expired promotional rate is excluded from stable economics',()=>{
  const out=buildCategoryAffiliateSample(source);
  assert.equal(out.median_rate_bps,100);
  assert.ok(out.excluded.some(row=>row.reason==='EXPIRED_LIMITED_PROMOTION'));
});

test('median evidence produces explicit high traffic burden',()=>{
  const out=buildCategoryAffiliateSample(source);
  assert.equal(out.median_price_twd,433);
  assert.deepEqual(out.scenarios.map(row=>row.break_even_qualified_clicks_per_month),[46190,23095,15397]);
  assert.equal(out.decision,'HOLD_LOW_STABLE_COMMISSION_AND_TRAFFIC_BURDEN');
});

test('sample cannot authorize keyword spend or site build',()=>{
  const out=buildCategoryAffiliateSample(source);
  assert.equal(out.paid_research_authorized,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.can_build_site,false);
  assert.equal(out.paid_api_spend_microusd,0);
});
