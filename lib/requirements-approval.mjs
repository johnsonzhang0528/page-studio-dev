import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalJson } from './transactions.mjs';
import { sha256 } from './visual-policy.mjs';
import { mintRequirementsApproval, readApproval, legacyGateCacheCompatibility, APPROVAL_POLICY_VERSION } from './architecture-provenance.mjs';

export const REQUIREMENTS_VERIFICATION_POLICY_VERSION='1.0.0';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fileSha=file=>{ try{ return sha256(fs.readFileSync(file)); }catch{ return null; } };

export const requirementsSourcePaths=project=>({
  requirements:path.join(project,'docs','requirements','REQUIREMENTS.md'),
  prd:path.join(project,'docs','PRD.md')
});

/** Requirements semantic source 的內容指紋，用於 verification 前後的 TOCTOU 比對。 */
export function requirementsSourceFingerprint(project,{inputRevision=0,inputFingerprint=null}={}){
  const paths=requirementsSourcePaths(project);
  return hash(canonicalJson({
    input_revision:Number(inputRevision??0),
    input_fingerprint:inputFingerprint,
    requirements_sha:fileSha(paths.requirements),
    prd_sha:fileSha(paths.prd),
    policy_version:REQUIREMENTS_VERIFICATION_POLICY_VERSION
  }));
}

/**
 * Read-only compatibility checks。
 * 只讀取現行 Requirements/PRD 判斷是否可合法視為 approved；
 * 絕不修改、格式整理或語意修復任何 Requirements source。
 */
export function requirementsCompatibilityChecks(project,{inputRevision=0}={}){
  const paths=requirementsSourcePaths(project),checks=[];
  const requirementsSha=fileSha(paths.requirements),prdSha=fileSha(paths.prd);
  checks.push({name:'requirements_present',ok:Boolean(requirementsSha),detail:requirementsSha?`REQUIREMENTS.md SHA ${requirementsSha.slice(0,16)}…`:'docs/requirements/REQUIREMENTS.md 不存在'});
  checks.push({name:'prd_present',ok:Boolean(prdSha),detail:prdSha?`PRD.md SHA ${prdSha.slice(0,16)}…`:'docs/PRD.md 不存在'});

  let requirementsText='',prdText='';
  try{ requirementsText=fs.readFileSync(paths.requirements,'utf8'); }catch{}
  try{ prdText=fs.readFileSync(paths.prd,'utf8'); }catch{}
  const substantive=value=>value.replace(/\s+/g,'').length;
  checks.push({name:'requirements_substantive',ok:substantive(requirementsText)>400,detail:`REQUIREMENTS.md 實質內容 ${substantive(requirementsText)} 字元`});
  checks.push({name:'prd_substantive',ok:substantive(prdText)>200,detail:`PRD.md 實質內容 ${substantive(prdText)} 字元`});
  const unresolvedTbd=/\bTBD\b|待填寫|尚未撰寫/i.test(requirementsText)&&!/待確認事項|Open Questions/i.test(requirementsText);
  checks.push({name:'requirements_no_unresolved_template',ok:!unresolvedTbd,detail:unresolvedTbd?'REQUIREMENTS.md 仍為未填寫範本':'需求正文非空白範本'});
  // 追溯鏈：Requirements 必須有可辨識的需求編號，PRD 必須引用它們。
  const requirementIds=[...new Set((requirementsText.match(/\bREQ-[A-Z]+-?\d+/g)??[]))];
  checks.push({name:'requirements_have_ids',ok:requirementIds.length>0,detail:`偵測到 ${requirementIds.length} 個需求編號`});
  const referenced=requirementIds.filter(id=>prdText.includes(id));
  checks.push({name:'prd_traces_requirements',ok:requirementIds.length===0||referenced.length>0,detail:`PRD 引用 ${referenced.length}/${requirementIds.length} 個需求編號`});

  return {ok:checks.every(item=>item.ok),checks,requirementsSha,prdSha,requirementIds:requirementIds.length};
}

/**
 * 完整的 read-only Requirements compatibility verification。
 * 前後比對 source fingerprint；期間若被改動則作廢，不 mint approval。
 */
