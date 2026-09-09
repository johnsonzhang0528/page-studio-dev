import assert from 'node:assert/strict';
import { hasHighRiskSignal, selectModelRoute } from '../lib/model-router.mjs';

assert.equal(hasHighRiskSignal({text:'修正付款權限與 encryption migration'}),true);
assert.equal(hasHighRiskSignal({risk:'high',text:'普通文案'}),true);
assert.equal(hasHighRiskSignal({risk:'low',text:'調整一般映射'}),false);

const full=selectModelRoute({kind:'gate',verification_mode:'full',base_model:'sonnet'});
assert.equal(full.model,'opus'); assert.equal(full.reason_code,'FINAL_FULL_GATE');
const targeted=selectModelRoute({kind:'gate',verification_mode:'targeted',base_model:'opus',targeted_model:'sonnet',text:'一般映射修正'});
assert.equal(targeted.provider,'anthropic'); assert.equal(targeted.model,'sonnet'); assert.equal(targeted.reason_code,'TARGETED_LOW_RISK_RECHECK');
const luna=selectModelRoute({kind:'gate',verification_mode:'targeted',hybrid_enabled:true,text:'一般映射修正'});
assert.equal(luna.provider,'openai'); assert.equal(luna.model,'gpt-5.6-luna'); assert.equal(luna.verification_mode,'read_only'); assert.equal(luna.reason_code,'TARGETED_LOW_RISK_RECHECK_LUNA');
const security=selectModelRoute({kind:'gate',verification_mode:'targeted',base_model:'sonnet',text:'權限安全缺陷'});
assert.equal(security.provider,'anthropic'); assert.equal(security.model,'opus'); assert.equal(security.reason_code,'SURVIVING_HIGH_RISK_FINDING');
const implementation=selectModelRoute({kind:'implementation',base_model:'sonnet',risk:'critical'});
assert.equal(implementation.model,'opus'); assert.equal(implementation.reason_code,'HIGH_RISK_IMPLEMENTATION');
const noop=selectModelRoute({kind:'deterministic'});
assert.equal(noop.dispatch,false); assert.equal(noop.provider,null); assert.equal(noop.model,null); assert.equal(noop.reason_code,'DETERMINISTIC_NO_MODEL');
console.log('MODEL_ROUTER_TESTS_OK');
