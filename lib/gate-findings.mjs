import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalizeRepairOwnership } from './architecture-model.mjs';

const VERSION=1;
const STATES=new Set(['open','repairing','verifying','closed','reopened','stale']);
const TRANSITIONS={open:new Set(['repairing','closed','stale']),repairing:new Set(['verifying','closed','reopened','stale']),verifying:new Set(['closed','reopened','stale']),closed:new Set(['reopened','stale']),reopened:new Set(['repairing','closed','stale']),stale:new Set(['reopened','closed'])};
const normalize=value=>String(value??'').toLowerCase().replace(/\s+/g,' ').replace(/[0-9a-f]{7,64}/g,'#').trim();
const hash=value=>crypto.createHash('sha256').update(value).digest('hex').slice(0,20);
const now=()=>new Date().toISOString();
export const findingsPath=project=>path.join(project,'.ai','GATE_FINDINGS.json');
export function normalizeStringList(value){
  const pending=Array.isArray(value)?[...value]:value==null?[]:[value],normalized=[];
  while(pending.length){
    const item=pending.shift();
    if(Array.isArray(item)){ pending.unshift(...item); continue; }
    if(typeof item!=='string') continue;
    const text=item.trim(); if(text) normalized.push(text);
  }
  return normalized;
}
function normalizeFinding(item={}){
  // Earlier recovery/release-risk tools emitted terminal aliases that were
  // never part of the state machine. Canonicalize them before validation.
  if(item.status==='resolved'||item.status==='deferred') item.status='closed';
  item.source_files=normalizeStringList(item.source_files);
  item.repair_targets=normalizeStringList(item.repair_targets);
  item.repair_plan=normalizeStringList(item.repair_plan);
  item.acceptance_check=normalizeStringList(item.acceptance_check);
  if(!Array.isArray(item.strategies)) item.strategies=[];
  return item;
}

export function loadFindings(project){
  const file=findingsPath(project); if(!fs.existsSync(file)) return {schema_version:VERSION,revision:0,findings:[]};
  const store=JSON.parse(fs.readFileSync(file,'utf8')); if(Array.isArray(store.findings)) store.findings.forEach(normalizeFinding); validateStore(store); return store;
}
export function validateStore(store){
  if(store?.schema_version!==VERSION||!Array.isArray(store.findings)) throw new Error('GATE_FINDINGS.json schema 無效');
  const ids=new Set(); for(const item of store.findings){ if(!item.id||ids.has(item.id)||!STATES.has(item.status)||!Array.isArray(item.repair_targets)||!Array.isArray(item.repair_plan)||!Array.isArray(item.acceptance_check)||!Array.isArray(item.source_files)) throw new Error(`finding 無效：${item.id??'unknown'}`); ids.add(item.id); }
  return true;
}
export function saveFindings(project,store){
  validateStore(store); store.revision=Number(store.revision??0)+1; store.updated_at=now();
  const file=findingsPath(project),tmp=`${file}.tmp-${process.pid}`; fs.writeFileSync(tmp,`${JSON.stringify(store,null,2)}\n`,{mode:0o600}); fs.renameSync(tmp,file);
}
export function transitionFinding(item,next,evidence=null){
  if(!TRANSITIONS[item.status]?.has(next)) throw new Error(`finding 狀態不可由 ${item.status} 轉為 ${next}`);
  item.status=next; item.updated_at=now(); if(evidence) item.last_evidence=evidence; return item;
}
export function findingFingerprint(gatePhase,unitId,finding){
  return hash([gatePhase,unitId,finding.category,finding.title??finding.summary,finding.source_files?.slice().sort().join('|')].map(normalize).join('::'));
}
export function upsertGateFindings(project,{gatePhase,unitId,verdict,inputRevision=0}){
  const store=loadFindings(project),raw=Array.isArray(verdict.findings)&&verdict.findings.length?verdict.findings:[{severity:'blocker',title:verdict.summary,summary:verdict.summary,repair_targets:verdict.repair_targets??[],repair_plan:verdict.repair_plan??[],acceptance_check:verdict.acceptance_check??[]}];
  const touched=[];
  for(const finding of raw){
    normalizeFinding(finding);
    const fingerprint=findingFingerprint(gatePhase,unitId,finding),existing=store.findings.find(item=>item.fingerprint===fingerprint);
    if(existing){
      const newRevision=Number(existing.input_revision??0)!==Number(inputRevision??0);
      existing.occurrences=Number(existing.occurrences??1)+1; existing.last_seen_at=now(); existing.updated_at=now();
      existing.input_revision=inputRevision; existing.gate_phase=gatePhase; existing.gate_unit=unitId;
      existing.severity=finding.severity??existing.severity; existing.category=finding.category??existing.category;
      existing.title=finding.title??finding.summary??existing.title; existing.summary=finding.summary??finding.title??existing.summary;
      existing.source_files=finding.source_files??existing.source_files??[]; existing.repair_targets=finding.repair_targets??existing.repair_targets;
      existing.repair_plan=finding.repair_plan??existing.repair_plan??[]; existing.acceptance_check=finding.acceptance_check??existing.acceptance_check;
      if(newRevision) existing.status='open'; else if(['closed','verifying','stale'].includes(existing.status)) transitionFinding(existing,'reopened','Gate 再次偵測到相同缺陷');
      touched.push(existing); continue;
    }
    const item={id:`GF-${fingerprint.slice(0,10).toUpperCase()}`,fingerprint,gate_phase:gatePhase,gate_unit:unitId,input_revision:inputRevision,status:'open',severity:finding.severity??'blocker',category:finding.category??'unspecified',title:finding.title??finding.summary??verdict.summary,summary:finding.summary??finding.title??verdict.summary,source_files:finding.source_files??[],repair_targets:finding.repair_targets??verdict.repair_targets??[],repair_plan:finding.repair_plan??[],acceptance_check:finding.acceptance_check??[],occurrences:1,strategies:[],created_at:now(),last_seen_at:now(),updated_at:now()}; store.findings.push(item); touched.push(item);
  }
  saveFindings(project,store); return {store,touched};
}
/**
 * 修復範圍解析。安全額度只計 semantic_repair_targets：
 * derived BUILD／VERIFY／FREEZE／EVIDENCE-SYNC 必須失效重跑，但它們不是缺陷擁有者，
 * 不得占用 semantic quota（先折疊再展開正是假熔斷的根因）。
 */
