import assert from 'node:assert/strict';
import { createBillingGatewayCredentialAuthority } from '../lib/billing-gateway-credential.mjs';

let now=1000000;const secret=Buffer.alloc(32,7),claims={invocation_id:'inv-1',lease_id:'lease-1',request_sha256:'a'.repeat(64)};
const authority=createBillingGatewayCredentialAuthority({secret,clock:()=>now});
const token=authority.issue({...claims,ttl_ms:60000});
assert.equal(authority.consume(token,claims).invocation_id,'inv-1');
assert.throws(()=>authority.consume(token,claims),error=>error.code==='BILLING_GATEWAY_CREDENTIAL_DENIED');
const scoped=authority.issue(claims);
assert.throws(()=>authority.consume(scoped,{...claims,lease_id:'lease-2'}),error=>error.code==='BILLING_GATEWAY_CREDENTIAL_DENIED');
const expired=authority.issue({...claims,ttl_ms:1000});now+=1001;
assert.throws(()=>authority.consume(expired,claims),error=>error.code==='BILLING_GATEWAY_CREDENTIAL_DENIED');
assert.throws(()=>createBillingGatewayCredentialAuthority({secret:'weak'}),error=>error.code==='BILLING_GATEWAY_CONFIG_INVALID');
assert.throws(()=>authority.issue({...claims,ttl_ms:900001}),error=>error.code==='BILLING_GATEWAY_CREDENTIAL_DENIED');
const tampered=`${token.slice(0,-1)}${token.endsWith('a')?'b':'a'}`;
assert.throws(()=>authority.consume(tampered,claims),error=>error.code==='BILLING_GATEWAY_CREDENTIAL_DENIED');
console.log('BILLING_GATEWAY_CREDENTIAL_TESTS_OK');
