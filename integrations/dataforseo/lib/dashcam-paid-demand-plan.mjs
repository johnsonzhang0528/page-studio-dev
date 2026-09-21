import crypto from 'node:crypto';

const KEYWORDS=['行車記錄器推薦','行車記錄器比較','行車記錄器前後鏡頭','電子後視鏡行車記錄器','行車記錄器安裝價格'];
const SERP_KEYWORDS=['行車記錄器推薦','行車記錄器比較','電子後視鏡行車記錄器'];
const PRICING={captured_at:'2026-09-20T17:00:00Z',expires_at:'2026-09-27T17:00:00Z',timezone:'Asia/Taipei',keyword_task_microusd:12000,keyword_item_microusd:120,serp_live_page_microusd:2000};

function hash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

export function buildDashcamPaidDemandPlan(review,{now=Date.now()}={}){
  if(review?.mode!=='FREE_SERP_COMMERCIAL_REVIEW'||review?.decision!=='PROPOSE_BOUNDED_PAID_DEMAND_CHECK'||review?.paid_research_authorized!==false)throw new Error('VERIFIED_FREE_SERP_REVIEW_REQUIRED');
  if(now<Date.parse(PRICING.captured_at)||now>=Date.parse(PRICING.expires_at))throw new Error('PRICE_SNAPSHOT_NOT_CURRENT');
  const requests=[
    {id:'DASH-KW-001',capability:'keyword_overview',route:'/v3/dataforseo_labs/google/keyword_overview/live',body:{keywords:KEYWORDS,location_code:2158,language_code:'zh-TW',include_clickstream_data:false,tag:'seo-os-dashcam-demand-v1'},maximum_cost_microusd:PRICING.keyword_task_microusd+KEYWORDS.length*PRICING.keyword_item_microusd},
    ...SERP_KEYWORDS.map((keyword,index)=>({id:`DASH-SERP-00${index+1}`,capability:'serp_live_advanced',route:'/v3/serp/google/organic/live/advanced',body:{keyword,location_code:2158,language_code:'zh-TW',depth:10,device:'desktop',os:'windows',tag:`dfs-serp-calibration-${String(index+1).padStart(2,'0')}`},maximum_cost_microusd:PRICING.serp_live_page_microusd}))
  ];
  const maximumCost=requests.reduce((sum,row)=>sum+row.maximum_cost_microusd,0);
  const bound={schema_version:1,market:'Taiwan',language:'zh-TW',candidate_id:review.candidate_id,requests,pricing:PRICING,maximum_cost_microusd:maximumCost};
  return {...bound,mode:'PAID_DEMAND_REQUEST_PLAN',plan_sha256:hash(bound),request_count:requests.length,keyword_count:KEYWORDS.length,serp_task_count:SERP_KEYWORDS.length,
    maximum_cost_usd:maximumCost/1_000_000,dispatch_authorized:false,approval_required:true,automatic_retry:false,maximum_attempts_per_request:1,
    no_expansion:true,no_optional_paid_parameters:true,can_build_site:false,automatic_enter:false,
    acceptance:['ALL_FIVE_KEYWORDS_RETURN_EXPLICIT_VOLUME_OR_EXPLICIT_PROVIDER_OMISSION','THREE_SERPS_RETURN_TEN_RESULT_DEPTH_ONLY','PROVIDER_COST_DOES_NOT_EXCEED_BOUND'],
    next_gate:'EXPLICIT_OPERATOR_APPROVAL_BOUND_TO_PLAN_SHA256_AND_MAXIMUM_COST'};
}
