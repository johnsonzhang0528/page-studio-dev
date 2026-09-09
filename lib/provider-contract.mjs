import crypto from 'node:crypto';

export const PROVIDER_CONTRACT_VERSION=1;
export const INVOCATION_STATES=Object.freeze(['PLANNED','ADMISSION_PENDING','RESERVED','DISPATCHED','RESULT_STAGED','VERIFIED','COMMITTED','COMPLETE','PROVIDER_THROTTLED','PROVIDER_UNAVAILABLE','QUALITY_ESCALATION_REQUIRED','BUDGET_HOLD','AUTH_REQUIRED','VERIFY_FAILED','CANCELLED_SAFE']);
export const RESULT_OUTCOMES=Object.freeze(['success','blocked','failed','cancelled','throttled','unavailable']);
const SPEC_KEYS=new Set(['schema_version','invocation_id','run_id','project','phase','unit_id','attempt','input_revision','controller_sha','policy_fingerprint','objective','context_manifest','allowed_write_scope','tool_capabilities','network_policy','timeouts','budget','output_schema','receipt_schema','risk_tier','required_quality_tier','verification_mode','provider','model','reason_code','fallback_policy','idempotency_key','parent_checkpoint']);
const REQUIRED=[...SPEC_KEYS].filter(key=>!['fallback_policy'].includes(key));
const TIMEOUT_KEYS=['connect_ms','first_token_ms','idle_ms','tool_ms','invocation_deadline_ms','work_unit_deadline_ms'];
const BUDGET_KEYS=['max_input_tokens','max_output_tokens','max_reasoning_tokens','max_tool_calls','max_api_round_trips','max_wall_ms','max_cost_microusd'];
const TOOL_CAPABILITIES=new Set(['filesystem_read','filesystem_write','shell','browser','network','external_side_effect']);
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const positiveInteger=value=>Number.isSafeInteger(value)&&value>0;
const noTraversal=value=>nonempty(value)&&!pathLike(value).some(part=>part==='..')&&!value.startsWith('/')&&!/^[A-Za-z]:[\\/]/.test(value);
const pathLike=value=>String(value).replaceAll('\\','/').split('/');
const freeze=value=>{ if(value&&typeof value==='object'){ Object.freeze(value); for(const nested of Object.values(value)) freeze(nested); } return value; };

