import assert from 'node:assert/strict';
import { validateBillingRuntimeConfig } from '../lib/billing-runtime-config.mjs';

const now=Date.parse('2026-09-10T00:00:00Z'),base={
  price_registry:{version:1,currency:'USD',effective_at:'2026-09-09T00:00:00Z',expires_at:'2026-09-11T00:00:00Z',source:'operator-reviewed fixture',models:[{provider:'openai',model:'gpt-5.6-luna',uncached_input_microusd_per_million:1,cached_input_microusd_per_million:1,output_microusd_per_million:1,reasoning_microusd_per_million:1}]},
  capability_registry:{version:1,models:[{provider:'openai',model:'gpt-5.6-luna',snapshot:'fixture',capabilities:{structured_output:true,tool_loop:true,cancellation:true,usage_receipt:true,read_only:true,isolated_write:false}}]},
  billing_policy:{uncertainty_percent:20,work_unit_default:100,project:{fixture:{minute:100,fifteen_minutes:100,hour:100,day:100,month:100}},account:{minute:100,fifteen_minutes:100,hour:100,day:100,month:100},canary:{wave:100}},
  controller_credential_policy:{accepted_generations:['wave-b'],revoked_before_ms:0,max_ttl_ms:86400000}
};
assert.equal(validateBillingRuntimeConfig(base,{now_ms:now}).ok,true);
for(const mutate of [value=>value.price_registry.expires_at='2026-09-10T00:00:00Z',value=>value.billing_policy.account.month=0,value=>value.controller_credential_policy.accepted_generations=[],value=>value.controller_credential_policy.max_ttl_ms=2592000001,value=>value.capability_registry.models[0].model='unpriced']){const candidate=structuredClone(base);mutate(candidate);assert.throws(()=>validateBillingRuntimeConfig(candidate,{now_ms:now}),error=>error.code==='BILLING_RUNTIME_CONFIG_INVALID');}
console.log('BILLING_RUNTIME_CONFIG_TESTS_OK');
