import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOpenAiTlsTransport } from '../lib/billing-egress-tls.mjs';

let calls=0,captured=null;
const request=(options,onResponse)=>{
  calls+=1;captured=options;const handle=new EventEmitter();handle.destroy=()=>{};handle.end=body=>{assert.equal(body.toString(),'{"store":false}');const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'application/json','x-request-id':'req_fixture_1'};onResponse(response);queueMicrotask(()=>{response.emit('data',Buffer.from('{"id":"resp_fixture"}'));response.emit('end');});};return handle;
};
const transport=createOpenAiTlsTransport({apiKey:Buffer.from('fake-offline-key'),request,absolute_timeout_ms:1000});
const scope={hostname:'api.openai.com',port:443,servername:'api.openai.com',minimum_tls:'TLSv1.2',method:'POST',path:'/v1/responses',redirects:0,retries:0,body:Buffer.from('{"store":false}'),request_id:'invocation-1'};
const result=await transport(scope);
assert.equal(result.status,200);assert.equal(result.provider_request_id,'req_fixture_1');assert.equal(result.attempts,1);assert.equal(calls,1);
assert.equal(captured.hostname,'api.openai.com');assert.equal(captured.servername,'api.openai.com');assert.equal(captured.agent,false);assert.equal(captured.headers.authorization,'Bearer fake-offline-key');assert.equal(captured.headers['x-client-request-id'],'invocation-1');
for(const mutation of [{hostname:'evil.invalid'},{path:'/v1/chat/completions'},{redirects:1},{retries:1},{servername:'evil.invalid'}]) await assert.rejects(transport({...scope,...mutation}),error=>error.code==='BILLING_EGRESS_TLS_DENIED');
assert.equal(calls,1);

const missingId=createOpenAiTlsTransport({apiKey:'fake',request:(options,onResponse)=>{const handle=new EventEmitter();handle.destroy=()=>{};handle.end=()=>{const response=new EventEmitter();response.statusCode=200;response.headers={};onResponse(response);queueMicrotask(()=>response.emit('end'));};return handle;},absolute_timeout_ms:1000});
await assert.rejects(missingId(scope),error=>error.code==='BILLING_EGRESS_TLS_DENIED');
console.log('BILLING_EGRESS_TLS_TESTS_OK');
