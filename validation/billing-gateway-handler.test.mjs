import assert from 'node:assert/strict';
import { createBillingGatewayCredentialAuthority } from '../lib/billing-gateway-credential.mjs';
import { billingGatewayRequestDigest,createBillingGatewayHandler } from '../lib/billing-gateway-handler.mjs';

const now=1000000,policy={schema_version:1,service_identity:'page-autodev-billing-gateway',credential:{mode:'workload_identity',expires_at_ms:now+300000,worker_readable:false},upstream:{origin:'https://api.openai.com',paths:['/v1/responses'],methods:['POST'],allow_redirects:false,retries:0,fallback:false},admin_plane:{enabled:false},listener:{transport:'unix',path:'/run/user/1000/page-autodev-billing-gateway.sock'}};
const authority=createBillingGatewayCredentialAuthority({secret:Buffer.alloc(32,9),clock:()=>now}),spec={invocation_id:'inv-1',idempotency_key:'idem-1',objective:'fixture'},lease='lease-1';
const token=authority.issue({invocation_id:spec.invocation_id,lease_id:lease,request_sha256:billingGatewayRequestDigest(spec)});let calls=0;
const handler=createBillingGatewayHandler({policy,credentialAuthority:authority,clock:()=>now,adapter:{async invoke(received,options){calls+=1;assert.deepEqual(received,spec);assert.equal(options.spend_lease_id,lease);return {outcome:'success'};}}});
const request={method:'POST',path:'/v1/dispatch',content_type:'application/json',body:Buffer.from(JSON.stringify({credential:token,spec,spend_lease_id:lease}))};
assert.equal((await handler(request)).outcome,'success');assert.equal(calls,1);
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
