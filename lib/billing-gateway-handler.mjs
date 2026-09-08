import crypto from 'node:crypto';
import { validateBillingGatewayPolicy } from './billing-gateway-policy.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const denied=(message,code='BILLING_GATEWAY_REQUEST_DENIED')=>Object.assign(new Error(message),{code});
const allowedKeys=new Set(['credential','spec','spend_lease_id']);

export function createBillingGatewayHandler({policy,credentialAuthority,adapter,clock=()=>Date.now(),max_body_bytes=262144}={}){
  validateBillingGatewayPolicy(policy,{now_ms:clock()});
  if(!credentialAuthority||typeof credentialAuthority.consume!=='function'||!adapter||typeof adapter.invoke!=='function')throw denied('BILLING_GATEWAY_HANDLER_CONFIG_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
  return async function handle(request={}){
    if(request.method!=='POST'||request.path!=='/v1/dispatch'||request.content_type!=='application/json')throw denied('BILLING_GATEWAY_ROUTE_DENIED');
    if(!Buffer.isBuffer(request.body)||request.body.length===0||request.body.length>max_body_bytes)throw denied('BILLING_GATEWAY_BODY_DENIED');
    let input;try{input=JSON.parse(request.body.toString('utf8'));}catch{throw denied('BILLING_GATEWAY_JSON_INVALID');}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowedKeys.has(key)))throw denied('BILLING_GATEWAY_FIELDS_DENIED');
    if(!input.spec||typeof input.spend_lease_id!=='string'||!input.spend_lease_id)throw denied('BILLING_GATEWAY_SCOPE_REQUIRED');
    const request_sha256=digest(input.spec);
    credentialAuthority.consume(input.credential,{invocation_id:input.spec.invocation_id,lease_id:input.spend_lease_id,request_sha256});
    return adapter.invoke(input.spec,{spend_lease_id:input.spend_lease_id,signal:request.signal});
  };
}

export const billingGatewayRequestDigest=digest;
