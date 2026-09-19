import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRakutenProductEvidenceSnapshot} from '../lib/rakuten-product-evidence-snapshot.mjs';

const candidate=(id,topic)=>({candidate_id:id,topic,applicable_channel_ids:['SHOPEE_TW','RAKUTEN_TW_REBATES']});
const source={mode:'AFFILIATE_CHANNEL_VERIFICATION',paid_api_spend_microusd:0,candidates:[candidate('TW-065','烘焙模具比較'),candidate('TW-020','寵物玩具評測')]};

test('one higher-rate product cannot prove a category',()=>{
  const row=buildRakutenProductEvidenceSnapshot(source).candidates[0];
  assert.equal(row.rakuten_product_evidence.observed_max_rate_bps,300);
  assert.equal(row.category_rate_proven,false);
  assert.equal(row.decision,'HOLD_CATEGORY_SAMPLE_REQUIRED');
});

test('missing product evidence remains held without invented zero rate',()=>{
  const row=buildRakutenProductEvidenceSnapshot(source).candidates[1];
  assert.equal(row.rakuten_product_evidence.observed_max_rate_bps,null);
  assert.equal(row.decision,'HOLD_PRODUCT_RATE_REQUIRED');
});

test('sampling gate requires diversity and cannot authorize entry',()=>{
  const out=buildRakutenProductEvidenceSnapshot(source);
  assert.equal(out.sampling_rule.minimum_distinct_products,5);
  assert.equal(out.sampling_rule.minimum_distinct_sellers,3);
  assert.equal(out.sampling_rule.category_inference_from_single_product,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.paid_api_spend_microusd,0);
});
