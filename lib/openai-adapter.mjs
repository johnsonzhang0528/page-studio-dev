import { createInvocationResult } from './provider-contract.mjs';
import { authorizeCapability } from './provider-capabilities.mjs';

export const OPENAI_ADAPTER_VERSION=1;
const byteLength=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const validateStructured=(value,schema)=>{
  if(!schema||typeof schema!=='object') return false;
  if(Array.isArray(schema.enum)&&!schema.enum.some(candidate=>Object.is(candidate,value))) return false;
  if(schema.type==='null') return value===null;
  if(schema.type==='boolean') return typeof value==='boolean';
  if(schema.type==='string') return typeof value==='string'&&(!Number.isSafeInteger(schema.maxLength)||value.length<=schema.maxLength);
  if(schema.type==='number') return typeof value==='number'&&Number.isFinite(value);
  if(schema.type==='integer') return Number.isSafeInteger(value);
  if(schema.type==='array') return Array.isArray(value)&&(!Number.isSafeInteger(schema.maxItems)||value.length<=schema.maxItems)&&value.every(item=>validateStructured(item,schema.items));
  if(schema.type!=='object'||!value||typeof value!=='object'||Array.isArray(value)) return false;
  if(Array.isArray(schema.required)&&schema.required.some(key=>!Object.hasOwn(value,key))) return false;
  if(schema.additionalProperties===false&&schema.properties&&Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key))) return false;
  return Object.entries(schema.properties??{}).every(([key,child])=>!Object.hasOwn(value,key)||validateStructured(value[key],child));
};
const normalizeUsage=raw=>({input_tokens:Number(raw?.input_tokens??0),cached_input_tokens:Number(raw?.cached_input_tokens??raw?.input_tokens_details?.cached_tokens??0),output_tokens:Number(raw?.output_tokens??0),reasoning_tokens:Number(raw?.reasoning_tokens??raw?.output_tokens_details?.reasoning_tokens??0)});
const deadlineSignal=(deadlineMs,externalSignal)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Object.assign(new Error('OPENAI_ABSOLUTE_DEADLINE'),{code:'PROVIDER_TIMEOUT'})),deadlineMs);
  const cancel=()=>controller.abort(externalSignal?.reason??Object.assign(new Error('OPENAI_CANCELLED'),{code:'CANCELLED_SAFE'})); if(externalSignal?.aborted)cancel(); else externalSignal?.addEventListener('abort',cancel,{once:true});
  return {signal:controller.signal,dispose(){clearTimeout(timer);externalSignal?.removeEventListener('abort',cancel);}};
};
const abortable=(promise,signal)=>{
  if(signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
};
const boundedToolCall=(factory,timeoutMs,parentSignal)=>{
  const controller=new AbortController();
  const timeoutReason=Object.assign(new Error('OPENAI_TOOL_TIMEOUT'),{code:'TOOL_TIMEOUT'});
  const timer=setTimeout(()=>controller.abort(timeoutReason),timeoutMs);
  const cancel=()=>controller.abort(parentSignal.reason);
  if(parentSignal.aborted) cancel(); else parentSignal.addEventListener('abort',cancel,{once:true});
  return abortable(Promise.resolve().then(()=>factory(controller.signal)),controller.signal)
    .finally(()=>{clearTimeout(timer);parentSignal.removeEventListener('abort',cancel);});
};

export function createOpenAiResponsesAdapter({registry,transport,tools={},offline=true,billingAuthorizer=null}={}){
  if(!transport||typeof transport.dispatch!=='function') throw new Error('OPENAI_TRANSPORT_REQUIRED');
  return Object.freeze({provider:'openai',version:OPENAI_ADAPTER_VERSION,async invoke(spec,{signal:externalSignal,spend_lease_id=null}={}){
    if(spec.provider!=='openai') throw Object.assign(new Error('OPENAI_PROVIDER_MISMATCH'),{code:'PROVIDER_MISMATCH'});
    if(offline&&(spec.network_policy!=='deny_all'||spec.verification_mode!=='read_only')) throw Object.assign(new Error('OPENAI_OFFLINE_POLICY_VIOLATION'),{code:'POLICY_VIOLATION'});
    if(!offline&&spec.network_policy!=='billing_gateway_only') throw Object.assign(new Error('OPENAI_GATEWAY_POLICY_REQUIRED'),{code:'POLICY_VIOLATION'});
    if(!offline&&(!billingAuthorizer||!['authorize','accept','stage'].every(method=>typeof billingAuthorizer[method]==='function')||!spend_lease_id)) throw Object.assign(new Error('OPENAI_SPEND_LEASE_REQUIRED'),{code:'BILLING_DISPATCH_DENIED'});
    if(!offline&&spec.budget.max_api_round_trips!==1) throw Object.assign(new Error('OPENAI_MULTI_ROUND_GATEWAY_NOT_READY'),{code:'POLICY_VIOLATION'});
    const required=['structured_output','usage_receipt','cancellation','tool_loop',spec.verification_mode==='read_only'?'read_only':'isolated_write'],capability=authorizeCapability(registry,{provider:spec.provider,model:spec.model,required});
    if(!capability.ok) throw Object.assign(new Error(capability.code),{code:capability.code,missing:capability.missing});
    const billingAuthorization=offline?null:await billingAuthorizer.authorize(spec,spend_lease_id);
    if(!offline&&(!billingAuthorization||typeof billingAuthorization.dispatch_token!=='string'||!billingAuthorization.dispatch_token)) throw Object.assign(new Error('OPENAI_BILLING_AUTHORIZATION_INVALID'),{code:'BILLING_DISPATCH_DENIED'});
    const deadline=deadlineSignal(Math.min(spec.timeouts.invocation_deadline_ms,spec.budget.max_wall_ms),externalSignal),started=Date.now(),toolOutputs=[]; let rounds=0,totalToolCalls=0,response;
    try{
      while(true){
        if(deadline.signal.aborted) throw deadline.signal.reason;
        rounds+=1; if(rounds>spec.budget.max_api_round_trips) throw Object.assign(new Error('OPENAI_ROUND_TRIP_LIMIT'),{code:'BUDGET_LIMIT'});
        response=await abortable(transport.dispatch({contract_version:OPENAI_ADAPTER_VERSION,model:spec.model,input:{objective:spec.objective,context_manifest:spec.context_manifest,tool_outputs:structuredClone(toolOutputs)},structured_output:{schema:spec.output_schema,strict:true},limits:{max_output_tokens:spec.budget.max_output_tokens,max_reasoning_tokens:spec.budget.max_reasoning_tokens,deadline_ms:spec.timeouts.invocation_deadline_ms},idempotency_key:spec.idempotency_key,billing_authorization:billingAuthorization},{signal:deadline.signal}),deadline.signal);
        if(!Array.isArray(response?.tool_calls)||response.tool_calls.length===0) break;
        for(const call of response.tool_calls){
          totalToolCalls+=1; if(totalToolCalls>spec.budget.max_tool_calls) throw Object.assign(new Error('OPENAI_TOOL_CALL_LIMIT'),{code:'BUDGET_LIMIT'});
          if(!call?.id||!call?.name||!Object.hasOwn(tools,call.name)) throw Object.assign(new Error('OPENAI_TOOL_NOT_ALLOWED'),{code:'TOOL_POLICY_VIOLATION'});
          const tool=tools[call.name]; if(tool.capability&&!spec.tool_capabilities.includes(tool.capability)) throw Object.assign(new Error('OPENAI_TOOL_CAPABILITY_MISMATCH'),{code:'TOOL_POLICY_VIOLATION'});
          const output=await boundedToolCall(signal=>tool.execute(structuredClone(call.arguments??{}),{signal,spec}),spec.timeouts.tool_ms,deadline.signal); toolOutputs.push({tool_call_id:call.id,output});
        }
      }
      if(!response?.provider_request_id) throw Object.assign(new Error('OPENAI_REQUEST_ID_MISSING'),{code:'INVALID_PROVIDER_RESULT'});
      if(!offline) await billingAuthorizer.accept(spec,billingAuthorization,response.provider_request_id);
      if(!response.usage) throw Object.assign(new Error('OPENAI_USAGE_MISSING'),{code:'INVALID_PROVIDER_RESULT'});
      if(!validateStructured(response.structured_output,spec.output_schema)) throw Object.assign(new Error('OPENAI_STRUCTURED_OUTPUT_INVALID'),{code:'INVALID_PROVIDER_RESULT'});
      if(byteLength(response.structured_output)>spec.budget.max_output_tokens*8) throw Object.assign(new Error('OPENAI_RESULT_TOO_LARGE'),{code:'BUDGET_LIMIT'});
      const result=createInvocationResult(spec,{outcome:'success',structured_output:response.structured_output,provider_request_id:response.provider_request_id,usage:normalizeUsage(response.usage),finish_reason:response.finish_reason??'stop',retryability:false,error_class:null,artifacts:response.artifacts??[],wall_ms:Date.now()-started,request_sha256:response.request_sha256,response_sha256:response.response_sha256});
      if(!offline){const staged=await billingAuthorizer.stage(spec,billingAuthorization,response.provider_request_id,result.response_sha256);if(staged?.staged!==true) throw Object.assign(new Error('OPENAI_RESULT_FENCE_REJECTED'),{code:'BILLING_FENCE_REJECTED'});}
      return result;
    } catch(error){
      if(!offline&&billingAuthorization&&typeof billingAuthorizer.markUnknown==='function'){try{await billingAuthorizer.markUnknown(spec,billingAuthorization,error?.code??'PROVIDER_OUTCOME_UNKNOWN');}catch{}}
      throw error;
    } finally { deadline.dispose(); }
  }});
}
