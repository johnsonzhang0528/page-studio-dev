import crypto from 'node:crypto';

export const BILLING_GATEWAY_CREDENTIAL_VERSION=1;
const audience='page-autodev-billing-gateway';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const decode=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
const error=(message,code='BILLING_GATEWAY_CREDENTIAL_DENIED')=>Object.assign(new Error(message),{code});

export function createBillingGatewayCredentialAuthority({secret,clock=()=>Date.now(),max_ttl_ms=900000,controller_credential_policy={accepted_generations:['current'],revoked_before_ms:0,max_ttl_ms:2592000000}}={}){
  const key=Buffer.isBuffer(secret)?secret:Buffer.from(secret??'');
  if(key.length<32)throw error('BILLING_GATEWAY_CREDENTIAL_SECRET_WEAK','BILLING_GATEWAY_CONFIG_INVALID');
  if(!Number.isSafeInteger(max_ttl_ms)||max_ttl_ms<1000||max_ttl_ms>900000)throw error('BILLING_GATEWAY_CREDENTIAL_TTL_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
  const consumed=new Set();
  const acceptedGenerations=new Set(controller_credential_policy.accepted_generations??[]),controllerMaxTtl=Number(controller_credential_policy.max_ttl_ms),revokedBefore=Number(controller_credential_policy.revoked_before_ms??0);
  if(!acceptedGenerations.size||[...acceptedGenerations].some(value=>typeof value!=='string'||!value)||!Number.isSafeInteger(controllerMaxTtl)||controllerMaxTtl<60000||controllerMaxTtl>2592000000||!Number.isSafeInteger(revokedBefore)||revokedBefore<0)throw error('BILLING_CONTROLLER_CREDENTIAL_POLICY_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
  const sign=input=>crypto.createHmac('sha256',key).update(input).digest('base64url');
  const mint=(purpose,claims,ttl_ms)=>{const now=clock(),payload={v:1,aud:audience,sub:'page-autodev-controller',purpose,iat_ms:now,exp_ms:now+ttl_ms,jti:crypto.randomUUID(),...claims};const body=encode(payload);return `${body}.${sign(body)}`;};
  const verify=(token,purpose,scope)=>{
    if(typeof token!=='string'||token.length>4096)throw error('BILLING_GATEWAY_CREDENTIAL_FORMAT_INVALID');
    const [body,signature,...extra]=token.split('.');if(!body||!signature||extra.length)throw error('BILLING_GATEWAY_CREDENTIAL_FORMAT_INVALID');
    const expected=sign(body),provided=Buffer.from(signature);if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,Buffer.from(expected)))throw error('BILLING_GATEWAY_CREDENTIAL_SIGNATURE_INVALID');
    let payload;try{payload=decode(body);}catch{throw error('BILLING_GATEWAY_CREDENTIAL_PAYLOAD_INVALID');}
    const now=clock(),common=payload?.v===1&&payload.aud===audience&&payload.sub==='page-autodev-controller'&&payload.purpose===purpose&&Number.isSafeInteger(payload.iat_ms)&&Number.isSafeInteger(payload.exp_ms)&&payload.exp_ms>now&&payload.iat_ms<=now&&payload.exp_ms-payload.iat_ms<=max_ttl_ms&&typeof payload.jti==='string';
    if(!common||Object.entries(scope).some(([name,value])=>payload[name]!==value))throw error('BILLING_GATEWAY_CREDENTIAL_SCOPE_INVALID');
    if(consumed.has(payload.jti))throw error('BILLING_GATEWAY_CREDENTIAL_REPLAY');consumed.add(payload.jti);return Object.freeze(payload);
  };
  const verifyController=(token,{controller_id='page-autodev-controller'}={})=>{
    if(typeof token!=='string'||token.length>4096)throw error('BILLING_CONTROLLER_CREDENTIAL_FORMAT_INVALID');const [body,signature,...extra]=token.split('.');if(!body||!signature||extra.length)throw error('BILLING_CONTROLLER_CREDENTIAL_FORMAT_INVALID');
    const expected=sign(body),provided=Buffer.from(signature);if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,Buffer.from(expected)))throw error('BILLING_CONTROLLER_CREDENTIAL_SIGNATURE_INVALID');let payload;try{payload=decode(body);}catch{throw error('BILLING_CONTROLLER_CREDENTIAL_PAYLOAD_INVALID');}
    const now=clock(),valid=payload?.v===1&&payload.aud===audience&&payload.sub===controller_id&&payload.purpose==='reservation_bootstrap'&&acceptedGenerations.has(payload.generation)&&Number.isSafeInteger(payload.iat_ms)&&Number.isSafeInteger(payload.exp_ms)&&payload.iat_ms>=revokedBefore&&payload.iat_ms<=now&&payload.exp_ms>now&&payload.exp_ms-payload.iat_ms<=controllerMaxTtl;
    if(!valid)throw error('BILLING_CONTROLLER_CREDENTIAL_SCOPE_INVALID');return Object.freeze(payload);
  };
  return Object.freeze({
    issue({invocation_id,lease_id,request_sha256,ttl_ms=60000}={}){
      if(!invocation_id||!lease_id||!/^[a-f0-9]{64}$/i.test(request_sha256??'')||!Number.isSafeInteger(ttl_ms)||ttl_ms<1000||ttl_ms>max_ttl_ms)throw error('BILLING_GATEWAY_CREDENTIAL_CLAIMS_INVALID');
      return mint('dispatch',{invocation_id,lease_id,request_sha256:request_sha256.toLowerCase()},ttl_ms);
    },
    consume(token,{invocation_id,lease_id,request_sha256}={}){
      return verify(token,'dispatch',{invocation_id,lease_id,request_sha256:String(request_sha256??'').toLowerCase()});
    },
    issueReservation({invocation_id,request_sha256,work_unit_budget_id,priority='P2',canary_wave='default',ttl_ms=60000}={}){
      if(!invocation_id||!/^[a-f0-9]{64}$/i.test(request_sha256??'')||!work_unit_budget_id||!['P0','P1','P2','P3'].includes(priority)||!canary_wave||!Number.isSafeInteger(ttl_ms)||ttl_ms<1000||ttl_ms>max_ttl_ms)throw error('BILLING_GATEWAY_RESERVATION_CLAIMS_INVALID');
      return mint('reservation',{invocation_id,request_sha256:request_sha256.toLowerCase(),work_unit_budget_id,priority,canary_wave},ttl_ms);
    },
    consumeReservation(token,claims={}){return verify(token,'reservation',{invocation_id:claims.invocation_id,request_sha256:String(claims.request_sha256??'').toLowerCase(),work_unit_budget_id:claims.work_unit_budget_id,priority:claims.priority??'P2',canary_wave:claims.canary_wave??'default'});},
    issueControllerCredential({controller_id='page-autodev-controller',generation='current',ttl_ms=86400000}={}){if(!acceptedGenerations.has(generation)||!Number.isSafeInteger(ttl_ms)||ttl_ms<60000||ttl_ms>controllerMaxTtl)throw error('BILLING_CONTROLLER_CREDENTIAL_CLAIMS_INVALID');const now=clock(),payload={v:1,aud:audience,sub:controller_id,purpose:'reservation_bootstrap',generation,iat_ms:now,exp_ms:now+ttl_ms,jti:crypto.randomUUID()};const body=encode(payload);return `${body}.${sign(body)}`;},
    verifyControllerCredential:verifyController
  });
}
