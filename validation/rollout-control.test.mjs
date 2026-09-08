import assert from 'node:assert/strict';
import { resolveFeatureRegistry, applyEffectiveFeatures, evaluateRollback, buildShadowReceipt, ROLLBACK_STOP_SIGNALS } from '../lib/rollout-control.mjs';

const legacy=resolveFeatureRegistry({account_quota_admission:{enabled:true},context_management:{compact_handoff:{enabled:true}},workflow_efficiency:{architecture_ir:{enabled:true}},rollout:{mode:'shadow'}});
assert.equal(legacy.ok,true); assert.equal(legacy.dispatch_allowed,false); assert.equal(legacy.features.quota_coordinator,true);
assert.equal(resolveFeatureRegistry({rollout:{features:{unknown_wave:true}}}).ok,false);
assert.equal(resolveFeatureRegistry({rollout:{features:{machine_preflight:false}}}).dispatch_allowed,false);
const conservativeCacheFallback=resolveFeatureRegistry({gate_efficiency:{artifact_hash_fast_pass:false},rollout:{mode:'active'}});
assert.equal(conservativeCacheFallback.ok,true,'關閉快取應回退為完整驗證，不得誤判為安全功能缺失');
assert.equal(conservativeCacheFallback.features.trusted_gate_cache,false);
assert.equal(conservativeCacheFallback.dispatch_allowed,true);
const hybridDefaults=resolveFeatureRegistry({rollout:{mode:'active'}});
assert.equal(hybridDefaults.features.hybrid_provider,false); assert.equal(hybridDefaults.features.openai_adapter,false); assert.equal(hybridDefaults.features.hybrid_routing,false);
const incompleteHybrid=resolveFeatureRegistry({rollout:{mode:'active',features:{openai_adapter:true}}}); assert.equal(incompleteHybrid.ok,false); assert.match(incompleteHybrid.issues.join('|'),/openai_adapter requires hybrid_provider/);
const completeHybrid=resolveFeatureRegistry({rollout:{mode:'active',features:{hybrid_provider:true,openai_adapter:true,hybrid_routing:true,quota_coordinator:true}}}); assert.equal(completeHybrid.ok,true);
assert.match(resolveFeatureRegistry({rollout:{features:{usage_ledger:false,quota_coordinator:true}}}).issues.join('|'),/FEATURE_DEPENDENCY_DISABLED/);
const overridden=applyEffectiveFeatures({account_quota_admission:{enabled:false},rollout:{features:{quota_coordinator:true}}},resolveFeatureRegistry({account_quota_admission:{enabled:false},rollout:{features:{quota_coordinator:true}}})); assert.equal(overridden.account_quota_admission.enabled,true,'registry 必須成為 effective feature 的單一控制面');
const requiredStopSignals=['gate_bypass','quality_bypass','approval_bypass','source_recheck_bypass','cache_provenance_invalid','state_unrecoverable','finding_revision_unknown','token_duplicate','quota_oversold','migration_non_idempotent','progress_without_evidence','legacy_death_test_failed','mutation_survived','machine_signature_redispatched','quality_regression'];
assert.deepEqual(ROLLBACK_STOP_SIGNALS,[...requiredStopSignals]);
for(const signal of requiredStopSignals){ const result=evaluateRollback({[signal]:true}); assert.equal(result.stop_required,true); assert.equal(result.dispatch_allowed,false); assert.ok(result.reasons.includes(signal)); }
const registry=resolveFeatureRegistry({rollout:{mode:'shadow'}}),input={project:'fixture',state:{input_revision:2,phase:'architecture'},featureRegistry:registry,baseline:{gate_pass:true,quality_pass:true},candidate:{gate_pass:true,quality_pass:true},controller_sha:'abc'};
const first=buildShadowReceipt(input),second=buildShadowReceipt(input); assert.equal(first.ok,true); assert.equal(first.receipt.dispatch_allowed,false); assert.equal(first.receipt.write_allowed,false); assert.equal(first.receipt.decision_sha256,second.receipt.decision_sha256,'同一 shadow 輸入必須產生穩定決策');
const regression=buildShadowReceipt({...input,candidate:{gate_pass:true,quality_pass:false}}); assert.equal(regression.ok,false); assert.ok(regression.receipt.rollback.reasons.includes('quality_regression'));
console.log('ROLLOUT_CONTROL_TESTS_OK');
