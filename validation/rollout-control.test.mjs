import assert from 'node:assert/strict';
import { resolveFeatureRegistry, applyEffectiveFeatures, evaluateRollback, buildShadowReceipt } from '../lib/rollout-control.mjs';

const legacy=resolveFeatureRegistry({account_quota_admission:{enabled:true},context_management:{compact_handoff:{enabled:true}},workflow_efficiency:{architecture_ir:{enabled:true}},rollout:{mode:'shadow'}});
assert.equal(legacy.ok,true); assert.equal(legacy.dispatch_allowed,false); assert.equal(legacy.features.quota_coordinator,true);
assert.equal(resolveFeatureRegistry({rollout:{features:{unknown_wave:true}}}).ok,false);
assert.equal(resolveFeatureRegistry({rollout:{features:{machine_preflight:false}}}).dispatch_allowed,false);
const conservativeCacheFallback=resolveFeatureRegistry({gate_efficiency:{artifact_hash_fast_pass:false},rollout:{mode:'active'}});
assert.equal(conservativeCacheFallback.ok,true,'關閉快取應回退為完整驗證，不得誤判為安全功能缺失');
assert.equal(conservativeCacheFallback.features.trusted_gate_cache,false);
assert.equal(conservativeCacheFallback.dispatch_allowed,true);
assert.match(resolveFeatureRegistry({rollout:{features:{usage_ledger:false,quota_coordinator:true}}}).issues.join('|'),/FEATURE_DEPENDENCY_DISABLED/);
const overridden=applyEffectiveFeatures({account_quota_admission:{enabled:false},rollout:{features:{quota_coordinator:true}}},resolveFeatureRegistry({account_quota_admission:{enabled:false},rollout:{features:{quota_coordinator:true}}})); assert.equal(overridden.account_quota_admission.enabled,true,'registry 必須成為 effective feature 的單一控制面');
for(const signal of ['gate_bypass','quota_oversold','legacy_death_test_failed','progress_without_evidence']){ const result=evaluateRollback({[signal]:true}); assert.equal(result.stop_required,true); assert.ok(result.reasons.includes(signal)); }
const registry=resolveFeatureRegistry({rollout:{mode:'shadow'}}),input={project:'fixture',state:{input_revision:2,phase:'architecture'},featureRegistry:registry,baseline:{gate_pass:true,quality_pass:true},candidate:{gate_pass:true,quality_pass:true},controller_sha:'abc'};
const first=buildShadowReceipt(input),second=buildShadowReceipt(input); assert.equal(first.ok,true); assert.equal(first.receipt.dispatch_allowed,false); assert.equal(first.receipt.write_allowed,false); assert.equal(first.receipt.decision_sha256,second.receipt.decision_sha256,'同一 shadow 輸入必須產生穩定決策');
const regression=buildShadowReceipt({...input,candidate:{gate_pass:true,quality_pass:false}}); assert.equal(regression.ok,false); assert.ok(regression.receipt.rollback.reasons.includes('quality_regression'));
console.log('ROLLOUT_CONTROL_TESTS_OK');
