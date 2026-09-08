export const BILLING_GATEWAY_POLICY_VERSION=1;

const fail=issues=>{const error=new Error(issues.join(';'));error.code='BILLING_GATEWAY_POLICY_INVALID';error.issues=issues;throw error;};
const exactStrings=(value,expected)=>Array.isArray(value)&&value.length===expected.length&&value.every((item,index)=>item===expected[index]);

export function validateBillingGatewayPolicy(input,{now_ms=Date.now()}={}){
  const issues=[];
  if(input?.schema_version!==BILLING_GATEWAY_POLICY_VERSION)issues.push('INVALID_SCHEMA_VERSION');
  if(input?.service_identity!=='page-autodev-billing-gateway')issues.push('INVALID_SERVICE_IDENTITY');
  if(!['workload_identity','expiring_service_account_key'].includes(input?.credential?.mode))issues.push('INVALID_CREDENTIAL_MODE');
  if(!Number.isSafeInteger(input?.credential?.expires_at_ms)||input.credential.expires_at_ms<=now_ms||input.credential.expires_at_ms-now_ms>900000)issues.push('INVALID_CREDENTIAL_EXPIRY');
  if(input?.credential?.worker_readable!==false)issues.push('WORKER_CREDENTIAL_ACCESS');
  if(input?.upstream?.origin!=='https://api.openai.com')issues.push('INVALID_UPSTREAM_ORIGIN');
  if(!exactStrings(input?.upstream?.paths,['/v1/responses']))issues.push('INVALID_UPSTREAM_PATHS');
  if(!exactStrings(input?.upstream?.methods,['POST']))issues.push('INVALID_UPSTREAM_METHODS');
  if(input?.upstream?.allow_redirects!==false)issues.push('REDIRECTS_MUST_BE_DISABLED');
  if(input?.upstream?.retries!==0)issues.push('RETRIES_MUST_BE_DISABLED');
  if(input?.upstream?.fallback!==false)issues.push('FALLBACK_MUST_BE_DISABLED');
  if(input?.admin_plane?.enabled!==false)issues.push('ADMIN_PLANE_MUST_BE_DISABLED');
  if(input?.listener?.transport!=='unix'||!/^\/run\/user\/[0-9]+\/page-autodev-billing-gateway\.sock$/.test(input?.listener?.path??''))issues.push('INVALID_LISTENER');
  if(issues.length)fail(issues);
  return Object.freeze(structuredClone(input));
}
