import crypto from 'node:crypto';

const fail=(message,code='OPENAI_EGRESS_RESPONSE_INVALID')=>Object.assign(new Error(message),{code});
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const outputText=response=>response?.output?.flatMap(item=>item?.content??[]).find(item=>item?.type==='output_text')?.text;
const strictSchema=node=>{
  if(!node||typeof node!=='object'||Array.isArray(node))return node;
  const out={};
  for(const key of ['type','enum','description','$ref'])if(Object.hasOwn(node,key))out[key]=structuredClone(node[key]);
  if(node.items)out.items=strictSchema(node.items);
  if(Array.isArray(node.anyOf))out.anyOf=node.anyOf.map(strictSchema);
  if(node.properties&&typeof node.properties==='object'){
    const required=new Set(node.required??[]);out.properties={};
    for(const [key,child] of Object.entries(node.properties)){
      const normalized=strictSchema(child);
      if(!required.has(key)){
        const types=Array.isArray(normalized.type)?normalized.type:[normalized.type].filter(Boolean);
        if(types.length&&!types.includes('null'))normalized.type=[...types,'null'];
        if(Array.isArray(normalized.enum)&&!normalized.enum.includes(null))normalized.enum=[...normalized.enum,null];
      }
      out.properties[key]=normalized;
    }
    out.required=Object.keys(out.properties);out.additionalProperties=false;
  }
  return out;
};
const pruneOptionalNulls=(value,schema)=>{
  if(typeof value==='string'&&Number.isSafeInteger(schema?.maxLength))return value.slice(0,schema.maxLength);
  if(Array.isArray(value)){const normalized=value.map(item=>pruneOptionalNulls(item,schema?.items));return Number.isSafeInteger(schema?.maxItems)?normalized.slice(0,schema.maxItems):normalized;}
  if(!value||typeof value!=='object')return value;
  const required=new Set(schema?.required??[]),copy={};
  for(const [key,child] of Object.entries(schema?.properties??{}))if(Object.hasOwn(value,key)){
    if(value[key]===null&&!required.has(key))continue;
    copy[key]=pruneOptionalNulls(value[key],child);
  }
  return copy;
};
const acceptedError=(message,wire,response)=>{const error=fail(message);error.provider_request_id=wire.provider_request_id;error.http_status=wire.status;error.response_status=typeof response?.status==='string'?response.status:null;error.provider_error_code=String(response?.incomplete_details?.reason??response?.error?.code??'').replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,120)||null;return error;};

export function createOpenAiResponsesEgressTransport({egressClient,assertionAuthority}={}){
  if(!egressClient||typeof egressClient.dispatch!=='function'||!assertionAuthority||typeof assertionAuthority.issue!=='function')throw fail('OPENAI_EGRESS_TRANSPORT_CONFIG_INVALID','OPENAI_EGRESS_CONFIG_INVALID');
  return Object.freeze({async dispatch(request={}){
    if(request.contract_version!==1||typeof request.model!=='string'||!request.model||!request.input||request.structured_output?.strict!==true||request.billing_authorization===undefined)throw fail('OPENAI_EGRESS_REQUEST_INVALID','OPENAI_EGRESS_REQUEST_DENIED');
    const maxOutputTokens=Number(request.limits.max_output_tokens)+Number(request.limits.max_reasoning_tokens??0);
    if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<=0)throw fail('OPENAI_EGRESS_TOKEN_LIMIT_INVALID','OPENAI_EGRESS_REQUEST_DENIED');
    const body=Buffer.from(JSON.stringify({model:request.model,input:[{role:'developer',content:[{type:'input_text',text:JSON.stringify({objective:request.input.objective,context_manifest:request.input.context_manifest,tool_outputs:request.input.tool_outputs})}]}],text:{format:{type:'json_schema',name:'page_autodev_receipt',strict:true,schema:strictSchema(request.structured_output.schema)}},max_output_tokens:maxOutputTokens,reasoning:{effort:'high'},store:false}));
    const body_sha256=digest(body),request_id=request.idempotency_key,gateway_assertion=assertionAuthority.issue({request_id,body_sha256,model_snapshot:request.model});
    const wire=await egressClient.dispatch({gateway_assertion,request_id,method:'POST',path:'/v1/responses',model_snapshot:request.model,body,body_sha256});
    if(!Number.isSafeInteger(wire?.status)||wire.status<200||wire.status>=300){const error=fail(`OPENAI_EGRESS_STATUS_${wire?.status??'UNKNOWN'}`,'PROVIDER_UNAVAILABLE');error.http_status=Number.isSafeInteger(wire?.status)?wire.status:null;error.provider_request_id=wire?.provider_request_id??null;try{const detail=JSON.parse(wire.body?.toString('utf8')??'{}')?.error;error.provider_error_code=String(detail?.code??detail?.type??'').replace(/[^A-Za-z0-9_.:-]/g,'').slice(0,120)||null;}catch{}throw error;}
    if(!wire.provider_request_id||!Buffer.isBuffer(wire.body))throw fail('OPENAI_EGRESS_WIRE_INVALID');
    let response;try{response=JSON.parse(wire.body.toString('utf8'));}catch{throw fail('OPENAI_EGRESS_JSON_INVALID');}
    if(response.model!==request.model)throw fail('OPENAI_MODEL_DRIFT','MODEL_DRIFT_HOLD');
    if(response.status!=='completed')throw acceptedError(`OPENAI_RESPONSE_${String(response.status??'UNKNOWN').toUpperCase()}`,wire,response);
    const refusal=response?.output?.flatMap(item=>item?.content??[]).find(item=>item?.type==='refusal');if(refusal)throw acceptedError('OPENAI_RESPONSE_REFUSAL',wire,response);
    const text=outputText(response);if(typeof text!=='string')throw acceptedError('OPENAI_OUTPUT_TEXT_MISSING',wire,response);
    let structured_output;try{structured_output=pruneOptionalNulls(JSON.parse(text),request.structured_output.schema);}catch{throw acceptedError('OPENAI_STRUCTURED_OUTPUT_JSON_INVALID',wire,response);}
    return {provider_request_id:wire.provider_request_id,structured_output,usage:response.usage,finish_reason:response.status??'completed',tool_calls:[],request_sha256:body_sha256,response_sha256:digest(wire.body)};
  }});
}
