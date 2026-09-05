import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeDurableJson, canonicalJson } from './transactions.mjs';
import { evaluateVisualAcceptance, EFFECTIVE_STATUS, sha256, VISUAL_ACCEPTANCE_POLICY_VERSION } from './visual-policy.mjs';

export const SEMANTIC_FREEZE_POLICY_VERSION='1.0.0';
export const BUILD_PROVENANCE_POLICY_VERSION='1.0.0';
export const EVIDENCE_SYNC_POLICY_VERSION='1.0.0';
export const APPROVAL_POLICY_VERSION='1.0.0';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const readFileSha=file=>{ try{ return sha256(fs.readFileSync(file)); }catch{ return null; } };

export const DIAGRAMS=Object.freeze({
  system:{base:'system-architecture',spec:'system-architecture.architecture.json'},
  workflow:{base:'work-order-flow',spec:'work-order-flow.workflow.json'},
  lifecycle:{base:'work-order-lifecycle',spec:'work-order-lifecycle.lifecycle.json'},
  dataflow:{base:'data-trust-boundary',spec:'data-trust-boundary.dataflow.json'}
});
const diagramsDir=project=>path.join(project,'docs','architecture','diagrams');
export const diagramPaths=(project,key)=>{
  const def=DIAGRAMS[key],dir=diagramsDir(project);
  return {spec:path.join(dir,def.spec),html:path.join(dir,`${def.base}.html`),receipt:path.join(dir,`${def.base}.visual-check.json`),
    buildReceipt:path.join(dir,`${def.base}.build-receipt.json`),acceptance:path.join(dir,`${def.base}.visual-acceptance.json`),base:def.base};
};

// ── Semantic Freeze：內容定址，不再只靠 timestamp ──────────────────
export const semanticFreezePath=project=>path.join(project,'.ai','architecture','semantic-freeze.json');

/**
 * ADR 的 semantic body 不含 mutable Status：Gate 後 draft→accepted 不得使既有 Freeze 失效，
 * 但 ADR-Admission / Gate-Eligible / Approval-Scope 與決策內容仍屬 semantic input。
 */
export function adrSemanticBody(text){
  return String(text??'').split(/\r?\n/)
    .filter(line=>!/^\s*(?:[-*]\s*)?(?:\*\*)?Status(?:\*\*)?\s*[:：]/i.test(line))
    .join('\n').trim();
}

export function semanticManifest(project,{requirementsApprovalFingerprint=null}={}){
  const manifest={requirements_approval_fingerprint:requirementsApprovalFingerprint,architecture:null,adrs:{},diagrams:{}};
  manifest.architecture=readFileSha(path.join(project,'docs','architecture','ARCHITECTURE.md'));
  const adrDir=path.join(project,'docs','decisions');
  try{
    for(const name of fs.readdirSync(adrDir).filter(item=>/^\d{4}-.+\.md$/.test(item)).sort())
      manifest.adrs[name]=hash(adrSemanticBody(fs.readFileSync(path.join(adrDir,name),'utf8')));
  }catch{}
  for(const key of Object.keys(DIAGRAMS)) manifest.diagrams[key]=readFileSha(diagramPaths(project,key).spec);
  return manifest;
}
export const semanticFingerprintOf=manifest=>hash(canonicalJson(manifest));

export function writeSemanticFreeze(project,{inputRevision=0,requirementsApprovalFingerprint=null,reviewSourceFingerprint=null}={}){
  const manifest=semanticManifest(project,{requirementsApprovalFingerprint});
  const fingerprint=semanticFingerprintOf(manifest);
  const generationKey=hash(`${inputRevision}|${requirementsApprovalFingerprint??''}|${fingerprint}`);
  const receipt={schema_version:1,input_revision:Number(inputRevision??0),requirements_approval_fingerprint:requirementsApprovalFingerprint,
    semantic_manifest:manifest,semantic_fingerprint:fingerprint,architecture_generation_key:generationKey,
    freeze_policy_version:SEMANTIC_FREEZE_POLICY_VERSION,review_source_fingerprint:reviewSourceFingerprint};
  writeDurableJson(semanticFreezePath(project),receipt);
  return receipt;
}
export function readSemanticFreeze(project){ try{ return JSON.parse(fs.readFileSync(semanticFreezePath(project),'utf8')); }catch{ return null; } }

