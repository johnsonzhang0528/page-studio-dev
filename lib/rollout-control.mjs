import crypto from 'node:crypto';

export const ROLLOUT_SCHEMA_VERSION=1;
export const FEATURE_DEFINITIONS=Object.freeze({
  machine_preflight:{default:true,required:true,depends_on:[]},
  canonical_schema:{default:true,required:true,depends_on:['machine_preflight']},
  selective_invalidation:{default:true,depends_on:['canonical_schema']},
  usage_ledger:{default:true,depends_on:['machine_preflight']},
  quota_coordinator:{default:false,depends_on:['usage_ledger']},
  compact_handoff:{default:false,depends_on:['usage_ledger']},
  architecture_ir:{default:false,depends_on:['canonical_schema']},
  risk_tiered_routing:{default:true,depends_on:['usage_ledger']},
  bounded_findings:{default:true,depends_on:['canonical_schema']},
  trusted_gate_cache:{default:true,depends_on:['machine_preflight']},
  progress_metrics:{default:true,depends_on:['canonical_schema']},
  hybrid_provider:{default:false,depends_on:['canonical_schema','usage_ledger']},
  openai_adapter:{default:false,depends_on:['hybrid_provider']},
  hybrid_routing:{default:false,depends_on:['openai_adapter','risk_tiered_routing','quota_coordinator']}
});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const bool=(value,fallback)=>typeof value==='boolean'?value:fallback;

function legacyFlags(config={}){ return {
  quota_coordinator:config.account_quota_admission?.enabled,
  compact_handoff:config.context_management?.compact_handoff?.enabled,
  architecture_ir:config.workflow_efficiency?.architecture_ir?.enabled,
  trusted_gate_cache:config.gate_efficiency?.artifact_hash_fast_pass===false?false:undefined
}; }

export function resolveFeatureRegistry(config={}){
  const explicit=config.rollout?.features??{},legacy=legacyFlags(config),issues=[];
  for(const name of Object.keys(explicit)) if(!FEATURE_DEFINITIONS[name]) issues.push(`UNKNOWN_FEATURE_FLAG：${name}`);
  const features={}; for(const [name,definition] of Object.entries(FEATURE_DEFINITIONS)) features[name]=bool(explicit[name],bool(legacy[name],definition.default));
  for(const [name,definition] of Object.entries(FEATURE_DEFINITIONS)){
    if(definition.required&&!features[name]) issues.push(`REQUIRED_SAFETY_FEATURE_DISABLED：${name}`);
    if(features[name]) for(const dependency of definition.depends_on) if(!features[dependency]) issues.push(`FEATURE_DEPENDENCY_DISABLED：${name} requires ${dependency}`);
  }
  const mode=config.rollout?.mode??'off'; if(!['off','shadow','canary','active'].includes(mode)) issues.push(`INVALID_ROLLOUT_MODE：${mode}`);
  return {schema_version:ROLLOUT_SCHEMA_VERSION,mode,features,ok:issues.length===0,dispatch_allowed:issues.length===0&&mode!=='shadow',issues,fingerprint:digest({mode,features})};
}

export function applyEffectiveFeatures(config={},registry=resolveFeatureRegistry(config)){
  const effective=structuredClone(config); effective.account_quota_admission??={}; effective.account_quota_admission.enabled=registry.features.quota_coordinator;
  effective.context_management??={}; effective.context_management.compact_handoff??={}; effective.context_management.compact_handoff.enabled=registry.features.compact_handoff;
  effective.workflow_efficiency??={}; effective.workflow_efficiency.architecture_ir??={}; effective.workflow_efficiency.architecture_ir.enabled=registry.features.architecture_ir;
  effective.gate_efficiency??={}; effective.gate_efficiency.artifact_hash_fast_pass=registry.features.trusted_gate_cache;
  effective.rollout_effective={schema_version:registry.schema_version,mode:registry.mode,feature_fingerprint:registry.fingerprint,features:registry.features}; return effective;
}

export const ROLLBACK_STOP_SIGNALS=Object.freeze(['gate_bypass','quality_bypass','approval_bypass','source_recheck_bypass','cache_provenance_invalid','state_unrecoverable','finding_revision_unknown','token_duplicate','quota_oversold','migration_non_idempotent','progress_without_evidence','legacy_death_test_failed','mutation_survived','machine_signature_redispatched','quality_regression']);
export function evaluateRollback(signals={}){
  const reasons=ROLLBACK_STOP_SIGNALS.filter(name=>signals[name]===true),unknown=Object.keys(signals).filter(name=>!ROLLBACK_STOP_SIGNALS.includes(name));
  if(unknown.length) reasons.push(...unknown.map(name=>`unknown_signal:${name}`));
  return {stop_required:reasons.length>0,dispatch_allowed:reasons.length===0,reasons,action:reasons.length?'disable_current_wave_and_reconcile':'continue'};
}

export function buildShadowReceipt({project,state={},featureRegistry,baseline={},candidate={},rollbackSignals={},controller_sha=null,at=null}={}){
  if(!featureRegistry?.ok) return {ok:false,dispatch_allowed:false,issues:featureRegistry?.issues??['FEATURE_REGISTRY_MISSING']};
  const rollback=evaluateRollback(rollbackSignals),qualityKeys=['gate_pass','quality_pass','approval_current','source_current'],qualityRegression=qualityKeys.some(key=>baseline[key]===true&&candidate[key]!==true),effectiveRollback=qualityRegression?evaluateRollback({...rollbackSignals,quality_regression:true}):rollback;
  const decision={schema_version:ROLLOUT_SCHEMA_VERSION,project,mode:'shadow',input_revision:Number(state.input_revision??0),phase:state.phase??null,controller_sha,feature_fingerprint:featureRegistry.fingerprint,baseline:stable(baseline),candidate:stable(candidate),rollback:effectiveRollback,dispatch_allowed:false,write_allowed:false};
  return {ok:!effectiveRollback.stop_required,receipt:{...decision,decision_sha256:digest(decision),...(at?{evaluated_at:at}:{})}};
}
