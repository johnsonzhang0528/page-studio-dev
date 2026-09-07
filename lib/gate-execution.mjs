import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJson } from './transactions.mjs';
import { sha256 } from './visual-policy.mjs';
import { adjudicateFindings, machineInjectedFindings, effectiveOutcome, DISPOSITIONS, RULE_IDS } from './finding-adjudication.mjs';
import { canonicalizeRepairOwnership } from './architecture-model.mjs';
import { DIAGRAMS, diagramPaths, archifyEvidencePath, readSemanticFreeze, readApproval, policyBundleFingerprint } from './architecture-provenance.mjs';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileSha=file=>{ try{ return sha256(fs.readFileSync(file)); }catch{ return null; } };
const deliveryExcluded=relative=>/(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)/.test(relative)||/^\.ai\/(runtime|logs)\//.test(relative);
function deliveryManifest(project){
  const files={};
  const walk=(dir,relative='')=>{
    let entries=[]; try{ entries=fs.readdirSync(dir,{withFileTypes:true}); }catch{return;}
    for(const entry of entries){
      const rel=path.posix.join(relative,entry.name); if(deliveryExcluded(rel)) continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()) walk(full,rel); else if(entry.isFile()) files[rel]=fileSha(full);
    }
  };
  walk(project); return files;
}

// ── AG：Gate source manifest（所有 Gate 入口共用同一 deterministic builder）──
export function computeGateSourceManifest(project,{inputRevision=0,gatePhase='architecture_gate',policyBundle=null}={}){
  const freeze=readSemanticFreeze(project);
  const requirements=readApproval(project,'requirements',inputRevision);
  const manifest={
    input_revision:Number(inputRevision??0),
    gate_phase:gatePhase,
    requirements_approval_fingerprint:requirements?.requirements_approval_fingerprint??null,
    semantic_freeze_fingerprint:freeze?.semantic_fingerprint??null,
    architecture_generation_key:freeze?.architecture_generation_key??null,
    architecture_sha:fileSha(path.join(project,'docs','architecture','ARCHITECTURE.md')),
    requirements_sha:fileSha(path.join(project,'docs','requirements','REQUIREMENTS.md')),
    prd_sha:fileSha(path.join(project,'docs','PRD.md')),
    adrs:{},diagram_specs:{},build_receipts:{},visual_acceptance:{},
    archify_evidence_sha:fileSha(archifyEvidencePath(project)),
    policy_bundle_fingerprint:policyBundle??policyBundleFingerprint()
  };
  const adrDir=path.join(project,'docs','decisions');
  try{ for(const name of fs.readdirSync(adrDir).filter(item=>/^\d{4}-.+\.md$/.test(item)).sort()) manifest.adrs[name]=fileSha(path.join(adrDir,name)); }catch{}
  for(const key of Object.keys(DIAGRAMS)){
    const paths=diagramPaths(project,key);
    manifest.diagram_specs[key]=fileSha(paths.spec);
    manifest.build_receipts[key]=fileSha(paths.buildReceipt);
    manifest.visual_acceptance[key]=fileSha(paths.acceptance);
  }
  if(gatePhase==='implementation_gate'||gatePhase==='qa') manifest.delivery_files=deliveryManifest(project);
  return manifest;
}
export const computeGateSourceFingerprint=(project,options={})=>hash(canonicalJson(computeGateSourceManifest(project,options)));

/** Reviewer 前後比對；不相等即 SOURCE_CHANGED_DURING_REVIEW，本次結果作廢。 */
export function verifyGateSourceUnchanged(project,before,options={}){
  const after=computeGateSourceFingerprint(project,options);
  return after===before
    ? {ok:true,fingerprint:after}
    : {ok:false,code:'SOURCE_CHANGED_DURING_REVIEW',before,after,reason:'Gate 審查期間專案來源已變動，本次審查結果不可信'};
}

// ── AC：每個 unit 先 adjudicate，再依 effective outcome 聚合 ──
export function adjudicateGateUnit(project,unit,verdict,facts){
  const rawFindings=Array.isArray(verdict.findings)?verdict.findings:[];
  const adjudicated=adjudicateFindings(rawFindings,facts);
  const injected=unit?.id&&/^ARCH-GATE-/.test(unit.id)?machineInjectedFindings(facts):[];
  const outcome=effectiveOutcome(verdict.outcome,adjudicated,injected);
  const surviving=outcome.surviving.map(item=>item.finding);
  // ghost target 防護：被推翻的 finding 不得留下任何 repair target。
  const survivingTargets=[...new Set(surviving.flatMap(item=>item.repair_targets??[]))];
  return {
    unit_id:unit?.id??null,
    raw_outcome:verdict.outcome,
    effective_outcome:outcome.effective_outcome,
    overridden:Boolean(outcome.overridden),
    adjudicated,
    surviving_findings:[...surviving,...injected],
    machine_injected:injected,
    contradicted:adjudicated.filter(item=>item.disposition===DISPOSITIONS.contradicted),
    surviving_repair_targets:survivingTargets
  };
}