export function verifyRequirementsCompatibility(project,{inputRevision=0,inputFingerprint=null,gateCacheEntry=null}={}){
  const before=requirementsSourceFingerprint(project,{inputRevision,inputFingerprint});
  const legacy=legacyGateCacheCompatibility(gateCacheEntry);
  const result=requirementsCompatibilityChecks(project,{inputRevision});
  const after=requirementsSourceFingerprint(project,{inputRevision,inputFingerprint});

  if(before!==after) return {ok:false,code:'SOURCE_CHANGED_DURING_REQUIREMENTS_VERIFICATION',
    reason:'Requirements verification 期間 REQUIREMENTS.md／PRD.md 已變動，本次驗證作廢且不得 mint approval',
    before,after,legacy_disposition:legacy.eligible?'ELIGIBLE':'LEGACY_UNPROVEN_GATE_CACHE'};

  return {
    ok:result.ok,
    code:result.ok?'REQUIREMENTS_COMPATIBILITY_PASS':'REQUIREMENTS_COMPATIBILITY_FAIL',
    reason:result.ok?'現行 Requirements/PRD 通過 read-only compatibility 驗證':`未通過：${result.checks.filter(item=>!item.ok).map(item=>item.detail).join('；')}`,
    checks:result.checks,source_fingerprint:before,
    requirements_sha:result.requirementsSha,prd_sha:result.prdSha,
    legacy_disposition:legacy.eligible?'ELIGIBLE':'LEGACY_UNPROVEN_GATE_CACHE',
    legacy_reason:legacy.reason
  };
}

/** 只有 verification PASS 才 mint；receipt 為 controller-owned。 */
export function mintVerifiedRequirementsApproval(project,verification,{inputRevision=0,inputFingerprint=null,gateReceiptsFingerprint=null}={}){
  if(!verification?.ok) throw new Error(`Requirements compatibility 未通過，不得 mint approval：${verification?.reason??'未知'}`);
  return mintRequirementsApproval(project,{inputRevision,inputFingerprint,gateReceiptsFingerprint,compatibility:true,
    evidence:[
      `read-only compatibility verification：${verification.code}`,
      `source fingerprint ${verification.source_fingerprint}`,
      `legacy gate cache：${verification.legacy_disposition}（${verification.legacy_reason}）`,
      ...verification.checks.map(item=>`${item.ok?'PASS':'FAIL'} ${item.name}：${item.detail}`)
    ]});
}

/**
 * Semantic Freeze 的 hard invariant：
 * requirements_approval_fingerprint 必須非 null，且 manifest 與現行 SHA 完全相符。
 */
export function requirementsApprovalGate(project,inputRevision){
  const receipt=readApproval(project,'requirements',inputRevision);
  if(!receipt?.requirements_approval_fingerprint)
    return {ok:false,code:'REQUIREMENTS_APPROVAL_MISSING',reason:'requirements_approval_fingerprint 為 null；不得建立 authoritative Semantic Freeze',fingerprint:null};
  const paths=requirementsSourcePaths(project);
  const requirementsSha=fileSha(paths.requirements),prdSha=fileSha(paths.prd);
  if(receipt.manifest.requirements_sha!==requirementsSha||receipt.manifest.prd_sha!==prdSha)
    return {ok:false,code:'REQUIREMENTS_APPROVAL_STALE',reason:'現行 Requirements/PRD 與 approval manifest 不符',fingerprint:receipt.requirements_approval_fingerprint};
  return {ok:true,code:'REQUIREMENTS_APPROVAL_CURRENT',reason:'requirements approval 與現行文件完全相符',
    fingerprint:receipt.requirements_approval_fingerprint,receipt};
}

/** 以 null upstream approval 產生的 Freeze 不具權威性，必須失效重建。 */
export function semanticFreezeUpstreamValid(freezeReceipt,requirementsFingerprint){
  if(!freezeReceipt) return {valid:false,reason:'尚無 semantic freeze receipt'};
  if(!freezeReceipt.requirements_approval_fingerprint)
    return {valid:false,reason:'既有 Semantic Freeze 建立於 null requirements approval chain，不具權威性，必須重建'};
  if(requirementsFingerprint&&freezeReceipt.requirements_approval_fingerprint!==requirementsFingerprint)
    return {valid:false,reason:'既有 Semantic Freeze 綁定的 requirements approval 已不是現行版本'};
  return {valid:true,reason:'semantic freeze 的 upstream approval chain 完整'};
}