export function validateInvocationSpec(input){
  const issues=[];
  if(!plainObject(input)) return {ok:false,issues:['INVOCATION_SPEC_OBJECT_REQUIRED']};
  for(const key of Object.keys(input)) if(!SPEC_KEYS.has(key)) issues.push(`UNKNOWN_INVOCATION_FIELD:${key}`);
  for(const key of REQUIRED) if(input[key]===undefined||input[key]===null) issues.push(`MISSING_INVOCATION_FIELD:${key}`);
  if(input.schema_version!==PROVIDER_CONTRACT_VERSION) issues.push('UNSUPPORTED_INVOCATION_SCHEMA');
  for(const key of ['invocation_id','run_id','project','phase','unit_id','controller_sha','policy_fingerprint','objective','provider','model','reason_code','idempotency_key','parent_checkpoint']) if(!nonempty(input[key])) issues.push(`INVALID_STRING:${key}`);
  if(!positiveInteger(input.attempt)) issues.push('INVALID_ATTEMPT');
  if(!Number.isSafeInteger(input.input_revision)||input.input_revision<0) issues.push('INVALID_INPUT_REVISION');
  if(!Array.isArray(input.allowed_write_scope)||input.allowed_write_scope.some(value=>!noTraversal(value))) issues.push('INVALID_WRITE_SCOPE');
  if(!plainObject(input.context_manifest)||!nonempty(input.context_manifest.sha256)) issues.push('INVALID_CONTEXT_MANIFEST');
  if(!Array.isArray(input.tool_capabilities)||new Set(input.tool_capabilities).size!==input.tool_capabilities.length||input.tool_capabilities.some(value=>!TOOL_CAPABILITIES.has(value))) issues.push('INVALID_TOOL_CAPABILITIES');
  if(!plainObject(input.output_schema)||!plainObject(input.receipt_schema)) issues.push('INVALID_OUTPUT_SCHEMA');
  if(!['low','medium','high','critical'].includes(input.risk_tier)) issues.push('INVALID_RISK_TIER');
  if(!['standard','high','critical'].includes(input.required_quality_tier)) issues.push('INVALID_QUALITY_TIER');
  if(!['read_only','isolated_write','single_writer'].includes(input.verification_mode)) issues.push('INVALID_VERIFICATION_MODE');
  if(!['deny_all','billing_gateway_only'].includes(input.network_policy)) issues.push('INVALID_NETWORK_POLICY');
  for(const [group,keys] of [['timeouts',TIMEOUT_KEYS],['budget',BUDGET_KEYS]]){
    if(!plainObject(input[group])) issues.push(`INVALID_${group.toUpperCase()}`);
    else { for(const key of Object.keys(input[group])) if(!keys.includes(key)) issues.push(`UNKNOWN_${group.toUpperCase()}_FIELD:${key}`); for(const key of keys) if(!positiveInteger(input[group][key])) issues.push(`INVALID_${group.toUpperCase()}_FIELD:${key}`); }
  }
  if(plainObject(input.timeouts)&&input.timeouts.work_unit_deadline_ms<input.timeouts.invocation_deadline_ms) issues.push('INVALID_DEADLINE_ORDER');
  if(input.verification_mode==='read_only'&&(input.allowed_write_scope?.length||input.tool_capabilities?.includes('filesystem_write')||input.tool_capabilities?.includes('external_side_effect'))) issues.push('READ_ONLY_CAPABILITY_VIOLATION');
  if(input.fallback_policy!==undefined&&(!Array.isArray(input.fallback_policy)||input.fallback_policy.some(value=>!nonempty(value))||new Set(input.fallback_policy).size!==input.fallback_policy.length)) issues.push('INVALID_FALLBACK_POLICY');
  return {ok:issues.length===0,issues};
}

export function createInvocationSpec(input){
  const result=validateInvocationSpec(input); if(!result.ok){ const error=new Error(result.issues.join(';')); error.code='INVALID_INVOCATION_SPEC'; error.issues=result.issues; throw error; }
  const spec=structuredClone(input); spec.fallback_policy??=[]; return freeze(spec);
}

export function createInvocationResult(spec,input){
  const issues=[];
  if(!RESULT_OUTCOMES.includes(input?.outcome)) issues.push('INVALID_RESULT_OUTCOME');
  if(!nonempty(input?.provider_request_id)) issues.push('MISSING_PROVIDER_REQUEST_ID');
  if(!plainObject(input?.usage)) issues.push('MISSING_USAGE');
  else for(const key of ['input_tokens','cached_input_tokens','output_tokens','reasoning_tokens']) if(!Number.isSafeInteger(input.usage[key])||input.usage[key]<0) issues.push(`INVALID_USAGE:${key}`);
  if(!nonempty(input?.finish_reason)) issues.push('INVALID_FINISH_REASON');
  if(!Number.isSafeInteger(input?.wall_ms)||input.wall_ms<0) issues.push('INVALID_WALL_TIME');
  if(issues.length){ const error=new Error(issues.join(';')); error.code='INVALID_INVOCATION_RESULT'; error.issues=issues; throw error; }
  const result={schema_version:PROVIDER_CONTRACT_VERSION,invocation_id:spec.invocation_id,idempotency_key:spec.idempotency_key,provider:spec.provider,model:spec.model,outcome:input.outcome,structured_output:input.structured_output??null,provider_request_id:input.provider_request_id,usage:structuredClone(input.usage),finish_reason:input.finish_reason,retryability:Boolean(input.retryability),error_class:input.error_class??null,artifacts:structuredClone(input.artifacts??[]),wall_ms:input.wall_ms,request_sha256:input.request_sha256??sha(spec),response_sha256:input.response_sha256??sha(input.structured_output??null)};
  return freeze(result);
}
