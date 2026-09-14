import crypto from 'node:crypto';
import {buildSeedDiscoveryPlan} from './query-candidate-builder.mjs';
import {validateBalancedKeywordIdeasBatch} from './dataforseo-contract.mjs';
import {estimateBalancedKeywordIdeasMicrousd} from './provider-registry.mjs';

export function buildBalancedCalibrationApprovalPlan({seeds,registry,now=Date.now()}={}){
  const tasks=buildSeedDiscoveryPlan(seeds,{per_seed_limit:20}),requests=tasks.map(item=>item.request),validation=validateBalancedKeywordIdeasBatch(requests);
  if(!validation.ok)throw new Error(`BALANCED_CONTRACT:${validation.errors.join(',')}`);
  const max_microusd=estimateBalancedKeywordIdeasMicrousd(registry,requests),request_plan_sha256=crypto.createHash('sha256').update(JSON.stringify(requests)).digest('hex');
  return {schema_version:2,mode:'plan_only',network_dispatch:false,paid_service_activation:false,seed_count:seeds.length,per_seed_limit:20,raw_candidate_limit:seeds.length*20,balanced_output_limit:60,request_plan_sha256,max_microusd,max_usd:max_microusd/1_000_000,approval_template:{schema_version:2,approval_id:'calibration-<16 lowercase hex>',expires_at:new Date(now+10*60*1000).toISOString(),request_plan_sha256,seed_count:seeds.length,per_seed_limit:20,max_microusd}};
}
