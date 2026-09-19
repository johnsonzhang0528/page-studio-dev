const COMMERCIAL=/(比較|推薦|用品|工具|家具|器材|配件|裝備|家電|玩具|選購|住宿|餐廳|軟體|模具)/u;
const TOOL=/(工具|管理|流程|自動化|壓縮|排程|記帳|報價|發票|出貨|表單)/u;
const ADS_ONLY=/(教學|自學|學習|技巧|食譜|料理|方法|攻略|路線|行程|景點|練習|入門|規劃)/u;

export function classifyMonetizationHypotheses(candidate){
  if(!candidate?.candidate_id||!candidate?.topic||!candidate?.category)throw new Error('INVALID_NICHE_CANDIDATE');
  const hypotheses=[{id:'display-ads',status:'HYPOTHESIS_ONLY',manual_product:false}];
  if(COMMERCIAL.test(candidate.topic))hypotheses.push({id:'affiliate-commerce',status:'REQUIRES_FREE_CHANNEL_AND_INTENT_VALIDATION',manual_product:false});
  if((candidate.category==='small_business'||candidate.category==='digital')&&TOOL.test(candidate.topic))hypotheses.push({id:'automated-tool',status:'REQUIRES_DEVELOPMENT_AND_ECONOMICS_VALIDATION',manual_product:false});
  const independent=hypotheses.filter(row=>row.id!=='display-ads').length;
  const decision=independent>0?'ADVANCE_FREE_COMMERCIAL_VALIDATION':'ADS_ONLY_HOLD';
  return {...candidate,monetization_prefilter:{decision,hypotheses,
    reason:decision==='ADS_ONLY_HOLD'?(ADS_ONLY.test(candidate.topic)?'INFORMATIONAL_TOPIC_WITH_NO_NON_AD_MODEL_YET':'NO_TESTABLE_NON_AD_MODEL_YET'):'AT_LEAST_ONE_NON_AD_HYPOTHESIS_EXISTS',
    paid_research_authorized:false,automatic_enter:false}};
}

export function buildNicheMonetizationPrefilter(source){
  if(source?.schema_version!==1||source?.candidate_count!==100||source?.candidates?.length!==100)throw new Error('EXACT_100_CANDIDATES_REQUIRED');
  const candidates=source.candidates.map(classifyMonetizationHypotheses);
  return {schema_version:1,mode:'FREE_MONETIZATION_PREFILTER',source_mode:source.mode,candidate_count:candidates.length,
    advance_count:candidates.filter(row=>row.monetization_prefilter.decision==='ADVANCE_FREE_COMMERCIAL_VALIDATION').length,
    hold_count:candidates.filter(row=>row.monetization_prefilter.decision==='ADS_ONLY_HOLD').length,
    paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,candidates,
    next_gate:'FREE_CHANNEL_INTENT_AND_UNIT_ECONOMICS_EVIDENCE_THEN_BUSINESS_MODEL_DEATH_TEST'};
}
