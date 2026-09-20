const QUERIES=[
  {query:'行車記錄器 比較 台灣',commercial_intent:true,observed_types:['INDEPENDENT_EDITORIAL','COMPARISON_CONTENT']},
  {query:'行車記錄器 推薦 2026 台灣',commercial_intent:true,observed_types:['AFFILIATE_EDITORIAL','INDEPENDENT_EDITORIAL','BRAND_EDITORIAL']},
  {query:'行車記錄器 選購 前後鏡頭 GPS',commercial_intent:true,observed_types:['BUYING_GUIDE','BRAND_EDITORIAL']},
  {query:'行車記錄器 價格 評測 台灣',commercial_intent:true,observed_types:['COMPARISON_CONTENT','PRODUCT_PAGE']}
];

const EVIDENCE=[
  {domain:'tw.my-best.com',type:'AFFILIATE_EDITORIAL',signal:'EXPERT_SUPERVISED_RANKING'},
  {domain:'vocus.cc',type:'INDEPENDENT_EDITORIAL',signal:'MULTIPLE_RECENT_COMPARISONS'},
  {domain:'faqs.tw',type:'INDEPENDENT_EDITORIAL',signal:'BUYING_GUIDE_VISIBLE'},
  {domain:'twneed.org',type:'INDEPENDENT_EDITORIAL',signal:'PRICE_AND_INSTALLATION_GUIDE_VISIBLE'},
  {domain:'toprankland.com',type:'INDEPENDENT_EDITORIAL',signal:'RECENT_RANKING_VISIBLE'},
  {domain:'carscam.com.tw',type:'BRAND_EDITORIAL',signal:'BRAND_BUYING_GUIDE_VISIBLE'},
  {domain:'store.px.com.tw',type:'BRAND_COMMERCE',signal:'DIRECT_PRODUCT_RESULTS_VISIBLE'}
];

export function buildDashcamFreeSerpReview(sample){
  if(sample?.mode!=='DASHCAM_AFFILIATE_SAMPLE'||sample?.paid_api_spend_microusd!==0)throw new Error('VERIFIED_DASHCAM_SAMPLE_REQUIRED');
  const independentCount=EVIDENCE.filter(row=>row.type==='INDEPENDENT_EDITORIAL').length;
  return {schema_version:1,mode:'FREE_SERP_COMMERCIAL_REVIEW',candidate_id:sample.candidate_id,topic:sample.topic,market:'Taiwan',language:'zh-TW',observed_on:'2026-09-21',
    evidence_scope:'FREE_WEB_DISCOVERY_NOT_CANONICAL_GOOGLE_RANK_TRACKING',queries:QUERIES,evidence:EVIDENCE,
    commercial_intent_queries:QUERIES.filter(row=>row.commercial_intent).length,query_count:QUERIES.length,independent_editorial_domains:independentCount,
    findings:['COMMERCIAL_INTENT_VISIBLE','INDEPENDENT_PUBLISHERS_VISIBLE','CURRENT_YEAR_FRESHNESS_EXPECTED','EXPERT_OR_HANDS_ON_EVIDENCE_COMMON','BRAND_PUBLISHERS_PRESENT'],
    blockers:['SEARCH_VOLUME_UNVERIFIED','CANONICAL_TAIWAN_SERP_DEPTH_UNVERIFIED','MEASURED_AFFILIATE_CTR_UNVERIFIED','HANDS_ON_EVIDENCE_CAPABILITY_UNVERIFIED','REFRESH_WORKLOAD_UNVERIFIED'],
    decision:'PROPOSE_BOUNDED_PAID_DEMAND_CHECK',can_request_paid_research_approval:true,paid_research_authorized:false,automatic_enter:false,can_build_site:false,paid_api_spend_microusd:0,
    proposed_paid_check:{provider:'dataforseo',purpose:'EXACT_TAIWAN_ZHTW_DEMAND_AND_BOUNDED_SERP_VALIDATION',maximum_queries:5,maximum_serp_tasks:3,approval_required:true},
    next_gate:'EXPLICIT_OPERATOR_APPROVAL_FOR_EXACT_COSTED_REQUEST_PLAN'};
}
