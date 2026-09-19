import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAffiliateChannelVerification} from '../lib/affiliate-channel-verification.mjs';

const source={mode:'AFFILIATE_ECONOMICS_STRESS_TEST',paid_api_spend_microusd:0,candidates:[{candidate_id:'TW-012',topic:'貓砂比較'},{candidate_id:'TW-077',topic:'筆記軟體比較'}]};

test('closed and unverified channels cannot be treated as available',()=>{
  const out=buildAffiliateChannelVerification(source);
  assert.equal(out.channels.find(row=>row.id==='MOMO_POINT_EARN').status,'CLOSED');
  assert.equal(out.channels.find(row=>row.id==='NOTION_AFFILIATE').status,'CLOSED_TO_NEW_AFFILIATES');
  assert.equal(out.channels.find(row=>row.id==='MOMO_NEW_AFFILIATE').publisher_fit,'NOT_PROVEN_FOR_GENERAL_WEBSITE');
});

test('physical candidates retain two possible channels but remain held',()=>{
  const row=buildAffiliateChannelVerification(source).candidates[0];
  assert.deepEqual(row.applicable_channel_ids,['SHOPEE_TW','RAKUTEN_TW_REBATES']);
  assert.equal(row.decision,'HOLD_PRODUCT_LEVEL_CHANNEL_EVIDENCE_REQUIRED');
  assert.ok(row.blockers.includes('CURRENT_PRODUCT_RATE_UNVERIFIED'));
});

test('digital candidate does not inherit closed Notion program',()=>{
  const row=buildAffiliateChannelVerification(source).candidates[1];
  assert.deepEqual(row.applicable_channel_ids,['CLICKUP_AFFILIATE']);
  assert.deepEqual(row.excluded_channel_ids,['NOTION_AFFILIATE']);
  assert.ok(row.blockers.includes('TAIWAN_COMMISSIONABILITY_UNVERIFIED'));
});

test('verification remains offline and cannot authorize entry',()=>{
  const out=buildAffiliateChannelVerification(source);
  assert.equal(out.paid_api_spend_microusd,0);
  assert.equal(out.paid_research_authorized,false);
  assert.equal(out.automatic_enter,false);
  assert.equal(out.can_build_site,false);
});
