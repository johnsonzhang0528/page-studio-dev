import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { evaluateVisualAcceptance, EFFECTIVE_STATUS, sha256 } from './visual-policy.mjs';

export const FINDING_ADJUDICATION_VERSION='1.0.0';
export const DISPOSITIONS=Object.freeze({
  survives:'SURVIVES',
  contradicted:'CONTRADICTED_BY_MACHINE_EVIDENCE',
  deferred:'DEFERRED_TO_RELEASE',
  invalid:'INVALID_STRUCTURED_FINDING'
});
// Machine-verifiable 規則的 controlled vocabulary。LLM 給的 rule_id 必須通過這個 allowlist，
// 且 controller 仍會自行重新驗證底層證據，不直接採信。
export const RULE_IDS=Object.freeze({
  requirementsApprovalStale:'ARCH_REQUIREMENTS_APPROVAL_STALE',
  semanticFreezeStale:'ARCH_SEMANTIC_FREEZE_STALE',
  buildProvenanceStale:'ARCH_BUILD_PROVENANCE_STALE',
  visualEffectiveAcceptance:'ARCH_VISUAL_EFFECTIVE_ACCEPTANCE',
  evidenceShaMismatch:'ARCH_EVIDENCE_SHA_MISMATCH',
  lifecycleDueBlockedPath:'ARCH_LIFECYCLE_DUE_BLOCKED_PATH'
});
const ALLOWED_RULE_IDS=new Set(Object.values(RULE_IDS));
export const isAllowedRuleId=id=>ALLOWED_RULE_IDS.has(String(id??''));

const text=finding=>[finding?.title,finding?.summary,...(finding?.acceptance_check??[]),...(finding?.repair_plan??[])].filter(Boolean).join('\n').toLowerCase();

// ── 機器可驗證事實 ────────────────────────────────────────────────
const DIAGRAM_BASES=['system-architecture','work-order-flow','work-order-lifecycle','data-trust-boundary'];

export function diagramVisualFacts(project,visualQualityProfile){
  const dir=path.join(project,'docs','architecture','diagrams'),facts={};
  for(const base of DIAGRAM_BASES){
    const html=path.join(dir,`${base}.html`),receiptPath=path.join(dir,`${base}.visual-check.json`);
    if(!fs.existsSync(html)||!fs.existsSync(receiptPath)) continue;
    try{
      const buffer=fs.readFileSync(html),receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
      facts[base]=evaluateVisualAcceptance({receipt,visualQualityProfile,htmlSha:sha256(buffer),htmlBytes:buffer.length,rawReceiptSha:sha256(fs.readFileSync(receiptPath))});
    }catch{}
  }
  return facts;
}

/** canonical lifecycle：DUE_BLOCKED 是 RELEASE_VALIDATION 的結果，直接 DUE→DUE_BLOCKED 會繞過驗證邊界。 */
export function lifecycleCanonicalFacts(project){
  const file=path.join(project,'docs','architecture','diagrams','work-order-lifecycle.lifecycle.json');
  try{
    const spec=JSON.parse(fs.readFileSync(file,'utf8')),transitions=Array.isArray(spec.transitions)?spec.transitions:[];
    const has=(from,to)=>transitions.some(item=>item.from===from&&item.to===to);
    const dueToValidation=has('due','release_validation'),validationToBlocked=has('release_validation','due_blocked');
    return {available:true,dueToValidation,validationToBlocked,directDueToBlocked:has('due','due_blocked'),canonicalComplete:dueToValidation&&validationToBlocked};
  }catch{ return {available:false,canonicalComplete:false}; }
}

const mentionsDirectDueEdge=value=>/due\s*(?:→|->|to|＿)?\s*due_blocked/i.test(value)||(value.includes('due_blocked')&&/直接(轉移|邊)|direct\s*edge|字面/.test(value));
const mentionsVisual=value=>/visual-check|視覺驗證|containment|viewport|溢出|overflow/.test(value);
const mentionsShaEvidence=value=>/sha-?256|雜湊|hash|evidence 表|archify evidence/.test(value);
// closed-world safety：只有「唯一主張就是視覺限制」才可被機器推翻。
// 任何同時主張語意缺口（缺狀態／缺節點／缺邊界／繞過不變量／追溯斷裂／文件過期）的 finding
// 都必須 PASS_THROUGH，交由真正的 semantic owner 處理。
const SEMANTIC_CLAIM=/缺少|遺漏|未涵蓋|不一致|自相矛盾|繞過|追溯|映射|未納入|仍宣稱|過期|不實|終態|信任邊界|唯讀邊界|強制層級|未定義|無任何|狀態序列|節點|轉移/;
const mentionsSemanticDefect=value=>SEMANTIC_CLAIM.test(value);
const visualLimitationOnly=value=>mentionsVisual(value)&&!mentionsShaEvidence(value)&&!mentionsSemanticDefect(value);

