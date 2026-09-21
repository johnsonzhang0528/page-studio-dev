import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDashcamCommercialDeathTest} from '../lib/dashcam-commercial-death-test.mjs';

const kwItems = [
  ['行車記錄器推薦', 8100], ['行車記錄器比較', 30], ['行車記錄器前後鏡頭', 90], ['電子後視鏡行車記錄器', 480]
].map(([keyword, search_volume]) => ({keyword, keyword_info: {search_volume, cpc: 0.1, competition: 1, competition_level: 'HIGH'}}));
const receipt = (id, keyword = null) => ({id, envelope: {tasks: [{data: keyword ? {keyword} : {keywords: ['行車記錄器推薦','行車記錄器比較','行車記錄器前後鏡頭','電子後視鏡行車記錄器','行車記錄器安裝價格']}, result: [{items: keyword ? [{type:'organic',domain:'example.com'}] : kwItems}]}]}});
const demand = {completed:true,recovery_completed:true,cumulative_research_cost_microusd:30960,receipts:[receipt('DASH-KW-001'),receipt('DASH-SERP-001','行車記錄器推薦'),receipt('DASH-SERP-002','行車記錄器比較'),receipt('DASH-SERP-003','電子後視鏡行車記錄器')]};
const affiliate = {candidate_id:'TW-083',topic:'行車記錄器比較',sample_quality:'PASS_DIVERSITY_GATE',median_price_twd:6290,median_rate_bps:100,monthly_cost_assumption_twd:2000,scenarios:[{conversion_bps:100,break_even_qualified_clicks_per_month:3180,evidence_status:'CONVERSION_ASSUMPTION_NOT_OBSERVED'},{conversion_bps:200,break_even_qualified_clicks_per_month:1590,evidence_status:'CONVERSION_ASSUMPTION_NOT_OBSERVED'},{conversion_bps:300,break_even_qualified_clicks_per_month:1060,evidence_status:'CONVERSION_ASSUMPTION_NOT_OBSERVED'}]};

test('rejects dashcam as a standalone site without spending or authorizing build', () => {
  const out = buildDashcamCommercialDeathTest(demand, affiliate);
  assert.equal(out.decision, 'REJECT_STANDALONE_SITE');
  assert.equal(out.cluster_disposition, 'HOLD_FOR_BROADER_AUTOMOTIVE_CLUSTER');
  assert.equal(out.automatic_enter, false);
  assert.equal(out.can_build_site, false);
  assert.equal(out.incremental_paid_api_spend_microusd, 0);
  assert.equal(out.keyword_evidence.known_monthly_search_volume, 8700);
  assert.equal(out.keyword_evidence.head_volume_share, 0.931);
  assert.equal(out.economics.required_sales_per_month, 32);
  assert.equal(out.economics.scenarios[2].break_even_search_capture_share, 0.1218);
});

test('preserves provider omission as unknown and never conflates ads competition with SEO KD', () => {
  const out = buildDashcamCommercialDeathTest(demand, affiliate);
  const missing = out.keyword_evidence.rows.find(row => row.keyword === '行車記錄器安裝價格');
  assert.equal(missing.search_volume, null);
  assert.equal(missing.evidence_status, 'PROVIDER_OMITTED');
  assert.equal(out.keyword_evidence.rows[0].seo_kd, null);
  assert.equal(out.keyword_evidence.paid_ads_competition_is_not_seo_kd, true);
});

test('fails closed on incomplete paid evidence', () => {
  assert.throws(() => buildDashcamCommercialDeathTest({...demand, recovery_completed:false}, affiliate), /DEMAND_EVIDENCE_INCOMPLETE/);
});