/** Freeze 是否仍代表現行 semantic 內容；timestamp 不再是 authority。 */
export function semanticFreezeStatus(project,{inputRevision=0,requirementsApprovalFingerprint=null}={}){
  const receipt=readSemanticFreeze(project);
  if(!receipt) return {current:false,reason:'尚無 content-addressed semantic freeze receipt（legacy timestamp 不足以證明）',receipt:null};
  if(Number(receipt.input_revision??0)!==Number(inputRevision??0)) return {current:false,reason:'input revision 已改變',receipt};
  if(requirementsApprovalFingerprint&&receipt.requirements_approval_fingerprint!==requirementsApprovalFingerprint) return {current:false,reason:'requirements approval 已改變',receipt};
  const fingerprint=semanticFingerprintOf(semanticManifest(project,{requirementsApprovalFingerprint:receipt.requirements_approval_fingerprint}));
  if(fingerprint!==receipt.semantic_fingerprint) return {current:false,reason:'semantic 內容已改變，Freeze 已失效',receipt,expected:receipt.semantic_fingerprint,actual:fingerprint};
  return {current:true,reason:'semantic freeze 與現行內容一致',receipt,fingerprint};
}

// ── Build provenance ──────────────────────────────────────────────
export function writeBuildReceipt(project,key,{architectureGenerationKey=null,semanticFreezeFingerprint=null,structuralValidationQuality=null,builderVersion=null,archifyVersion=null}={}){
  const paths=diagramPaths(project,key),html=fs.readFileSync(paths.html);
  const receipt={schema_version:1,architecture_generation_key:architectureGenerationKey,spec_sha:readFileSha(paths.spec),
    semantic_freeze_fingerprint:semanticFreezeFingerprint,html_sha:sha256(html),html_bytes:html.length,
    structural_validation_quality:structuralValidationQuality,builder_version:builderVersion,archify_version:archifyVersion};
  writeDurableJson(paths.buildReceipt,receipt);
  return receipt;
}

/** VERIFY 前必須證明 current HTML 由 current SPEC + current Freeze 產生。 */
export function buildProvenanceStatus(project,key,{semanticFreezeFingerprint=null}={}){
  const paths=diagramPaths(project,key);
  if(!fs.existsSync(paths.html)) return {current:false,reason:`${paths.base}.html 不存在`};
  if(!fs.existsSync(paths.buildReceipt)) return {current:false,reason:`${paths.base} 缺少 build receipt（LEGACY_UNPROVEN_BUILD）`};
  let receipt; try{ receipt=JSON.parse(fs.readFileSync(paths.buildReceipt,'utf8')); }catch(error){ return {current:false,reason:`build receipt 無法解析：${error.message}`}; }
  const specSha=readFileSha(paths.spec),html=fs.readFileSync(paths.html),htmlSha=sha256(html);
  if(receipt.spec_sha!==specSha) return {current:false,reason:`${paths.base} SPEC 已改變（STALE_BUILD）`,receipt};
  if(receipt.html_sha!==htmlSha||Number(receipt.html_bytes)!==html.length) return {current:false,reason:`${paths.base} HTML 與 build receipt 不符（STALE_BUILD）`,receipt};
  if(semanticFreezeFingerprint&&receipt.semantic_freeze_fingerprint&&receipt.semantic_freeze_fingerprint!==semanticFreezeFingerprint) return {current:false,reason:`${paths.base} build 對應的 Semantic Freeze 已失效（STALE_BUILD）`,receipt};
  return {current:true,reason:`${paths.base} build provenance 一致`,receipt,htmlSha,specSha};
}