/**
 * 先機器裁定，再進 Finding Store。
 * - 可被確定性證據推翻的 false positive 不得成為 current blocker（但保留完整 audit）
 * - 未知或無機器證據的 semantic finding 一律 PASS_THROUGH（closed-world safety）
 */
export function adjudicateFinding(finding,facts){
  const body=text(finding);
  if(!finding||!finding.title&&!finding.summary) return {disposition:DISPOSITIONS.invalid,rule_id:null,machine_evidence:['finding 缺少可判讀的 title/summary']};

  // DUE direct-edge false positive：只有在「唯一未達成項就是那條字面直接邊」時才成立。
  // 若同時主張缺主線狀態、狀態未持久化或與正文不一致，必須交回 semantic owner 驗證。
  const directEdgeIsSoleClaim=mentionsDirectDueEdge(body)&&!/合併|未成為可持久化|未持久化|不一致|遺漏|未涵蓋|無任何/.test(body);
  if(directEdgeIsSoleClaim&&facts.lifecycle?.canonicalComplete&&!mentionsShaEvidence(body)&&!mentionsVisual(body)){
    return {disposition:DISPOSITIONS.contradicted,rule_id:RULE_IDS.lifecycleDueBlockedPath,machine_evidence:[
      'DUE_BLOCKED is an outcome of RELEASE_VALIDATION.',
      'A direct DUE → DUE_BLOCKED transition would bypass the canonical release-validation boundary and is intentionally absent.',
      'lifecycle JSON 現存 due→release_validation 與 release_validation→due_blocked 兩條 canonical 轉移'
    ]};
  }

  // 視覺 false positive：僅在該圖 effective 已被接受、且 finding 沒有主張 SHA/evidence 不符時成立
  if(visualLimitationOnly(body)){
    const involved=DIAGRAM_BASES.filter(base=>body.includes(base)||body.includes(base.replace(/-/g,' ')));
    const scope=involved.length?involved:Object.keys(facts.visual??{});
    const evaluated=scope.map(base=>facts.visual?.[base]).filter(Boolean);
    if(evaluated.length&&evaluated.every(item=>item.policy_accepted)){
      return {disposition:DISPOSITIONS.contradicted,rule_id:RULE_IDS.visualEffectiveAcceptance,machine_evidence:[
        ...scope.map(base=>`${base}: raw=${facts.visual[base]?.raw_status}／effective=${facts.visual[base]?.effective_status}（${(facts.visual[base]?.waived_diagnostics??[]).join('、')||'無豁免'}）`),
        'artifact SHA-256 與 bytes 已驗證一致；僅存在 standard profile 允許之密集技術圖檢視限制'
      ]};
    }
  }

  return {disposition:DISPOSITIONS.survives,rule_id:isAllowedRuleId(finding.rule_id)?finding.rule_id:null,machine_evidence:[]};
}

export function adjudicateFindings(findings=[],facts={}){
  return findings.map(finding=>({finding,...adjudicateFinding(finding,facts)}));
}

/** 機器可主動建立真缺陷，不依賴 LLM 是否發現。 */
export function machineInjectedFindings(facts={}){
  const injected=[];
  for(const [base,acceptance] of Object.entries(facts.visual??{})){
    if(acceptance.policy_accepted) continue;
    injected.push({
      rule_id:acceptance.blocking_reasons?.some(reason=>/SHA|bytes/i.test(reason))?RULE_IDS.evidenceShaMismatch:RULE_IDS.buildProvenanceStale,
      severity:'high',blocking_stage:'development',category:'machine_invariant',
      title:`${base} 視覺驗收未通過確定性政策`,
      summary:acceptance.blocking_reasons?.join('；')||'effective visual acceptance = FAIL',
      machine_generated:true,
      acceptance_check:[`${base} 的 effective visual acceptance 必須為 PASS 或 ACCEPTED_WITH_LIMITATIONS`]
    });
  }
  return injected;
}

/** raw failed 但所有 development blocker 都被推翻，且無機器注入缺陷時，effective 可為 pass。 */
export function effectiveOutcome(rawOutcome,adjudicated=[],injected=[]){
  const surviving=adjudicated.filter(item=>item.disposition===DISPOSITIONS.survives&&item.finding?.blocking_stage!=='release');
  if(injected.length) return {effective_outcome:'failed',surviving,injected};
  if(surviving.length) return {effective_outcome:'failed',surviving,injected};
  if(rawOutcome==='failed'||rawOutcome==='blocked') return {effective_outcome:'pass',surviving,injected,overridden:true};
  return {effective_outcome:rawOutcome==='pass'?'pass':rawOutcome,surviving,injected};
}

export const appendGateAudit=(project,record)=>{
  const file=path.join(project,'.ai','GATE_AUDIT.jsonl');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.appendFileSync(file,JSON.stringify({...record,at:new Date().toISOString()})+'\n');
  return file;
};
