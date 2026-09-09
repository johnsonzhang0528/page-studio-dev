import crypto from 'node:crypto';
import { validateBillingEgressPolicy } from './billing-egress-policy.mjs';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const denied=message=>Object.assign(new Error(message),{code:'BILLING_EGRESS_DENIED'});
const envelopeKeys=new Set(['gateway_assertion','request_id','method','path','model_snapshot','body','body_sha256']);

export function createBillingEgressHandler({policy,verifyGatewayAssertion,dispatchTls}={}){
  const resolved=validateBillingEgressPolicy(policy);
  if(typeof verifyGatewayAssertion!=='function'||typeof dispatchTls!=='function')throw Object.assign(new Error('BILLING_EGRESS_CONFIG_INVALID'),{code:'BILLING_EGRESS_CONFIG_INVALID'});
  return async function handle(input={}){
    if(resolved.activation!=='active')throw denied('BILLING_EGRESS_DISABLED');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!envelopeKeys.has(key)))throw denied('BILLING_EGRESS_ENVELOPE_INVALID');
    if(input.method!=='POST'||input.path!=='/v1/responses'||!resolved.approved_model_snapshots.includes(input.model_snapshot))throw denied('BILLING_EGRESS_SCOPE_INVALID');
    if(typeof input.request_id!=='string'||!/^[\x21-\x7E]{1,512}$/.test(input.request_id)||!Buffer.isBuffer(input.body)||input.body.length===0||input.body.length>262144||digest(input.body)!==input.body_sha256)throw denied('BILLING_EGRESS_REQUEST_INVALID');
    const verification=await verifyGatewayAssertion(input.gateway_assertion,{request_id:input.request_id,body_sha256:input.body_sha256,model_snapshot:input.model_snapshot});
    if(verification?.ok!==true)throw denied('BILLING_EGRESS_ASSERTION_INVALID');
    return dispatchTls({hostname:resolved.upstream.hostname,port:resolved.upstream.port,servername:resolved.upstream.tls_servername,minimum_tls:resolved.upstream.minimum_tls,method:'POST',path:'/v1/responses',redirects:0,retries:0,body:input.body,request_id:input.request_id});
  };
}
