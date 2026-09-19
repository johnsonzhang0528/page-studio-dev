const PHYSICAL=/(貓砂|玩具|模具|家電|行車記錄器|背包|自行車|桌遊)/u;

const SCENARIOS=[
  {name:'CONSERVATIVE',aov_twd:500,commission_bps:100,conversion_bps:100,monthly_cost_twd:2000},
  {name:'BASE_HYPOTHESIS',aov_twd:1500,commission_bps:100,conversion_bps:200,monthly_cost_twd:2000},
  {name:'UPSIDE_HYPOTHESIS',aov_twd:3000,commission_bps:100,conversion_bps:300,monthly_cost_twd:2000}
];

function calculate(row){
  const revenuePerQualifiedClick=(row.aov_twd*row.commission_bps*row.conversion_bps)/100_000_000;
  return {...row,revenue_per_qualified_click_twd:Number(revenuePerQualifiedClick.toFixed(4)),break_even_qualified_clicks_per_month:Math.ceil(row.monthly_cost_twd/revenuePerQualifiedClick),evidence_status:'STRESS_TEST_ASSUMPTION_NOT_OBSERVED'};
}

export function buildAffiliateEconomicsStressTest(deathTest){
  if(deathTest?.mode!=='FREE_BUSINESS_MODEL_DEATH_TEST'||deathTest?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_FREE_DEATH_TEST_REQUIRED');
  const candidates=deathTest.candidates.map(candidate=>{
    if(!PHYSICAL.test(candidate.topic))return {candidate_id:candidate.candidate_id,topic:candidate.topic,decision:'HOLD_INCALCULABLE',reason:'PRODUCT_LEVEL_SAAS_COMMISSION_AND_PAYOUT_REQUIRED',scenarios:[]};
    const scenarios=SCENARIOS.map(calculate);
    return {candidate_id:candidate.candidate_id,topic:candidate.topic,decision:'HOLD_UNIT_ECONOMICS_UNVERIFIED',reason:'GENERIC_STRESS_TEST_CANNOT_REPLACE_PRODUCT_LEVEL_AOV_CONVERSION_AND_ELIGIBILITY',scenarios};
  });
  return {schema_version:1,mode:'AFFILIATE_ECONOMICS_STRESS_TEST',currency:'TWD',evaluated_count:candidates.length,
    assumption_policy:'ALL_NUMBERS_ARE_EXPLICIT_STRESS_TEST_INPUTS_NOT_MARKET_FACTS',baseline_commission_source:'SHOPEE_TW_GENERAL_PROMOTER_BASE_RATE_1_PERCENT',
    paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,can_build_site:false,candidates,
    next_gate:'REPLACE_GENERIC_ASSUMPTIONS_WITH_PRODUCT_LEVEL_AOV_ELIGIBILITY_AND_MEASURED_OR_DEFENSIBLE_CONVERSION_EVIDENCE'};
}
