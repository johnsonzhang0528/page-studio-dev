import crypto from 'node:crypto';
import { createInvocationResult } from './provider-contract.mjs';
import { authorizeCapability } from './provider-capabilities.mjs';

export function createFakeProviderAdapter({registry,mode='success'}={}){
  return Object.freeze({
    provider:'fake',
    async invoke(spec){
      const capability=authorizeCapability(registry,{provider:spec.provider,model:spec.model,required:['structured_output','usage_receipt',spec.verification_mode==='read_only'?'read_only':'isolated_write']});
      if(!capability.ok){ const error=new Error(capability.code); error.code=capability.code; throw error; }
      const requestId=`fake_${crypto.createHash('sha256').update(spec.idempotency_key).digest('hex').slice(0,20)}`;
      if(mode==='throw_timeout'){ const error=new Error('FAKE_TIMEOUT'); error.code='PROVIDER_TIMEOUT'; throw error; }
      if(mode==='invalid_result') return {outcome:'success'};
      const outcomes={success:['success','stop',false,null],throttled:['throttled','rate_limit',true,'RATE_LIMITED'],unavailable:['unavailable','provider_error',true,'PROVIDER_UNAVAILABLE'],cancelled:['cancelled','cancelled',false,'CANCELLED_SAFE']},selected=outcomes[mode]??outcomes.success;
      return createInvocationResult(spec,{outcome:selected[0],structured_output:mode==='success'?{ok:true}:null,provider_request_id:requestId,usage:{input_tokens:10,cached_input_tokens:0,output_tokens:5,reasoning_tokens:0},finish_reason:selected[1],retryability:selected[2],error_class:selected[3],artifacts:[],wall_ms:1});
    }
  });
}
