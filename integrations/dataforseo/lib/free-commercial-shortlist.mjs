const STRONG=/(比較|選購|評測)/u;
const MEDIUM=/(推薦)/u;
const PHYSICAL=/(用品|家具|器材|配件|裝備|家電|玩具|模具|背包|行車記錄器|貓砂)/u;
const HIGH_FRESHNESS=/(住宿|餐廳|露營地|景點|行程)/u;

function assess(candidate){
  const topic=candidate.topic;
  let score=0;
  const evidence=[];
  if(STRONG.test(topic)){score+=4;evidence.push('EXPLICIT_COMPARISON_OR_PURCHASE_INTENT');}
  else if(MEDIUM.test(topic)){score+=3;evidence.push('EXPLICIT_RECOMMENDATION_INTENT');}
  if(PHYSICAL.test(topic)){score+=2;evidence.push('TAIWAN_MARKETPLACE_AFFILIATE_CHANNEL_EXISTS');}
  if(candidate.category==='digital'){score+=1;evidence.push('SAAS_AFFILIATE_FAMILY_REQUIRES_PRODUCT_LEVEL_VERIFICATION');}
  if(candidate.category==='small_business'){score+=1;evidence.push('B2B_SOFTWARE_INTENT_REQUIRES_PRODUCT_LEVEL_VERIFICATION');}
  if(HIGH_FRESHNESS.test(topic)){score-=4;evidence.push('HIGH_FRESHNESS_AND_MANUAL_VERIFICATION_BURDEN');}
  const hasTool=candidate.monetization_prefilter.hypotheses.some(row=>row.id==='automated-tool');
  if(hasTool){score-=2;evidence.push('OWN_TOOL_BUILD_IS_NOT_ASSUMED_AS_PASSIVE_MONETIZATION');}
  return {...candidate,free_commercial_assessment:{score,evidence,decision:'DEATH_TEST_REQUIRED',business_model_approved:false,paid_research_authorized:false}};
}

export function buildFreeCommercialShortlist(source,{limit=12}={}){
  if(source?.mode!=='FREE_MONETIZATION_PREFILTER'||source?.paid_research_authorized!==false)throw new Error('VERIFIED_FREE_PREFILTER_REQUIRED');
  if(!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_SHORTLIST_LIMIT');
  const eligible=source.candidates.filter(row=>row.monetization_prefilter.decision==='ADVANCE_FREE_COMMERCIAL_VALIDATION').map(assess);
  const shortlisted=eligible.filter(row=>row.free_commercial_assessment.score>=3).sort((a,b)=>b.free_commercial_assessment.score-a.free_commercial_assessment.score||a.candidate_id.localeCompare(b.candidate_id)).slice(0,limit);
  return {schema_version:1,mode:'FREE_COMMERCIAL_EVIDENCE_SHORTLIST',source_candidate_count:source.candidate_count,eligible_count:eligible.length,shortlist_count:shortlisted.length,
    paid_api_spend_microusd:0,paid_research_authorized:false,automatic_enter:false,business_model_approved:false,
    candidates:shortlisted,evidence_registry:[
      {id:'SHOPEE_TW_AFFILIATE',status:'CHANNEL_EXISTS_APPROVAL_REQUIRED',baseline_commission_note:'GENERAL_PROMOTER_BASE_RATE_REPORTED_AS_1_PERCENT',url:'https://help.shopee.tw/portal/10/article/123888'},
      {id:'AGODA_AFFILIATE',status:'CHANNEL_EXISTS_TERMS_AND_APPROVAL_REQUIRED',url:'https://partners.agoda.com/'},
      {id:'PARTNERSTACK_NETWORK',status:'NETWORK_ONLY_INDIVIDUAL_PROGRAM_UNVERIFIED',url:'https://partnerstack.com/partners-and-publishers'}
    ],next_gate:'CANDIDATE_LEVEL_BUSINESS_MODEL_DEATH_TEST_USING_REAL_PROGRAM_TERMS_AND_UNIT_ECONOMICS'};
}
