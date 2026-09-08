export const BILLING_EGRESS_POLICY_VERSION=1;
const fail=issues=>{const error=new Error(issues.join(';'));error.code='BILLING_EGRESS_POLICY_INVALID';error.issues=issues;throw error;};
const strings=value=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0);

export function validateBillingEgressPolicy(input){
  const issues=[];
  if(input?.schema_version!==1)issues.push('INVALID_SCHEMA_VERSION');
  if(!['disabled','active'].includes(input?.activation))issues.push('INVALID_ACTIVATION');
  if(input?.service_identity!=='page-autodev-openai-egress')issues.push('INVALID_SERVICE_IDENTITY');
  if(input?.listener?.transport!=='unix'||!/^\/run\/page-autodev\/openai-egress\.sock$/.test(input?.listener?.path??''))issues.push('INVALID_LISTENER');
  const upstream=input?.upstream;
  if(upstream?.hostname!=='api.openai.com'||upstream?.port!==443||upstream?.tls_servername!=='api.openai.com'||upstream?.minimum_tls!=='TLSv1.2')issues.push('INVALID_TLS_DESTINATION');
  if(JSON.stringify(upstream?.paths)!==JSON.stringify(['/v1/responses'])||JSON.stringify(upstream?.methods)!==JSON.stringify(['POST']))issues.push('INVALID_UPSTREAM_SCOPE');
  if(upstream?.redirects!==0||upstream?.retries!==0)issues.push('IMPLICIT_NETWORK_RETRY');
  if(input?.credential?.source!=='systemd'||input?.credential?.gateway_readable!==false||input?.credential?.worker_readable!==false)issues.push('INVALID_CREDENTIAL_BOUNDARY');
  if(!strings(input?.approved_model_snapshots))issues.push('INVALID_MODEL_ALLOWLIST');
  if(input?.activation==='disabled'&&input.approved_model_snapshots.length!==0)issues.push('DISABLED_POLICY_HAS_MODELS');
  if(input?.activation==='active'&&input.approved_model_snapshots.length===0)issues.push('ACTIVE_POLICY_REQUIRES_MODEL');
  if(issues.length)fail(issues);return Object.freeze(structuredClone(input));
}
