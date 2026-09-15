import crypto from 'node:crypto';
import {validateKeywordIdeasExpansionRequest,requestFingerprint} from './dataforseo-contract.mjs';
import {estimateKeywordIdeasExpansionMicrousd,validateProviderRegistry} from './provider-registry.mjs';

const plainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalize=value=>value.trim().normalize('NFKC');

export function buildCandidateExpansionPlan({shadow,seeds,registry,source_shadow_sha256,now=Date.now(),target_per_seed=10,per_seed_limit=20,offset=20}={}){
  if(!plainObject(shadow)||shadow.mode!=='offline_quality_shadow'||shadow.network_dispatch!==false)throw new Error('SHADOW_ARTIFACT_INVALID');
  if(!/^[a-f0-9]{64}$/.test(source_shadow_sha256??''))throw new Error('SOURCE_SHA256_INVALID');
  if(!Array.isArray(seeds)||seeds.length<1||seeds.length>6||seeds.some(seed=>typeof seed!=='string'||!seed.trim()))throw new Error('SEEDS_INVALID');
  const normalized=seeds.map(normalize);
  if(new Set(normalized.map(seed=>seed.toLocaleLowerCase('zh-TW'))).size!==normalized.length)throw new Error('SEEDS_DUPLICATE');
  if(target_per_seed!==10||per_seed_limit!==20||offset!==20)throw new Error('EXPANSION_BOUNDS_IMMUTABLE');
  const registryValidation=validateProviderRegistry(registry,{now,expected_activation:'disabled'});
  if(!registryValidation.ok)throw new Error(`REGISTRY_NOT_SAFE:${registryValidation.errors.join(',')}`);
  const perSeed=shadow.quality?.per_seed;
  if(!plainObject(perSeed)||Object.keys(perSeed).some(seed=>!normalized.includes(seed)))throw new Error('SHADOW_SEEDS_INVALID');
  const deficits=[];
  normalized.forEach((seed,ordinal)=>{
    const selected=perSeed?.[seed]?.selected;
    if(!Number.isSafeInteger(selected)||selected<0||selected>target_per_seed)throw new Error(`SELECTED_COUNT_INVALID:${seed}`);
    if(selected<target_per_seed)deficits.push({seed,ordinal,selected,deficit:target_per_seed-selected});
  });
  const requests=deficits.map(({seed,ordinal})=>({keywords:[seed],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:per_seed_limit,offset,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:`page-autodev-ideas-expand-seed-${ordinal+1}`}));
  requests.forEach((request,index)=>{
    const validation=validateKeywordIdeasExpansionRequest(request);
    if(!validation.ok)throw new Error(`REQUEST_${index}_INVALID:${validation.errors.join(',')}`);
  });
  const maxMicrousd=estimateKeywordIdeasExpansionMicrousd(registry,requests,{max_tasks:6});
  const identity={schema_version:1,source_shadow_sha256,target_per_seed,per_seed_limit,offset,deficits,requests,max_microusd:maxMicrousd};
  return {
    ...identity,
    mode:'proposal_only',
    decision:requests.length?'AWAITING_OPERATOR_APPROVAL':'NO_EXPANSION_REQUIRED',
    network_dispatch:false,
    paid_service_activation:false,
    requires_operator_approval:requests.length>0,
    task_count:requests.length,
    total_deficit:deficits.reduce((sum,item)=>sum+item.deficit,0),
    requested_candidates:requests.length*per_seed_limit,
    max_usd:Number((maxMicrousd/1_000_000).toFixed(6)),
    yield_guaranteed:false,
    post_fetch_gate:'PERMANENT_KEYWORD_QUALITY_POLICY',
    request_batch_sha256:requestFingerprint(requests),
    plan_sha256:requestFingerprint(identity)
  };
}
