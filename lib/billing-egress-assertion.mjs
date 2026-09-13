import crypto from 'node:crypto';

const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const decode=value=>JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
const denied=(message,code=message)=>Object.assign(new Error(message),{code});

export function createBillingEgressAssertionAuthority({secret,clock=()=>Date.now(),max_ttl_ms=30000}={}){
  const key=Buffer.isBuffer(secret)?secret:Buffer.from(secret??'');
  if(key.length<32||!Number.isSafeInteger(max_ttl_ms)||max_ttl_ms<1000||max_ttl_ms>60000)throw denied('BILLING_EGRESS_ASSERTION_CONFIG_INVALID','BILLING_EGRESS_CONFIG_INVALID');
  const consumed=new Map(),sign=body=>crypto.createHmac('sha256',key).update(body).digest('base64url');
  const sweep=now=>{for(const [jti,expires] of consumed)if(expires<=now)consumed.delete(jti);};
  return Object.freeze({
    issue({request_id,body_sha256,model_snapshot,ttl_ms=10000}={}){
      if(typeof request_id!=='string'||!/^[\x21-\x7E]{1,512}$/.test(request_id)||!/^[a-f0-9]{64}$/.test(body_sha256??'')||typeof model_snapshot!=='string'||!model_snapshot||!Number.isSafeInteger(ttl_ms)||ttl_ms<1000||ttl_ms>max_ttl_ms)throw denied('BILLING_EGRESS_ASSERTION_CLAIMS_INVALID');
      const now=clock(),payload={v:1,aud:'page-autodev-openai-egress',sub:'page-autodev-billing-gateway',iat_ms:now,exp_ms:now+ttl_ms,jti:crypto.randomUUID(),request_id,body_sha256,model_snapshot};
      const body=encode(payload);return `${body}.${sign(body)}`;
    },
    consume(token,scope={}){
      if(typeof token!=='string'||token.length>4096)throw denied('BILLING_EGRESS_ASSERTION_FORMAT_INVALID');
      const [body,signature,...extra]=token.split('.');if(!body||!signature||extra.length)throw denied('BILLING_EGRESS_ASSERTION_FORMAT_INVALID');
      const expected=sign(body),provided=Buffer.from(signature);if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,Buffer.from(expected)))throw denied('BILLING_EGRESS_ASSERTION_SIGNATURE_INVALID');
      let payload;try{payload=decode(body);}catch{throw denied('BILLING_EGRESS_ASSERTION_PAYLOAD_INVALID');}
      const now=clock();sweep(now);
      if(payload?.v!==1||payload.aud!=='page-autodev-openai-egress'||payload.sub!=='page-autodev-billing-gateway'||payload.iat_ms>now||payload.exp_ms<=now||payload.exp_ms-payload.iat_ms>max_ttl_ms||payload.request_id!==scope.request_id||payload.body_sha256!==scope.body_sha256||payload.model_snapshot!==scope.model_snapshot)throw denied('BILLING_EGRESS_ASSERTION_SCOPE_INVALID');
      if(consumed.has(payload.jti))throw denied('BILLING_EGRESS_ASSERTION_REPLAY');consumed.set(payload.jti,payload.exp_ms);
      return {ok:true,jti:payload.jti,expires_at_ms:payload.exp_ms};
    }
  });
}
