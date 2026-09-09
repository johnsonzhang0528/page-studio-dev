import crypto from 'node:crypto';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sha256=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const denied=message=>Object.assign(new Error(message),{code:'BILLING_FENCE_REJECTED'});
const validateAuthorization=(spec,authorization)=>{
  if(!authorization||typeof authorization.lease_id!=='string'||!authorization.lease_id||authorization.request_sha256!==sha256(spec)||typeof authorization.dispatch_token!=='string'||!authorization.dispatch_token||!Number.isSafeInteger(authorization.fencing_generation)) throw denied('BILLING_GATEWAY_AUTHORIZATION_INVALID');
};

export function createBillingGatewayAuthorizer(config={}){
  const firewall=config.firewall;
  const outbox=config.outbox;
  if(!firewall||!outbox)throw Object.assign(new Error('BILLING_GATEWAY_CONFIG_REQUIRED'),{code:'BILLING_GATEWAY_UNAVAILABLE'});
  return Object.freeze({
    reserve(spec,options){
      return firewall.reserve(spec,options);
    },
    authorize(spec,leaseId){
      const requestSha256=sha256(spec);
      outbox.createIntent({invocation_id:spec.invocation_id,idempotency_key:spec.idempotency_key,lease_id:leaseId,request_sha256:requestSha256,parent_checkpoint:spec.parent_checkpoint});
      const spend=firewall.authorizeDispatch(leaseId,spec);
      const dispatch=outbox.authorizeDispatch(spec.invocation_id);
      return Object.freeze({lease_id:leaseId,dispatch_token:dispatch.dispatch_token,fencing_generation:dispatch.fencing_generation,request_sha256:requestSha256,spend_dispatch_token:spend.dispatch_token});
    },
    accept(spec,authorization,providerRequestId){
      validateAuthorization(spec,authorization);
      return outbox.markAccepted(spec.invocation_id,{dispatch_token:authorization.dispatch_token,fencing_generation:authorization.fencing_generation,provider_request_id:providerRequestId});
    },
    markUnknown(spec,authorization,reason){
      validateAuthorization(spec,authorization);
      return outbox.markUnknown(spec.invocation_id,{reason});
    },
    stage(spec,authorization,providerRequestId,resultSha256){
      validateAuthorization(spec,authorization);
      return outbox.stageResult(spec.invocation_id,{dispatch_token:authorization.dispatch_token,fencing_generation:authorization.fencing_generation,provider_request_id:providerRequestId,result_sha256:resultSha256});
    }
  });
}
