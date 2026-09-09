import assert from 'node:assert/strict';
import { createBillingGatewayCredentialAuthority } from '../lib/billing-gateway-credential.mjs';
import { billingGatewayRequestDigest,createBillingGatewayHandler } from '../lib/billing-gateway-handler.mjs';

const now=1000000,policy={schema_version:1,service_identity:'page-autodev-billing-gateway',credential:{mode:'workload_identity',expires_at_ms:now+300000,worker_readable:false},upstream:{origin:'https://api.openai.com',paths:['/v1/responses'],methods:['POST'],allow_redirects:false,retries:0,fallback:false},admin_plane:{enabled:false},listener:{transport:'unix',path:'/run/user/1000/page-autodev-billing-gateway.sock'}};
const authority=createBillingGatewayCredentialAuthority({secret:Buffer.alloc(32,9),clock:()=>now}),spec={invocation_id:'inv-1',idempotency_key:'idem-1',objective:'fixture'},lease='lease-1';
const token=authority.issue({invocation_id:spec.invocation_id,lease_id:lease,request_sha256:billingGatewayRequestDigest(spec)});let calls=0;
const handler=createBillingGatewayHandler({policy,credentialAuthority:authority,clock:()=>now,adapter:{async invoke(received,options){calls+=1;assert.deepEqual(received,spec);assert.equal(options.spend_lease_id,lease);return {outcome:'success'};}}});
const request={method:'POST',path:'/v1/dispatch',content_type:'application/json',body:Buffer.from(JSON.stringify({credential:token,spec,spend_lease_id:lease}))};
assert.equal((await handler(request)).outcome,'success');assert.equal(calls,1);
const reserveSpec={invocation_id:'inv-reserve',idempotency_key:'idem-reserve',objective:'fixture'},reserveClaims={invocation_id:reserveSpec.invocation_id,request_sha256:billingGatewayRequestDigest(reserveSpec),work_unit_budget_id:'unit-1',priority:'P2',canary_wave:'wave-a'},reserveToken=authority.issueReservation(reserveClaims),reserved=[];
const control=createBillingGatewayHandler({policy,credentialAuthority:authority,clock:()=>now,billingAuthorizer:{reserve(received,options){reserved.push({received,options});return {lease_id:'lease-reserved',reserved_microusd:10};}},adapter:{async invoke(){return {outcome:'success'};}}});
const admission=await control({method:'POST',path:'/v1/reserve',content_type:'application/json',body:Buffer.from(JSON.stringify({credential:reserveToken,spec:reserveSpec,work_unit_budget_id:'unit-1',priority:'P2',canary_wave:'wave-a'}))});
assert.equal(admission.reservation.lease_id,'lease-reserved');assert.equal(typeof admission.credential,'string');assert.equal(reserved.length,1);
authority.consume(admission.credential,{invocation_id:reserveSpec.invocation_id,lease_id:'lease-reserved',request_sha256:billingGatewayRequestDigest(reserveSpec)});
for(const candidate of [
  {...request,method:'GET'},
  {...request,path:'/v1/models'},
  {...request,content_type:'text/plain'},
  {...request,body:Buffer.from('{')},
  {...request,body:Buffer.alloc(262145)},
  {...request,body:Buffer.from(JSON.stringify({credential:token,spec,spend_lease_id:lease,base_url:'https://evil.invalid'}))}
])await assert.rejects(handler(candidate),error=>error.code==='BILLING_GATEWAY_REQUEST_DENIED');
assert.equal(calls,1,'被拒絕的請求不得觸及 adapter/Provider transport');
console.log('BILLING_GATEWAY_HANDLER_TESTS_OK');
