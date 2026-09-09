import assert from 'node:assert/strict';
import { createBillingGatewayAuthorizer } from '../lib/billing-gateway-authorizer.mjs';

const spec={invocation_id:'inv-1',idempotency_key:'idem-1',parent_checkpoint:'checkpoint',project:'fixture',provider:'openai',model:'fixture'};
const calls=[];
const firewall={
  reserve(received,options){calls.push('reserve');assert.equal(received,spec);return {lease_id:options.lease_id};},
  authorizeDispatch(leaseId,received){calls.push('firewall');assert.equal(leaseId,'lease-1');assert.equal(received,spec);return {dispatch_token:'spend-token'};}
};
const outbox={
  createIntent(intent){calls.push('intent');assert.equal(intent.invocation_id,spec.invocation_id);assert.equal(intent.lease_id,'lease-1');assert.match(intent.request_sha256,/^[a-f0-9]{64}$/);},
  authorizeDispatch(invocationId){calls.push('outbox');assert.equal(invocationId,spec.invocation_id);return {dispatch_token:'outbox-token',fencing_generation:1};},
  markAccepted(invocationId,input){calls.push('accepted');assert.equal(invocationId,spec.invocation_id);assert.equal(input.dispatch_token,'outbox-token');assert.equal(input.provider_request_id,'request-1');return {status:'PROVIDER_ACCEPTED'};},
  markUnknown(invocationId,input){calls.push('unknown');assert.equal(invocationId,spec.invocation_id);assert.equal(input.reason,'TIMEOUT');return {status:'RECONCILIATION_REQUIRED'};},
  stageResult(invocationId,input){calls.push('staged');assert.equal(invocationId,spec.invocation_id);assert.equal(input.result_sha256,'a'.repeat(64));return {staged:true};}
};
const gateway=createBillingGatewayAuthorizer({firewall,outbox});
assert.equal(gateway.reserve(spec,{lease_id:'lease-1'}).lease_id,'lease-1');
const authorization=gateway.authorize(spec,'lease-1');
assert.deepEqual(calls,['reserve','intent','firewall','outbox']);
assert.equal(authorization.dispatch_token,'outbox-token');
assert.equal(authorization.spend_dispatch_token,'spend-token');
assert.equal(authorization.fencing_generation,1);
assert.equal(gateway.accept(spec,authorization,'request-1').status,'PROVIDER_ACCEPTED');
assert.equal(gateway.stage(spec,authorization,'request-1','a'.repeat(64)).staged,true);
assert.equal(gateway.markUnknown(spec,authorization,'TIMEOUT').status,'RECONCILIATION_REQUIRED');
assert.deepEqual(calls,['reserve','intent','firewall','outbox','accepted','staged','unknown']);
assert.throws(()=>gateway.stage({...spec,model:'tampered'},authorization,'request-1','a'.repeat(64)),error=>error.code==='BILLING_FENCE_REJECTED');

let transportCalls=0;
const broken=createBillingGatewayAuthorizer({firewall:{...firewall,authorizeDispatch(){throw Object.assign(new Error('hold'),{code:'GLOBAL_BILLING_HOLD'});}},outbox:{...outbox}});
assert.throws(()=>{const value=broken.authorize(spec,'lease-1');transportCalls+=1;return value;},error=>error.code==='GLOBAL_BILLING_HOLD');
assert.equal(transportCalls,0,'任一授權層失敗時不得觸及 transport');
assert.throws(()=>createBillingGatewayAuthorizer(),error=>error.code==='BILLING_GATEWAY_UNAVAILABLE');
console.log('BILLING_GATEWAY_AUTHORIZER_TESTS_OK');
