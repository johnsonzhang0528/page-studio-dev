const STATES=new Set(['VERIFIED','UNVERIFIED','DISPROVEN','NOT_APPLICABLE']);
const REQUIRED_EVIDENCE=['channel_eligibility','search_intent_fit','revenue_rate','traffic_requirement','operating_cost','legal_policy','dependency_resilience','worst_case_viability','kill_rule'];

function integer(value,name,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`INVALID_${name}`);
  return value;
}

export function evaluateBusinessModelCandidate(model){
  if(!model?.id||!model?.type)throw new Error('INVALID_BUSINESS_MODEL_CANDIDATE');
  const automation=integer(model.automation_ratio_bps,'AUTOMATION_RATIO_BPS',{max:10000});
  const maintenance=integer(model.ongoing_manual_hours_per_1000_visits,'ONGOING_MANUAL_HOURS');
  const evidence=model.evidence??{};
  for(const key of REQUIRED_EVIDENCE)if(!STATES.has(evidence[key]))throw new Error(`INVALID_EVIDENCE_${key}`);
  const rejectionReasons=[];
  if(model.requires_manual_product_production===true)rejectionReasons.push('MANUAL_PRODUCT_PRODUCTION_FORBIDDEN');
  if(model.requires_manual_customer_fulfillment===true)rejectionReasons.push('MANUAL_CUSTOMER_FULFILLMENT_FORBIDDEN');
  if(automation<9000)rejectionReasons.push('AUTOMATION_RATIO_BELOW_90_PERCENT');
  if(maintenance>2)rejectionReasons.push('ONGOING_MANUAL_LOAD_TOO_HIGH');
  for(const key of REQUIRED_EVIDENCE)if(evidence[key]==='DISPROVEN')rejectionReasons.push(`${key.toUpperCase()}_DISPROVEN`);
  if(rejectionReasons.length)return {...model,decision:'REJECT',rejection_reasons:rejectionReasons,blockers:[]};
  const blockers=REQUIRED_EVIDENCE.filter(key=>evidence[key]!=='VERIFIED').map(key=>`${key.toUpperCase()}_UNVERIFIED`);
  if(!Array.isArray(model.economic_scenarios)||model.economic_scenarios.length!==3)blockers.push('THREE_ECONOMIC_SCENARIOS_REQUIRED');
  return {...model,decision:blockers.length?'HOLD':'PILOT_CANDIDATE',rejection_reasons:[],blockers};
}

export function evaluateBusinessModelGate(input){
  if(!input||input.schema_version!==2||!input.niche_id)throw new Error('INVALID_BUSINESS_MODEL_INPUT');
  integer(input.pilot_cash_cap_twd,'PILOT_CASH_CAP_TWD');
  integer(input.pilot_hour_cap,'PILOT_HOUR_CAP');
  const models=(input.models??[]).map(evaluateBusinessModelCandidate);
  if(models.length===0)throw new Error('BUSINESS_MODEL_CANDIDATES_REQUIRED');
  const approved=models.filter(row=>row.decision==='PILOT_CANDIDATE');
  const held=models.filter(row=>row.decision==='HOLD');
  const decision=approved.length?'PILOT_BUSINESS_MODEL_APPROVED':held.length?'HOLD_BUSINESS_MODEL_NOT_VALIDATED':'REJECT_NICHE_NO_AUTOMATED_MODEL';
  return {schema_version:2,gate:'NICHE_BUSINESS_MODEL_DEATH_TEST',niche_id:input.niche_id,decision,
    can_register_domain:false,can_build_site:false,can_release_pilot:approved.length>0,
    approved_model_ids:approved.map(row=>row.id),models,
    rule:'AT_LEAST_ONE_NON_MANUAL_MODEL_MUST_PASS_ALL_EVIDENCE_GATES',
    caveats:['SEARCH_DEMAND_ALONE_CANNOT_APPROVE_A_NICHE','ASSUMPTIONS_ARE_NOT_REVENUE_EVIDENCE','DOMAIN_AND_SITE_REMAIN_BLOCKED_UNTIL_EXPLICIT_RELEASE']};
}
