import assert from 'node:assert/strict';
import { createOpenAiResponsesEgressTransport } from '../lib/openai-responses-egress-transport.mjs';

const dispatched=[],assertions=[],response={model:'gpt-5.6-luna',status:'completed',output:[{content:[{type:'output_text',text:'{"outcome":"pass"}'}]}],usage:{input_tokens:10,output_tokens:4}};
const transport=createOpenAiResponsesEgressTransport({assertionAuthority:{issue(scope){assertions.push(scope);return 'assertion';}},egressClient:{async dispatch(input){dispatched.push(input);return {status:200,provider_request_id:'req-1',body:Buffer.from(JSON.stringify(response))};}}});
const request={contract_version:1,model:'gpt-5.6-luna',input:{objective:'verify',context_manifest:{sha256:'x'},tool_outputs:[]},structured_output:{strict:true,schema:{type:'object'}},limits:{max_output_tokens:100},idempotency_key:'idem-1',billing_authorization:{dispatch_token:'token'}};
const result=await transport.dispatch(request);assert.deepEqual(result.structured_output,{outcome:'pass'});assert.equal(result.provider_request_id,'req-1');assert.equal(dispatched[0].path,'/v1/responses');assert.equal(dispatched[0].method,'POST');assert.equal(dispatched[0].model_snapshot,'gpt-5.6-luna');assert.equal(dispatched[0].gateway_assertion,'assertion');assert.equal(assertions[0].body_sha256,dispatched[0].body_sha256);
const body=JSON.parse(dispatched[0].body.toString('utf8'));assert.deepEqual(Object.keys(body).sort(),['input','max_output_tokens','model','reasoning','store','text']);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
const withResponse=value=>createOpenAiResponsesEgressTransport({assertionAuthority:{issue(){return 'a';}},egressClient:{async dispatch(){return value;}}});
await assert.rejects(withResponse({status:200,provider_request_id:'req',body:Buffer.from(JSON.stringify({...response,model:'changed'}))}).dispatch(request),error=>error.code==='MODEL_DRIFT_HOLD');
await assert.rejects(withResponse({status:500,provider_request_id:'req',body:Buffer.from('{}')}).dispatch(request),error=>error.code==='PROVIDER_UNAVAILABLE');
await assert.rejects(withResponse({status:200,provider_request_id:'req',body:Buffer.from(JSON.stringify({...response,output:[{content:[{type:'output_text',text:'not-json'}]}]}))}).dispatch(request),error=>error.code==='OPENAI_EGRESS_RESPONSE_INVALID');
console.log('OPENAI_RESPONSES_EGRESS_TRANSPORT_TESTS_OK');
