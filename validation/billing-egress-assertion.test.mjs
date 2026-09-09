import assert from 'node:assert/strict';
import { createBillingEgressAssertionAuthority } from '../lib/billing-egress-assertion.mjs';

let now=1000000;const authority=createBillingEgressAssertionAuthority({secret:Buffer.alloc(32,7),clock:()=>now}),scope={request_id:'request-1',body_sha256:'a'.repeat(64),model_snapshot:'approved-snapshot'};
const token=authority.issue(scope);assert.equal(authority.consume(token,scope).ok,true);
assert.throws(()=>authority.consume(token,scope),error=>error.code==='BILLING_EGRESS_ASSERTION_DENIED');
const tampered=authority.issue(scope);assert.throws(()=>authority.consume(tampered,{...scope,model_snapshot:'other'}),error=>error.code==='BILLING_EGRESS_ASSERTION_DENIED');
const expired=authority.issue({...scope,ttl_ms:1000});now+=1001;assert.throws(()=>authority.consume(expired,scope),error=>error.code==='BILLING_EGRESS_ASSERTION_DENIED');
assert.throws(()=>createBillingEgressAssertionAuthority({secret:'weak'}),error=>error.code==='BILLING_EGRESS_CONFIG_INVALID');
console.log('BILLING_EGRESS_ASSERTION_TESTS_OK');