export function resolveRepairTargets({suggested=[],plan,maxFraction=0.4}){
  const valid=plan.units.map(unit=>unit.id),validSet=new Set(valid),rejected=[];
  const accepted=[];
  for(const id of suggested){ if(validSet.has(id)) accepted.push(id); else rejected.push(id); }
  const canonical=canonicalizeRepairOwnership(accepted,{valid});
  const semantic=canonical.semantic_repair_targets;
  const proportional=Math.ceil(plan.units.length*maxFraction);
  const limit=Math.min(plan.units.length,Math.max(plan.units.length>1?2:1,proportional));
  return {
    targets:semantic,
    semantic_repair_targets:semantic,
    deterministic_repair_actions:canonical.deterministic_repair_actions,
    derived_invalidations:canonical.derived_invalidations,
    raw_repair_targets:canonical.raw_repair_targets,
    rejected,limit,
    over_scope:semantic.length>limit,
    empty:semantic.length===0&&canonical.deterministic_repair_actions.length===0
  };
}
export function beginRepair(store,ids,strategy=null){
  for(const item of store.findings.filter(f=>ids.includes(f.id))){ if(['open','reopened'].includes(item.status)) transitionFinding(item,'repairing'); if(strategy) item.strategies.push({...strategy,at:now()}); }
}
export function beginVerification(store,ids){ for(const item of store.findings.filter(f=>ids.includes(f.id)&&f.status==='repairing')) transitionFinding(item,'verifying'); }
export function finishVerification(store,results){
  for(const result of results){ const item=store.findings.find(f=>f.id===result.id); if(!item||item.status!=='verifying') continue; transitionFinding(item,result.pass?'closed':'reopened',result.evidence); }
}
export function finalizeGateFindings(store,{gatePhase,inputRevision=0,evidence='最終完整 Gate 通過'}){
  const summary={closed:0,stale:0,unchanged:0};
  for(const item of store.findings.filter(f=>f.gate_phase===gatePhase)){
    if(Number(item.input_revision??0)!==Number(inputRevision??0)){
      if(item.status!=='stale'){ transitionFinding(item,'stale','已由較新的輸入 revision 與最終 Gate 取代'); summary.stale++; } else summary.unchanged++;
      continue;
    }
    if(['open','repairing','verifying','reopened','stale'].includes(item.status)){ transitionFinding(item,'closed',evidence); summary.closed++; }
    else summary.unchanged++;
  }
  return summary;
}
export function needsReflection(item){ return Number(item.occurrences??1)>=2||Number(item.strategies?.length??0)>=1; }
export function validateReflection(reflection,previous){
  const verification=Array.isArray(reflection?.verification)?reflection.verification.filter(Boolean):typeof reflection?.verification==='string'&&reflection.verification.trim()?[reflection.verification.trim()]:[];
  const files=Array.isArray(reflection?.files_to_change)?reflection.files_to_change.filter(Boolean):typeof reflection?.files_to_change==='string'&&reflection.files_to_change.trim()?[reflection.files_to_change.trim()]:[];
  if(!reflection?.root_cause||!reflection?.new_strategy||!reflection?.difference_from_previous||verification.length===0) return {ok:false,reason:'策略反思欄位不完整'};
  const normalizedReflection={...reflection,files_to_change:files,verification},same=normalize(normalizedReflection.new_strategy)===normalize(previous?.new_strategy)&&normalize(normalizedReflection.difference_from_previous).length<20;
  return same?{ok:false,reason:'新策略與前次沒有可驗證差異'}:{ok:true,reflection:normalizedReflection};
}
