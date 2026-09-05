import crypto from 'node:crypto';

// Diagram family 的唯一 Source of Truth。autodev.mjs 與 gate-findings.mjs 都必須從這裡取用，
// 不得各自維護可能漂移的 family 行為。
export const DIAGRAM_FAMILIES=Object.freeze({
  SYSTEM:{spec:'ARCH-SYSTEM-SPEC',build:'ARCH-SYSTEM-BUILD',verify:'ARCH-SYSTEM-VERIFY'},
  WORKFLOW:{spec:'ARCH-WORKFLOW-SPEC',build:'ARCH-WORKFLOW-BUILD',verify:'ARCH-WORKFLOW-VERIFY'},
  LIFECYCLE:{spec:'ARCH-LIFECYCLE-SPEC',build:'ARCH-LIFECYCLE-BUILD',verify:'ARCH-LIFECYCLE-VERIFY'},
  DATAFLOW:{spec:'ARCH-DATAFLOW-SPEC',build:'ARCH-DATAFLOW-BUILD',verify:'ARCH-DATAFLOW-VERIFY'}
});
export const SEMANTIC_FREEZE_UNIT='ARCH-SPEC-FREEZE';
export const EVIDENCE_SYNC_UNIT='ARCH-EVIDENCE-SYNC';
export const EXECUTION_MODES=Object.freeze({agentWrite:'agent_write',reviewerReadonly:'reviewer_readonly',machine:'machine'});

const FAMILY_BY_SPEC=new Map(Object.values(DIAGRAM_FAMILIES).map(family=>[family.spec,family]));
const FAMILY_BY_DERIVED=new Map(Object.values(DIAGRAM_FAMILIES).flatMap(family=>[[family.build,family],[family.verify,family]]));

export const isDerivedDiagramUnit=id=>FAMILY_BY_DERIVED.has(String(id??''));
export const diagramFamilyForUnit=id=>FAMILY_BY_SPEC.get(String(id??''))??FAMILY_BY_DERIVED.get(String(id??''))??null;

// 語意修復擁有者：需要 reasoning、消耗 semantic safety quota。
export const SEMANTIC_REPAIR_UNITS=Object.freeze([
  'ARCH-FOUNDATION','ARCH-ADR',
  ...Object.values(DIAGRAM_FAMILIES).map(family=>family.spec)
]);
// Deterministic 修復動作：真正的 corrective action，但不需要 Claude、不消耗 semantic quota。
export const DETERMINISTIC_REPAIR_UNITS=Object.freeze([
  ...Object.values(DIAGRAM_FAMILIES).flatMap(family=>[family.build,family.verify]),
  EVIDENCE_SYNC_UNIT
]);

export function executionModeFor(id){
  const unit=String(id??'');
  if(unit===SEMANTIC_FREEZE_UNIT||/^ARCH-GATE-/.test(unit)) return EXECUTION_MODES.reviewerReadonly;
  if(DETERMINISTIC_REPAIR_UNITS.includes(unit)) return EXECUTION_MODES.machine;
  if(SEMANTIC_REPAIR_UNITS.includes(unit)) return EXECUTION_MODES.agentWrite;
  return EXECUTION_MODES.agentWrite;
}
export const isMachineUnit=id=>executionModeFor(id)===EXECUTION_MODES.machine;

// 把 derived BUILD/VERIFY 收斂到其 SPEC 擁有者。與 deriveDiagramInvalidations 互為反向，
// 絕不可在計算 quota 之後又重新展開（那正是假熔斷的根因）。
export function collapseDiagramRepairTargets(ids=[],{valid=null}={}){
  const known=valid?new Set(valid):null;
  const out=new Set();
  for(const raw of ids){
    const id=String(raw??''); if(!id) continue;
    const family=FAMILY_BY_DERIVED.get(id);
    const canonical=family?family.spec:id;
    if(!known||known.has(canonical)) out.add(canonical);
    else if(!known.has(canonical)&&known.has(id)) out.add(id);
  }
  return [...out];
}

