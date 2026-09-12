import crypto from 'node:crypto';

export const CONTRACT_VERSION = 1;
export const DEFAULT_LIMITS = Object.freeze({
  max_keywords: 60,
  max_tasks: 1,
  max_serp_depth: 10,
  max_estimated_microusd: 20_000
});

const forbiddenKeys = new Set([
  'priority',
  'calculate_rectangles',
  'load_async_ai_overview',
  'people_also_ask_click_depth',
  'search_param',
  'depth'
]);

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
};

export function requestFingerprint(request) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex');
}

export function validateKeywordOverviewRequest(request, options = {}) {
  const limits = {...DEFAULT_LIMITS, ...(options.limits ?? {})};
  const errors = [];
  if (!plainObject(request)) return {ok:false, errors:['REQUEST_NOT_OBJECT']};
  const allowed = new Set(['keywords','location_code','language_code','include_clickstream_data','tag']);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) errors.push(`UNKNOWN_FIELD:${key}`);
    if (forbiddenKeys.has(key)) errors.push(`PAID_OR_UNSAFE_FIELD:${key}`);
  }
  if (!Array.isArray(request.keywords) || request.keywords.length < 1) errors.push('KEYWORDS_REQUIRED');
  else {
    if (request.keywords.length > limits.max_keywords) errors.push('KEYWORD_LIMIT_EXCEEDED');
    if (request.keywords.some(value => typeof value !== 'string' || !value.trim())) errors.push('INVALID_KEYWORD');
    if (new Set(request.keywords.map(value => value.trim().normalize('NFKC').toLocaleLowerCase())).size !== request.keywords.length) errors.push('DUPLICATE_KEYWORD');
  }
  if (!Number.isSafeInteger(request.location_code) || request.location_code <= 0) errors.push('LOCATION_REQUIRED');
  if (typeof request.language_code !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(request.language_code)) errors.push('LANGUAGE_REQUIRED');
  if (request.include_clickstream_data !== undefined && request.include_clickstream_data !== false) errors.push('CLICKSTREAM_DISABLED');
  if (request.tag !== undefined && (typeof request.tag !== 'string' || request.tag.length > 255)) errors.push('INVALID_TAG');
  return {ok:errors.length === 0, errors, fingerprint:errors.length ? null : requestFingerprint(request)};
}

export function validateKeywordIdeasRequest(request) {
  const errors=[];
  if(!plainObject(request))return {ok:false,errors:['REQUEST_NOT_OBJECT']};
  const allowed=new Set(['keywords','location_code','language_code','closely_variants','ignore_synonyms','include_serp_info','include_clickstream_data','limit','filters','order_by','tag']);
  for(const key of Object.keys(request))if(!allowed.has(key)||forbiddenKeys.has(key))errors.push(`UNKNOWN_OR_UNSAFE_FIELD:${key}`);
  if(!Array.isArray(request.keywords)||request.keywords.length<1||request.keywords.length>6||request.keywords.some(value=>typeof value!=='string'||value.trim().length<2))errors.push('SEED_KEYWORDS_INVALID');
  if(request.location_code!==2158||request.language_code!=='zh-TW')errors.push('MARKET_INVALID');
  if(request.closely_variants!==false||request.ignore_synonyms!==false||request.include_serp_info!==false||request.include_clickstream_data!==false)errors.push('PAID_OR_EXPANSIVE_OPTION');
  if(request.limit!==60)errors.push('LIMIT_INVALID');
  if(JSON.stringify(request.filters)!==JSON.stringify([['keyword_info.search_volume','>',0]]))errors.push('FILTER_INVALID');
  if(JSON.stringify(request.order_by)!==JSON.stringify(['relevance,desc']))errors.push('ORDER_INVALID');
  if(typeof request.tag!=='string'||!/^page-autodev-ideas-[a-z0-9-]+$/.test(request.tag))errors.push('TAG_INVALID');
  return {ok:errors.length===0,errors,fingerprint:errors.length?null:requestFingerprint(request)};
}

export function authorizeEstimatedCost(estimatedMicrousd, options = {}) {
  const limits = {...DEFAULT_LIMITS, ...(options.limits ?? {})};
  if (!Number.isSafeInteger(estimatedMicrousd) || estimatedMicrousd < 0) return {ok:false, reason:'INVALID_ESTIMATE'};
  if (estimatedMicrousd > limits.max_estimated_microusd) return {ok:false, reason:'REQUEST_BUDGET_EXCEEDED'};
  return {ok:true, reserved_microusd:estimatedMicrousd};
}