// ── Evidence sync：machine-owned，與 semantic ARCHITECTURE.md 分檔 ──
export const archifyEvidencePath=project=>path.join(project,'docs','architecture','ARCHIFY_EVIDENCE.json');

export function buildArchifyEvidence(project,{visualQualityProfile='standard',requiredDiagrams=null,notRequiredReason='系統架構圖已充分涵蓋，依架構決策不需獨立圖'}={}){
  const freeze=readSemanticFreeze(project);
  const evidence={schema_version:1,architecture_generation_key:freeze?.architecture_generation_key??null,
    semantic_freeze_fingerprint:freeze?.semantic_fingerprint??null,
    evidence_policy_version:EVIDENCE_SYNC_POLICY_VERSION,visual_policy_version:VISUAL_ACCEPTANCE_POLICY_VERSION,
    visual_quality_profile:visualQualityProfile,diagrams:{}};
  for(const key of Object.keys(DIAGRAMS)){
    const paths=diagramPaths(project,key);
    if(requiredDiagrams&&!requiredDiagrams.includes(key)){
      evidence.diagrams[key]={status:'NOT_REQUIRED',reason:notRequiredReason,spec_sha:readFileSha(paths.spec),semantic_freeze_fingerprint:freeze?.semantic_fingerprint??null};
      continue;
    }
    if(!fs.existsSync(paths.html)||!fs.existsSync(paths.receipt)){
      evidence.diagrams[key]={status:'MISSING',spec_sha:readFileSha(paths.spec),html_sha:null,raw_visual_status:null,effective_visual_status:EFFECTIVE_STATUS.fail};
      continue;
    }
    const html=fs.readFileSync(paths.html),receipt=JSON.parse(fs.readFileSync(paths.receipt,'utf8'));
    const acceptance=evaluateVisualAcceptance({receipt,visualQualityProfile,htmlSha:sha256(html),htmlBytes:html.length,rawReceiptSha:readFileSha(paths.receipt)});
    evidence.diagrams[key]={status:'PRESENT',spec_sha:readFileSha(paths.spec),build_receipt_sha:readFileSha(paths.buildReceipt),
      html_sha:sha256(html),html_bytes:html.length,raw_visual_receipt_sha:readFileSha(paths.receipt),
      raw_visual_status:acceptance.raw_status,effective_visual_status:acceptance.effective_status,waived_diagnostics:acceptance.waived_diagnostics};
  }
  return evidence;
}

export function syncArchifyEvidence(project,options={}){
  const before=buildArchifyEvidence(project,options);
  const after=buildArchifyEvidence(project,options);
  // TOCTOU：sync 期間 source 若改變，本次結果不可信。
  if(canonicalJson(before)!==canonicalJson(after)) return {ok:false,reason:'Evidence Sync 期間來源檔案改變，本次結果作廢'};
  writeDurableJson(archifyEvidencePath(project),after);
  return {ok:true,evidence:after,path:archifyEvidencePath(project)};
}
export function readArchifyEvidence(project){ try{ return JSON.parse(fs.readFileSync(archifyEvidencePath(project),'utf8')); }catch{ return null; } }

export function evidenceSyncStatus(project,options={}){
  const stored=readArchifyEvidence(project);
  if(!stored) return {current:false,reason:'尚未產生 ARCHIFY_EVIDENCE.json'};
  const expected=buildArchifyEvidence(project,options);
  if(canonicalJson(stored)!==canonicalJson(expected)) return {current:false,reason:'ARCHIFY_EVIDENCE.json 與現行 artifact 不一致（evidence stale）',expected,stored};
  return {current:true,reason:'evidence 與現行 artifact 完全一致',evidence:stored};
}

// ── Stage approval receipts ───────────────────────────────────────
export const approvalPath=(project,stage,inputRevision)=>path.join(project,'.ai','approvals',`${stage}-${inputRevision}.json`);

