import crypto from 'node:crypto';

export const BILLING_GATEWAY_CREDENTIAL_VERSION=1;
const audience='page-autodev-billing-gateway';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const decode=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
const error=(message,code='BILLING_GATEWAY_CREDENTIAL_DENIED')=>Object.assign(new Error(message),{code});

export function createBillingGatewayCredentialAuthority({secret,clock=()=>Date.now(),max_ttl_ms=900000}={}){
  const key=Buffer.isBuffer(secret)?secret:Buffer.from(secret??'');
  if(key.length<32)throw error('BILLING_GATEWAY_CREDENTIAL_SECRET_WEAK','BILLING_GATEWAY_CONFIG_INVALID');
  if(!Number.isSafeInteger(max_ttl_ms)||max_ttl_ms<1000||max_ttl_ms>900000)throw error('BILLING_GATEWAY_CREDENTIAL_TTL_INVALID','BILLING_GATEWAY_CONFIG_INVALID');
  const consumed=new Set();
  const sign=input=>crypto.createHmac('sha256',key).update(input).digest('base64url');
  return Object.freeze({
    issue({invocation_id,lease_id,request_sha256,ttl_ms=60000}={}){
      if(!invocation_id||!lease_id||!/^[a-f0-9]{64}$/i.test(request_sha256??'')||!Number.isSafeInteger(ttl_ms)||ttl_ms<1000||ttl_ms>max_ttl_ms)throw error('BILLING_GATEWAY_CREDENTIAL_CLAIMS_INVALID');
      const now=clock(),payload={v:1,aud:audience,sub:'page-autodev-worker',iat_ms:now,exp_ms:now+ttl_ms,jti:crypto.randomUUID(),invocation_id,lease_id,request_sha256:request_sha256.toLowerCase()};
      const body=encode(payload);return `${body}.${sign(body)}`;
    },
    consume(token,{invocation_id,lease_id,request_sha256}={}){
      if(typeof token!=='string'||token.length>4096)throw error('BILLING_GATEWAY_CREDENTIAL_FORMAT_INVALID');
      const [body,signature,...extra]=token.split('.');
      if(!body||!signature||extra.length)throw error('BILLING_GATEWAY_CREDENTIAL_FORMAT_INVALID');
      const expected=sign(body),provided=Buffer.from(signature);
      if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,Buffer.from(expected)))throw error('BILLING_GATEWAY_CREDENTIAL_SIGNATURE_INVALID');
      let payload;try{payload=decode(body);}catch{throw error('BILLING_GATEWAY_CREDENTIAL_PAYLOAD_INVALID');}
      const now=clock(),valid=payload?.v===1&&payload.aud===audience&&payload.sub==='page-autodev-worker'&&Number.isSafeInteger(payload.iat_ms)&&Number.isSafeInteger(payload.exp_ms)&&payload.exp_ms>now&&payload.iat_ms<=now&&payload.exp_ms-payload.iat_ms<=max_ttl_ms&&payload.invocation_id===invocation_id&&payload.lease_id===lease_id&&payload.request_sha256===String(request_sha256??'').toLowerCase()&&typeof payload.jti==='string';
      if(!valid)throw error('BILLING_GATEWAY_CREDENTIAL_SCOPE_INVALID');
      if(consumed.has(payload.jti))throw error('BILLING_GATEWAY_CREDENTIAL_REPLAY');
      consumed.add(payload.jti);return Object.freeze(payload);
    }
  });
}
