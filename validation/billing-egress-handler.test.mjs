import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createBillingEgressAssertionAuthority } from '../lib/billing-egress-assertion.mjs';
import { createBillingEgressHandler } from '../lib/billing-egress-handler.mjs';
import { validateBillingEgressPolicy } from '../lib/billing-egress-policy.mjs';

const base={schema_version:1,activation:'disabled',service_identity:'page-autodev-openai-egress',listener:{transport:'unix',path:'/run/page-autodev/openai-egress.sock'},upstream:{hostname:'api.openai.com',port:443,tls_servername:'api.openai.com',minimum_tls:'TLSv1.2',paths:['/v1/responses'],methods:['POST'],redirects:0,retries:0},credential:{source:'systemd',gateway_readable:false,worker_readable:false},approved_model_snapshots:[]};
assert.equal(validateBillingEgressPolicy(base).activation,'disabled');
const body=Buffer.from('{"store":false}'),body_sha256=crypto.createHash('sha256').update(body).digest('hex'),active={...base,activation:'active',approved_model_snapshots:['approved-snapshot']};let dispatches=0;
const assertionAuthority=createBillingEgressAssertionAuthority({secret:Buffer.alloc(32,11),clock:()=>1000000});
const assertionScope={request_id:'request-1',body_sha256,model_snapshot:'approved-snapshot'};
const handler=createBillingEgressHandler({policy:active,verifyGatewayAssertion:(value,scope)=>assertionAuthority.consume(value,scope),async dispatchTls(request){dispatches+=1;assert.equal(request.hostname,'api.openai.com');assert.equal(request.servername,'api.openai.com');assert.equal(request.redirects,0);assert.equal(request.retries,0);return {status:200};}});
const envelope={gateway_assertion:assertionAuthority.issue(assertionScope),request_id:'request-1',method:'POST',path:'/v1/responses',model_snapshot:'approved-snapshot',body,body_sha256};
assert.equal((await handler(envelope)).status,200);assert.equal(dispatches,1);
for(const mutate of [value=>value.path='/v1/models',value=>value.model_snapshot='alias']){const candidate=structuredClone(envelope);mutate(candidate);await assert.rejects(handler(candidate),error=>error.code==='BILLING_EGRESS_SCOPE_INVALID');}
for(const mutate of [value=>value.body_sha256='0'.repeat(64),value=>value.base_url='https://evil.invalid']){const candidate=structuredClone(envelope);mutate(candidate);await assert.rejects(handler(candidate),error=>['BILLING_EGRESS_REQUEST_INVALID','BILLING_EGRESS_ENVELOPE_INVALID'].includes(error.code));}
const deniedAssertion=createBillingEgressHandler({policy:active,verifyGatewayAssertion:async()=>({ok:false}),dispatchTls:async()=>{dispatches+=1;}});await assert.rejects(deniedAssertion(envelope),error=>error.code==='BILLING_EGRESS_ASSERTION_INVALID');
const disabled=createBillingEgressHandler({policy:base,verifyGatewayAssertion:async()=>({ok:true}),dispatchTls:async()=>{dispatches+=1;}});await assert.rejects(disabled(envelope),error=>error.code==='BILLING_EGRESS_DISABLED');assert.equal(dispatches,1);
console.log('BILLING_EGRESS_HANDLER_TESTS_OK');
