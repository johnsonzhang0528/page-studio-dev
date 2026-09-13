import assert from 'node:assert/strict';
import { evaluateShadowValidation,DEFAULT_SHADOW_POLICY } from '../lib/shadow-rollout-validation.mjs';

const make=(case_id,overrides={})=>({case_id,transport:'fake_provider',network_calls:0,outcome:'pass',actual_cost_microusd:0,wall_ms:5,baseline_quality_pass:true,candidate_quality_pass:true,rollback:{stop_required:false},...overrides});
const valid=DEFAULT_SHADOW_POLICY.required_cases.map(id=>make(id,{outcome:id==='provider_rejection'||id==='timeout'?'expected_failure':'pass'}));
const first=evaluateShadowValidation(valid,{controller_sha:'abc'}),second=evaluateShadowValidation(valid,{controller_sha:'abc'});
assert.equal(first.ok,true);assert.equal(first.promotion_eligible,true);assert.equal(first.dispatch_allowed,false);assert.equal(first.write_allowed,false);assert.equal(first.receipt.total_cost_microusd,0);assert.equal(first.receipt.network_calls,0);assert.equal(first.receipt.decision_sha256,second.receipt.decision_sha256);
assert.throws(()=>evaluateShadowValidation([...valid,valid[0]]),/SHADOW_DUPLICATE_CASE/);console.log('DEATH_EVIDENCE DT-093 duplicate_shadow_case');
let result=evaluateShadowValidation(valid.slice(1));assert.equal(result.ok,false);assert.ok(result.receipt.issues.some(value=>value.startsWith('REQUIRED_CASE_MISSING')));console.log('DEATH_EVIDENCE DT-094 missing_required_shadow_case');
result=evaluateShadowValidation(valid.map((item,index)=>index?item:{...item,transport:'openai',network_calls:1}));assert.equal(result.ok,false);assert.ok(result.receipt.issues.some(value=>value.startsWith('LIVE_NETWORK_FORBIDDEN')));console.log('DEATH_EVIDENCE DT-095 live_network_escape');
result=evaluateShadowValidation(valid.map((item,index)=>index?item:{...item,actual_cost_microusd:1}));assert.equal(result.ok,false);assert.ok(result.receipt.issues.includes('SHADOW_COST_EXCEEDED'));console.log('DEATH_EVIDENCE DT-096 shadow_cost_nonzero');
result=evaluateShadowValidation(valid.map(item=>({...item,outcome:'expected_failure'})));assert.equal(result.ok,false);assert.ok(result.receipt.issues.includes('FAILURE_RATE_EXCEEDED'));console.log('DEATH_EVIDENCE DT-097 failure_rate_exceeded');
result=evaluateShadowValidation(valid.map((item,index)=>index?item:{...item,rollback:{stop_required:true}}));assert.equal(result.ok,false);assert.ok(result.receipt.issues.some(value=>value.startsWith('ROLLBACK_SIGNAL')));console.log('DEATH_EVIDENCE DT-098 rollback_signal');
result=evaluateShadowValidation(valid.map((item,index)=>index?item:{...item,candidate_quality_pass:false}));assert.equal(result.ok,false);assert.ok(result.receipt.issues.some(value=>value.startsWith('QUALITY_REGRESSION')));console.log('DEATH_EVIDENCE DT-099 quality_regression');
result=evaluateShadowValidation(valid.map((item,index)=>index?item:{...item,wall_ms:120001}));assert.equal(result.ok,false);assert.ok(result.receipt.issues.includes('P95_WALL_EXCEEDED'));console.log('DEATH_EVIDENCE DT-100 p95_wall_exceeded');
console.log('SHADOW_ROLLOUT_VALIDATION_TESTS_OK cases=8');