/** combined failure 只能由 effective_outcome === 'failed' 的 unit 組成。 */
export function aggregateGateBatch(results){
  const failed=results.filter(item=>item.effective_outcome==='failed');
  const blocked=results.filter(item=>item.effective_outcome==='blocked');
  return {
    failed,blocked,
    allEffectivePass:failed.length===0&&blocked.length===0,
    overriddenUnits:results.filter(item=>item.overridden).map(item=>item.unit_id)
  };
}

/** effective repair targets 只由 surviving findings 重算，不沿用 raw verdict.repair_targets。 */
export function effectiveRepairScope(results,{valid=null}={}){
  const surviving=results.flatMap(item=>item.surviving_findings);
  const raw=[...new Set(surviving.flatMap(item=>item.repair_targets??[]))];
  return {...canonicalizeRepairOwnership(raw,{valid}),surviving_findings:surviving};
}

export function buildEffectiveVerdict(results){
  const failed=results.filter(item=>item.effective_outcome==='failed');
  const surviving=failed.flatMap(item=>item.surviving_findings);
  return {
    outcome:'failed',
    summary:failed.map(item=>`${item.unit_id}：${item.surviving_findings.length} 項確定性存續缺陷`).join('\n'),
    evidence:[],
    // 只帶 surviving findings 的 targets；已推翻者不留 ghost target。
    repair_targets:[...new Set(surviving.flatMap(item=>item.repair_targets??[]))],
    findings:surviving
  };
}

// ── AF：structured ADR review ──
const ADR_FIELD=(text,field)=>new RegExp(`(?:\\*\\*)?${field}\\s*[:：]?\\s*(?:\\*\\*)?\\s*[:：]?\\s*([A-Za-z-]+)`,'i').exec(text)?.[1]?.toLowerCase()??null;

/** reviewed_adr_paths 是唯一 promotion authority；free-text evidence 不再具效力。 */
export function validateReviewedAdrPaths(project,reviewedPaths=[],sourceManifest=null){
  const accepted=[],rejected=[];
  const adrRoot=fs.realpathSync(project);
  for(const raw of reviewedPaths){
    const relative=String(raw??'').trim(); if(!relative){ rejected.push({path:raw,reason:'空路徑'}); continue; }
    const absolute=path.resolve(project,relative);
    let real; try{ real=fs.realpathSync(absolute); }catch{ rejected.push({path:relative,reason:'檔案不存在'}); continue; }
    if(!real.startsWith(adrRoot+path.sep)){ rejected.push({path:relative,reason:'realpath 逃出專案根目錄'}); continue; }
    const name=path.basename(real);
    if(sourceManifest&&!(name in (sourceManifest.adrs??{}))){ rejected.push({path:relative,reason:'不在 Gate source manifest 內'}); continue; }
    const text=fs.readFileSync(real,'utf8');
    if(ADR_FIELD(text,'Gate-Eligible')!=='true'){ rejected.push({path:relative,reason:'Gate-Eligible 非 true'}); continue; }
    if(ADR_FIELD(text,'Approval-Scope')!=='technical'){ rejected.push({path:relative,reason:'Approval-Scope 非 technical'}); continue; }
    if(!['cross-cutting','irreversible','security','data-integrity'].includes(ADR_FIELD(text,'ADR-Admission'))){ rejected.push({path:relative,reason:'ADR-Admission 無效'}); continue; }
    accepted.push({path:relative,name,absolute:real,text});
  }
  return {accepted,rejected};
}

// 同時支援 `**Status:** draft`、`**Status**: draft` 與 `Status: draft` 三種寫法。
const STATUS_LINE=/^(\s*(?:[-*]\s*)?(?:\*\*)?Status\s*[:：]?\s*(?:\*\*)?\s*[:：]?\s*)([A-Za-z-]+)/mi;
export const stripAdrStatus=text=>String(text??'').replace(STATUS_LINE,'$1<STATUS>');

/** promotion 只允許 Status: draft → accepted；其餘 semantic 內容必須不變，否則 abort。 */
export function promoteReviewedAdrs(project,accepted=[],{apply=true}={}){
  const promoted=[],violations=[];
  for(const entry of accepted){
    const before=entry.text;
    if(!STATUS_LINE.test(before)||!/draft/i.test(STATUS_LINE.exec(before)?.[2]??'')) continue;
    const after=before.replace(STATUS_LINE,(match,prefix)=>`${prefix}accepted`);
    if(stripAdrStatus(before)!==stripAdrStatus(after)){ violations.push({path:entry.path,reason:'promotion 造成 Status 以外的 semantic 差異'}); continue; }
    if(apply) fs.writeFileSync(entry.absolute,after);
    promoted.push(entry.path);
  }
  return {promoted,violations,ok:violations.length===0};
}