export function mintRequirementsApproval(project,{inputRevision=0,inputFingerprint=null,gateReceiptsFingerprint=null,compatibility=false,evidence=[]}={}){
  const manifest={input_revision:Number(inputRevision??0),input_fingerprint:inputFingerprint,
    requirements_sha:readFileSha(path.join(project,'docs','requirements','REQUIREMENTS.md')),
    prd_sha:readFileSha(path.join(project,'docs','PRD.md')),
    requirements_gate_policy_version:APPROVAL_POLICY_VERSION,gate_receipts_fingerprint:gateReceiptsFingerprint};
  const receipt={schema_version:1,stage:'requirements',manifest,
    requirements_approval_fingerprint:hash(canonicalJson(manifest)),
    compatibility_minted:Boolean(compatibility),evidence,approved_at:new Date().toISOString()};
  writeDurableJson(approvalPath(project,'requirements',receipt.manifest.input_revision),receipt);
  return receipt;
}
export function readApproval(project,stage,inputRevision){ try{ return JSON.parse(fs.readFileSync(approvalPath(project,stage,inputRevision),'utf8')); }catch{ return null; } }

export function requirementsApprovalStatus(project,inputRevision){
  const receipt=readApproval(project,'requirements',inputRevision);
  if(!receipt) return {current:false,reason:'尚無 Requirements Approval Receipt'};
  const requirements=readFileSha(path.join(project,'docs','requirements','REQUIREMENTS.md')),prd=readFileSha(path.join(project,'docs','PRD.md'));
  if(receipt.manifest.requirements_sha!==requirements||receipt.manifest.prd_sha!==prd)
    return {current:false,reason:'REQUIREMENTS_APPROVAL_STALE：Requirements/PRD 已於核准後變更',receipt};
  return {current:true,reason:'requirements approval 與現行文件一致',receipt,fingerprint:receipt.requirements_approval_fingerprint};
}

/**
 * 舊 Gate cache 只有 outcome/fingerprint/manifest/summary/evidence，
 * 不具備新版 approval 所需 structured receipts，一律視為 LEGACY_UNPROVEN_GATE_CACHE。
 */
export function legacyGateCacheCompatibility(entry){
  if(!entry||typeof entry!=='object') return {eligible:false,reason:'無 cache entry'};
  const missing=['source_manifest_fingerprint','policy_bundle_fingerprint','effective_outcome','structured_receipts'].filter(field=>entry[field]===undefined);
  if(missing.length) return {eligible:false,reason:`LEGACY_UNPROVEN_GATE_CACHE：缺少 ${missing.join('、')}`};
  if(entry.effective_outcome!=='pass') return {eligible:false,reason:'cache 的 effective_outcome 非 pass'};
  return {eligible:true,reason:'cache 具備新版 approval 所需的完整 structured evidence'};
}

export function mintArchitectureApproval(project,{inputRevision=0,requirementsApprovalFingerprint=null,gateSourceFingerprint=null,gateReceiptsFingerprint=null,policyBundleFingerprint=null,acceptedAdrs=[]}={}){
  const freeze=readSemanticFreeze(project);
  const manifest={input_revision:Number(inputRevision??0),requirements_approval_fingerprint:requirementsApprovalFingerprint,
    semantic_freeze_fingerprint:freeze?.semantic_fingerprint??null,architecture_generation_key:freeze?.architecture_generation_key??null,
    architecture_sha:readFileSha(path.join(project,'docs','architecture','ARCHITECTURE.md')),
    accepted_adr_shas:Object.fromEntries(acceptedAdrs.map(name=>[name,readFileSha(path.join(project,'docs','decisions',name))])),
    diagram_spec_shas:Object.fromEntries(Object.keys(DIAGRAMS).map(key=>[key,readFileSha(diagramPaths(project,key).spec)])),
    build_receipt_shas:Object.fromEntries(Object.keys(DIAGRAMS).map(key=>[key,readFileSha(diagramPaths(project,key).buildReceipt)])),
    visual_acceptance_shas:Object.fromEntries(Object.keys(DIAGRAMS).map(key=>[key,readFileSha(diagramPaths(project,key).acceptance)])),
    archify_evidence_sha:readFileSha(archifyEvidencePath(project)),
    gate_source_fingerprint:gateSourceFingerprint,gate_receipts_fingerprint:gateReceiptsFingerprint,policy_bundle_fingerprint:policyBundleFingerprint};
  const receipt={schema_version:1,stage:'architecture',manifest,
    architecture_approval_fingerprint:hash(canonicalJson(manifest)),approved_at:new Date().toISOString()};
  writeDurableJson(approvalPath(project,'architecture',receipt.manifest.input_revision),receipt);
  return receipt;
}

