import crypto from 'node:crypto';

const fail=(message,code='OPENAI_EGRESS_RESPONSE_INVALID')=>Object.assign(new Error(message),{code});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const outputText=response=>response?.output?.flatMap(item=>item?.content??[]).find(item=>item?.type==='output_text')?.text;

export function createOpenAiResponsesEgressTransport({egressClient,assertionAuthority}={}){
  if(!egressClient||typeof egressClient.dispatch!=='function'||!assertionAuthority||typeof assertionAuthority.issue!=='function')throw fail('OPENAI_EGRESS_TRANSPORT_CONFIG_INVALID','OPENAI_EGRESS_CONFIG_INVALID');
  return Object.freeze({async dispatch(request={}){
    if(request.contract_version!==1||typeof request.model!=='string'||!request.model||!request.input||request.structured_output?.strict!==true||request.billing_authorization===undefined)throw fail('OPENAI_EGRESS_REQUEST_INVALID','OPENAI_EGRESS_REQUEST_DENIED');
    const body=Buffer.from(JSON.stringify({model:request.model,input:[{role:'developer',content:[{type:'input_text',text:JSON.stringify({objective:request.input.objective,context_manifest:request.input.context_manifest,tool_outputs:request.input.tool_outputs})}]}],text:{format:{type:'json_schema',name:'page_autodev_receipt',strict:true,schema:request.structured_output.schema}},max_output_tokens:request.limits.max_output_tokens,reasoning:{effort:'high'},store:false}));
    const body_sha256=digest(body),request_id=request.idempotency_key,gateway_assertion=assertionAuthority.issue({request_id,body_sha256,model_snapshot:request.model});
    const wire=await egressClient.dispatch({gateway_assertion,request_id,method:'POST',path:'/v1/responses',model_snapshot:request.model,body,body_sha256});
    if(!Number.isSafeInteger(wire?.status)||wire.status<200||wire.status>=300)throw fail(`OPENAI_EGRESS_STATUS_${wire?.status??'UNKNOWN'}`,'PROVIDER_UNAVAILABLE');
    if(!wire.provider_request_id||!Buffer.isBuffer(wire.body))throw fail('OPENAI_EGRESS_WIRE_INVALID');
    let response;try{response=JSON.parse(wire.body.toString('utf8'));}catch{throw fail('OPENAI_EGRESS_JSON_INVALID');}
    if(response.model!==request.model)throw fail('OPENAI_MODEL_DRIFT','MODEL_DRIFT_HOLD');
    const text=outputText(response);if(typeof text!=='string')throw fail('OPENAI_OUTPUT_TEXT_MISSING');
    let structured_output;try{structured_output=JSON.parse(text);}catch{throw fail('OPENAI_STRUCTURED_OUTPUT_JSON_INVALID');}
    return {provider_request_id:wire.provider_request_id,structured_output,usage:response.usage,finish_reason:response.status??'completed',tool_calls:[],request_sha256:body_sha256,response_sha256:digest(wire.body)};
  }});
}