// 上游 semantic 改變後必須重跑、但不是 defect owner 的單元。
export function deriveDiagramInvalidations(semanticTargets=[],{valid=null}={}){
  const known=valid?new Set(valid):null;
  const out=new Set();
  const admit=id=>{ if(id&&(!known||known.has(id))) out.add(id); };
  const targets=semanticTargets.map(id=>String(id??''));
  const touchesSemantic=targets.some(id=>SEMANTIC_REPAIR_UNITS.includes(id));
  for(const id of targets){
    const family=FAMILY_BY_SPEC.get(id);
    if(!family) continue;
    admit(family.build); admit(family.verify);
  }
  // 任一 semantic owner（含 FOUNDATION／ADR）改變都會使既有 Semantic Freeze 失效。
  if(touchesSemantic){ admit(SEMANTIC_FREEZE_UNIT); admit(EVIDENCE_SYNC_UNIT); }
  return [...out].filter(id=>!targets.includes(id));
}

// Deterministic repair action：finding 指名 BUILD/VERIFY/EVIDENCE-SYNC 時保留為機器動作，
// 但不會因此吃掉 semantic quota。
export function deriveDeterministicRepairActions(rawIds=[],{valid=null}={}){
  const known=valid?new Set(valid):null;
  const out=new Set();
  for(const raw of rawIds){
    const id=String(raw??'');
    if(!DETERMINISTIC_REPAIR_UNITS.includes(id)) continue;
    if(!known||known.has(id)) out.add(id);
  }
  return [...out];
}

// 單筆 finding 的 canonical 修復擁有權。aggregate collapse 不足以取代這一層。
export function canonicalizeRepairOwnership(rawTargets=[],{valid=null}={}){
  const raw=[...new Set(rawTargets.map(id=>String(id??'')).filter(Boolean))];
  const semantic=collapseDiagramRepairTargets(raw,{valid}).filter(id=>!DETERMINISTIC_REPAIR_UNITS.includes(id));
  // 衍生失效優先於 deterministic action：若上游 SPEC 本輪就要重修，其 BUILD/VERIFY 必須整代失效重跑，
  // 而不是被當成可獨立執行的機器修復動作（否則會沿用 stale artifact）。
  const derived=deriveDiagramInvalidations(semantic,{valid});
  const deterministic=deriveDeterministicRepairActions(raw,{valid}).filter(id=>!derived.includes(id));
  return {raw_repair_targets:raw,semantic_repair_targets:semantic,deterministic_repair_actions:deterministic,derived_invalidations:derived};
}

// 當代執行證據必須與 pending 狀態同代；保留累積型 audit/safety counter。
export const DERIVED_INVALIDATION_CLEARED_FIELDS=Object.freeze([
  'session_id','completed_at','last_summary','evidence','after_snapshot','before_snapshot',
  'files_changed','last_terminal_reason','machine_feedback','repair_source','finding_ids',
  'started_at','cache_hit','blocked_reason','circuit_reason'
]);
export const DERIVED_INVALIDATION_PRESERVED_FIELDS=Object.freeze([
  'created_at','lifetime_continuations','layout_repair_attempts','lifetime_attempts','recovered_from_continuation_limit','reviewer_reset_reason'
]);

export function invalidateDerivedWorkUnit(unit,{reason=null,at=new Date().toISOString()}={}){
  if(!unit||typeof unit!=='object') return unit;
  for(const field of DERIVED_INVALIDATION_CLEARED_FIELDS) delete unit[field];
  // attempt 同時是 safety fuse：累積至 lifetime_attempts 後才重置當代計數，不可被 invalidation 洗掉。
  const priorAttempt=Number(unit.attempt??0);
  if(priorAttempt>0) unit.lifetime_attempts=(Number(unit.lifetime_attempts??0))+priorAttempt;
  const priorContinuations=Number(unit.continuations??0);
  if(priorContinuations>0) unit.lifetime_continuations=(Number(unit.lifetime_continuations??0))+priorContinuations;
  unit.attempt=0; unit.continuations=0; unit.no_progress_count=0;
  unit.status='pending';
  if(reason) unit.invalidation_reason=reason;
  unit.updated_at=at;
  return unit;
}

export const hashCanonical=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