export function architectureApprovalStatus(project,inputRevision){
  const receipt=readApproval(project,'architecture',inputRevision);
  if(!receipt) return {current:false,reason:'尚無 Architecture Approval Receipt'};
  const architecture=readFileSha(path.join(project,'docs','architecture','ARCHITECTURE.md'));
  if(receipt.manifest.architecture_sha!==architecture) return {current:false,reason:'ARCHITECTURE_APPROVAL_STALE：ARCHITECTURE.md 已於核准後變更',receipt};
  const evidence=readFileSha(archifyEvidencePath(project));
  if(receipt.manifest.archify_evidence_sha!==evidence) return {current:false,reason:'ARCHITECTURE_APPROVAL_STALE：ARCHIFY_EVIDENCE.json 已變更',receipt};
  return {current:true,reason:'architecture approval 與現行內容一致',receipt,fingerprint:receipt.architecture_approval_fingerprint};
}

export const policyBundleFingerprint=({gateCacheVersion=1,repairPolicyVersion='1.0.0',findingAdjudicationVersion='1.0.0'}={})=>hash(canonicalJson({
  gate_cache_version:gateCacheVersion,repair_policy_version:repairPolicyVersion,
  visual_acceptance_policy_version:VISUAL_ACCEPTANCE_POLICY_VERSION,finding_adjudication_version:findingAdjudicationVersion,
  semantic_freeze_policy_version:SEMANTIC_FREEZE_POLICY_VERSION,build_provenance_policy_version:BUILD_PROVENANCE_POLICY_VERSION,
  evidence_sync_policy_version:EVIDENCE_SYNC_POLICY_VERSION,approval_policy_version:APPROVAL_POLICY_VERSION
}));

/** LLM Gate 之前的確定性不變式檢查；可主動建立真缺陷。 */
export function evaluateArchitectureInvariants(project,{inputRevision=0,visualQualityProfile='standard',requiredDiagrams=null}={}){
  const violations=[];
  const requirements=requirementsApprovalStatus(project,inputRevision);
  if(!requirements.current) violations.push({rule_id:'ARCH_REQUIREMENTS_APPROVAL_STALE',reason:requirements.reason});
  const freeze=semanticFreezeStatus(project,{inputRevision,requirementsApprovalFingerprint:requirements.fingerprint??null});
  if(!freeze.current) violations.push({rule_id:'ARCH_SEMANTIC_FREEZE_STALE',reason:freeze.reason});
  for(const key of requiredDiagrams??Object.keys(DIAGRAMS)){
    const provenance=buildProvenanceStatus(project,key,{semanticFreezeFingerprint:freeze.receipt?.semantic_fingerprint??null});
    if(!provenance.current) violations.push({rule_id:'ARCH_BUILD_PROVENANCE_STALE',reason:provenance.reason,diagram:key});
  }
  const evidence=evidenceSyncStatus(project,{visualQualityProfile,requiredDiagrams});
  if(!evidence.current) violations.push({rule_id:'ARCH_EVIDENCE_SHA_MISMATCH',reason:evidence.reason});
  return {ok:violations.length===0,violations,requirements,freeze,evidence};
}
