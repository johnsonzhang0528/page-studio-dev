import {evaluateBusinessModelGate} from './business-model-gate.mjs';

const PHYSICAL=/(貓砂|玩具|模具|家電|行車記錄器|背包|自行車|桌遊)/u;

function affiliateModel(candidate){
  const physical=PHYSICAL.test(candidate.topic);
  return {
    id:physical?'marketplace-affiliate':'saas-affiliate',
    type:physical?'AFFILIATE_COMMERCE':'SAAS_AFFILIATE',
    requires_manual_product_production:false,
    requires_manual_customer_fulfillment:false,
    automation_ratio_bps:9500,
    ongoing_manual_hours_per_1000_visits:2,
    evidence:{
      channel_eligibility:'UNVERIFIED',
      search_intent_fit:'UNVERIFIED',
      revenue_rate:'UNVERIFIED',
      traffic_requirement:'UNVERIFIED',
      operating_cost:'UNVERIFIED',
      legal_policy:'VERIFIED',
      dependency_resilience:'UNVERIFIED',
      worst_case_viability:'UNVERIFIED',
      kill_rule:'VERIFIED'
    },
    economic_scenarios:[],
    evidence_notes:physical?[
      'SHOPEE_TW_WEBSITE_MEDIA_ALLOWED_BUT_APPLICATION_APPROVAL_REQUIRED',
      'GENERAL_PROMOTER_BASE_RATE_IS_NOT_PRODUCT_LEVEL_REVENUE_PROOF',
      'ELIGIBLE_PRODUCT_COMPLETED_ORDER_AND_CONVERSION_EVIDENCE_MISSING'
    ]:[
      'AFFILIATE_NETWORK_EXISTENCE_IS_NOT_AN INDIVIDUAL_PRODUCT_PROGRAM',
      'PRODUCT_LEVEL_ELIGIBILITY_COMMISSION_AND_TAIWAN_PAYOUT_UNVERIFIED'
    ]
  };
}

export function buildFreeBusinessDeathTest(shortlist){
  if(shortlist?.mode!=='FREE_COMMERCIAL_EVIDENCE_SHORTLIST'||shortlist?.paid_research_authorized!==false)throw new Error('VERIFIED_FREE_SHORTLIST_REQUIRED');
  const candidates=shortlist.candidates.map(candidate=>{
    const gate=evaluateBusinessModelGate({schema_version:2,niche_id:candidate.candidate_id,pilot_cash_cap_twd:0,pilot_hour_cap:0,models:[affiliateModel(candidate)]});
    return {candidate_id:candidate.candidate_id,topic:candidate.topic,decision:gate.decision,can_release_pilot:gate.can_release_pilot,models:gate.models};
  });
  return {
    schema_version:1,
    mode:'FREE_BUSINESS_MODEL_DEATH_TEST',
    source_shortlist_count:shortlist.shortlist_count,
    evaluated_count:candidates.length,
    decision_counts:Object.fromEntries(['PILOT_BUSINESS_MODEL_APPROVED','HOLD_BUSINESS_MODEL_NOT_VALIDATED','REJECT_NICHE_NO_AUTOMATED_MODEL'].map(decision=>[decision,candidates.filter(row=>row.decision===decision).length])),
    paid_api_spend_microusd:0,
    paid_research_authorized:false,
    automatic_enter:false,
    can_build_site:false,
    candidates,
    next_gate:'VERIFY_CHANNEL_APPROVAL_PRODUCT_ELIGIBILITY_AND_CONSERVATIVE_UNIT_ECONOMICS_BEFORE_PAID_KEYWORD_RESEARCH'
  };
}
