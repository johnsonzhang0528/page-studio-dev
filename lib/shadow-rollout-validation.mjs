import crypto from 'node:crypto';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fail=(message,code='SHADOW_VALIDATION_INVALID')=>Object.assign(new Error(message),{code});

export const DEFAULT_SHADOW_POLICY=Object.freeze({
  required_cases:['targeted_low_risk_pass','provider_rejection','timeout','malformed_response','budget_denial'],
  minimum_samples:5,
  max_failure_rate:0.4,
  max_p95_wall_ms:120000,
  max_total_cost_microusd:0
});

export function evaluateShadowValidation(records,{policy=DEFAULT_SHADOW_POLICY,controller_sha=null,at=null}={}){
  if(!Array.isArray(records)||!records.length)throw fail('SHADOW_RECORDS_REQUIRED');
  const required=[...new Set(policy.required_cases??[])];
  if(!required.length||!Number.isSafeInteger(policy.minimum_samples)||policy.minimum_samples<required.length)throw fail('SHADOW_POLICY_INVALID');
  const ids=new Set(),issues=[];
  for(const [index,record] of records.entries()){
    if(!record||typeof record.case_id!=='string'||!record.case_id)throw fail(`SHADOW_CASE_ID_REQUIRED:${index}`);
    if(ids.has(record.case_id))throw fail(`SHADOW_DUPLICATE_CASE:${record.case_id}`); ids.add(record.case_id);
    if(record.transport!=='fake_provider'||record.network_calls!==0)issues.push(`LIVE_NETWORK_FORBIDDEN:${record.case_id}`);
    if(!['pass','expected_failure'].includes(record.outcome))issues.push(`UNEXPECTED_OUTCOME:${record.case_id}`);
    if(!Number.isSafeInteger(record.actual_cost_microusd)||record.actual_cost_microusd<0)throw fail(`SHADOW_COST_INVALID:${record.case_id}`);
    if(!Number.isFinite(record.wall_ms)||record.wall_ms<0)throw fail(`SHADOW_WALL_INVALID:${record.case_id}`);
    if(record.rollback?.stop_required===true)issues.push(`ROLLBACK_SIGNAL:${record.case_id}`);
    if(record.baseline_quality_pass===true&&record.candidate_quality_pass!==true)issues.push(`QUALITY_REGRESSION:${record.case_id}`);
  }
  for(const caseId of required)if(!ids.has(caseId))issues.push(`REQUIRED_CASE_MISSING:${caseId}`);
  if(records.length<policy.minimum_samples)issues.push('INSUFFICIENT_SAMPLES');
  const failures=records.filter(item=>item.outcome!=='pass').length,failureRate=failures/records.length;
  const totalCost=records.reduce((sum,item)=>sum+item.actual_cost_microusd,0);
  const walls=records.map(item=>item.wall_ms).sort((a,b)=>a-b),p95=walls[Math.max(0,Math.ceil(walls.length*0.95)-1)];
  if(failureRate>policy.max_failure_rate)issues.push('FAILURE_RATE_EXCEEDED');
  if(p95>policy.max_p95_wall_ms)issues.push('P95_WALL_EXCEEDED');
  if(totalCost>policy.max_total_cost_microusd)issues.push('SHADOW_COST_EXCEEDED');
  const decision={schema_version:1,kind:'offline_shadow_validation',controller_sha,policy:stable(policy),sample_count:records.length,failure_count:failures,failure_rate:failureRate,p95_wall_ms:p95,total_cost_microusd:totalCost,case_ids:[...ids].sort(),issues:[...new Set(issues)].sort(),network_calls:records.reduce((sum,item)=>sum+item.network_calls,0)};
  return {ok:decision.issues.length===0,promotion_eligible:decision.issues.length===0,dispatch_allowed:false,write_allowed:false,receipt:{...decision,decision_sha256:digest(decision),...(at?{evaluated_at:at}:{})}};
}
