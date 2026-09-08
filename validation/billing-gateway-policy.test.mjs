import assert from 'node:assert/strict';
import { validateBillingGatewayPolicy } from '../lib/billing-gateway-policy.mjs';

const now=1_000_000;
const valid={schema_version:1,service_identity:'page-autodev-billing-gateway',credential:{mode:'workload_identity',expires_at_ms:now+300000,worker_readable:false},upstream:{origin:'https://api.openai.com',paths:['/v1/responses'],methods:['POST'],allow_redirects:false,retries:0,fallback:false},admin_plane:{enabled:false},listener:{transport:'unix',path:'/run/user/1000/page-autodev-billing-gateway.sock'}};
assert.equal(validateBillingGatewayPolicy(valid,{now_ms:now}).service_identity,'page-autodev-billing-gateway');
for(const mutate of [
  value=>value.credential.expires_at_ms=now+900001,
  value=>value.credential.worker_readable=true,
  value=>value.upstream.origin='https://example.invalid',
  value=>value.upstream.paths.push('/v1/models'),
  value=>value.upstream.methods=['GET'],
  value=>value.upstream.allow_redirects=true,
  value=>value.upstream.retries=1,
  value=>value.upstream.fallback=true,
  value=>value.admin_plane.enabled=true,
  value=>value.listener.path='/tmp/gateway.sock'
]){
  const candidate=structuredClone(valid);mutate(candidate);
  assert.throws(()=>validateBillingGatewayPolicy(candidate,{now_ms:now}),error=>error.code==='BILLING_GATEWAY_POLICY_INVALID');
}
console.log('BILLING_GATEWAY_POLICY_TESTS_OK');
