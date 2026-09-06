#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dns from 'node:dns';
import https from 'node:https';
import { spawn, spawnSync } from 'node:child_process';
import { runQualityGate } from './quality.mjs';
import { selectParallelWriteBatch, createParallelRun, updateParallelRun, finalizeWorker, integrateParallelRun, finishIntegratedParallelRun, currentParallelStatus, linkProjectDependencies, meaningfulProjectChanges, parallelConcurrency, explainParallelEligibility, deduplicateVerification, verifyIntegrationBatch } from './parallel-write.mjs';
import { upsertGateFindings, resolveRepairTargets, loadFindings, saveFindings, beginRepair, beginVerification, finishVerification, finalizeGateFindings, needsReflection, validateReflection, normalizeStringList } from './gate-findings.mjs';
import { canonicalizeRepairOwnership, invalidateDerivedWorkUnit, SEMANTIC_FREEZE_UNIT, SEMANTIC_REPAIR_UNITS, EVIDENCE_SYNC_UNIT, DIAGRAM_FAMILIES, isMachineUnit, executionModeFor } from './architecture-model.mjs';
import { evaluateVisualAcceptance, visualAcceptanceEvidence, visualAcceptanceReceipt, VISUAL_ACCEPTANCE_POLICY_VERSION, EFFECTIVE_STATUS, sha256 } from './visual-policy.mjs';
import { writeDurableJson, canonicalJson, beginTransaction, advanceTransaction, pendingTransactions, reconcilePendingTransactions } from './transactions.mjs';
import { adjudicateFindings, machineInjectedFindings, effectiveOutcome, diagramVisualFacts, lifecycleCanonicalFacts, appendGateAudit, DISPOSITIONS, FINDING_ADJUDICATION_VERSION } from './finding-adjudication.mjs';
import { policyBundleFingerprint, evaluateArchitectureInvariants, semanticFreezeStatus, requirementsApprovalStatus, architectureApprovalStatus, mintRequirementsApproval, mintArchitectureApproval, writeSemanticFreeze, writeBuildReceipt, buildProvenanceStatus, syncArchifyEvidence, evidenceSyncStatus, readSemanticFreeze, readApproval } from './architecture-provenance.mjs';
import { computeGateSourceManifest, computeGateSourceFingerprint, verifyGateSourceUnchanged, adjudicateGateUnit, aggregateGateBatch, effectiveRepairScope, buildEffectiveVerdict, validateReviewedAdrPaths, promoteReviewedAdrs } from './gate-execution.mjs';
import { snapshotMachineOwned, detectMachineOwnedViolations, machineOwnedViolationReason, MACHINE_OWNED_VIOLATION } from './machine-owned.mjs';
import { verifyRequirementsCompatibility, mintVerifiedRequirementsApproval, requirementsApprovalGate, semanticFreezeUpstreamValid, requirementsSourceFingerprint } from './requirements-approval.mjs';
import { architectureDeathTests } from './architecture-death-tests.mjs';
import { selectComplexityPolicy, complexityInstruction, recordComplexityMetric, normalizeComplexityReceipt, diffComplexitySnapshot } from './complexity-policy.mjs';
import { CONCURRENCY_CODES, leaseIdentity, acquireWorkUnitLease, trackChild, terminateChildGroup, installChildCleanupHandlers } from './concurrency.mjs';

dns.setDefaultResultOrder('ipv4first');
installChildCleanupHandlers();

function telegramPost(url,payload,timeout=10000) {
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify(payload),request=https.request(url,{method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
      let raw=''; response.setEncoding('utf8'); response.on('data',chunk=>raw+=chunk); response.on('end',()=>{ try { resolve({ok:response.statusCode>=200&&response.statusCode<300,status:response.statusCode,body:JSON.parse(raw)}); } catch(error) { error.code='INVALID_TELEGRAM_JSON'; reject(error); } });
    });
    request.setTimeout(timeout,()=>{ const error=new Error(`Telegram IPv4 連線超過 ${Math.round(timeout/1000)} 秒`); error.code='ETIMEDOUT'; request.destroy(error); }); request.on('error',reject); request.end(body);
  });
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function telegramPostWithRetry(url,payload,{timeout=10000,attempts=3}={}) {
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++) try { return await telegramPost(url,payload,timeout); } catch(error) { lastError=error; if(attempt<attempts){ const delay=1000*2**(attempt-1); console.log(`【Telegram 通知重試】第 ${attempt}/${attempts} 次失敗（${error.code??error.name??'未知網路錯誤'}），${delay/1000} 秒後重試。`); await wait(delay); } }
  throw lastError;
}

const ROOT = path.join(os.homedir(), 'page-studio-dev');
const PROJECTS = path.join(ROOT, 'projects');
const PHASES = {
  not_started: { next: 'input_analysis', agent: null },
  input_analysis: { next: 'requirements', agent: 'intake', kind: 'produce', prompt: '盤點並分析 docs/input/ 的所有原始資料，依實際內容分類至 brief、discussions、images、plans、references、data 或 unknown，建立 docs/input/INDEX.md 與 .ai/INPUT_INDEX.json；同時建立或重建 docs/context/INPUT_DIGEST.md，作為 AI 優先讀取的精簡 Markdown 層。每項內容必須記錄原始路徑、SHA-256、擷取時間、摘要與轉換限制。不得把圖片、CSV、JSON、PDF、試算表或其他原始證據硬轉後取代原檔；不可刪除、覆寫或將資料移出 docs/input/。' },
  requirements: { next: 'requirements_gate', agent: 'requirement', kind: 'produce', prompt: '完成需求訪談與需求整理，維護 docs/requirements/REQUIREMENTS.md 與 docs/PRD.md。只保留已知事實、範圍、限制與未決事項，不複製整份文件或累加歷史。Context 會在需求 Gate 通過後才同步。不可自行編造商業決策；若確實需要操作者提供關鍵資訊，必須回傳 blocked。' },
  requirements_gate: { next: 'architecture', repair: 'requirements', agent: 'reviewer', kind: 'gate', prompt: '審查需求與 PRD 是否具備可測試的驗收條件、明確範圍、排除項目、一致性，以及是否仍有未解決的重大問題。只能審查，不可修改檔案。' },
  architecture: { next: 'architecture_gate', agent: 'architect', kind: 'produce', prompt: '依已核准需求建立或修復架構，維護精簡的 docs/architecture/ARCHITECTURE.md、Draft ADR 與通過驗證的 Archify 證據。只保留目前有效內容，不把回合紀錄、Git 歷史或重複驗證敘述寫進 Source of Truth。此階段不可實作產品功能。' },
  architecture_gate: { next: 'specification', repair: 'architecture', agent: 'reviewer', kind: 'gate', prompt: '審查架構是否涵蓋全部需求、邊界、資料完整性、安全性、部署假設、取捨與有效 Archify 證據。只能審查，不可修改檔案。' },
  specification: { next: 'specification_gate', agent: 'spec', kind: 'produce', prompt: '在 docs/specs 下建立或修復可直接實作的開發規格，包含行為、API、資料規則、錯誤處理、安全與測試對照；以精簡表格更新 docs/context/TRACEABILITY.md，連結需求、規格與驗收證據，不複製完整正文。' },
  specification_gate: { next: 'planning', repair: 'specification', agent: 'reviewer', kind: 'gate', prompt: '審查規格的完整性、一致性、可實作性、邊界情境、安全性與驗收測試追溯關係。只能審查，不可修改檔案。' },
  planning: { next: 'planning_gate', agent: 'planner', kind: 'produce', prompt: '建立或修復 docs/IMPLEMENTATION_PLAN.md 與 .ai/TASK_GRAPH.json。任務必須具備安全相依順序、合理範圍、可驗證結果，並避免平行修改相同檔案。每個寫入型任務必須提供 write_scope、verification、risk 與 parallel_policy；驗證指令使用 argv 陣列，只有範圍不衝突且非高風險任務才可標示 isolated。' },
  planning_gate: { next: 'implementation', repair: 'planning', agent: 'reviewer', kind: 'gate', prompt: '審查實作計畫與任務圖是否完整涵蓋規格、相依關係有效、任務範圍合理、驗證證據明確，且沒有檔案衝突風險。只能審查，不可修改檔案。' },
  implementation: { next: 'implementation_gate', agent: 'developer', kind: 'implementation', prompt: '只選取一個相依條件已滿足且尚未完成的任務進行實作，執行聚焦檢查，只更新該任務在 .ai/TASK_GRAPH.json 的狀態與證據後停止。不可 push 或部署。' },
  implementation_gate: { next: 'qa', repair: 'implementation', agent: 'reviewer', kind: 'gate', prompt: '依已核准規格與任務證據審查完整實作，執行相關唯讀檢查，確認正確性、安全性、迴歸風險、測試與文件。不可修改檔案。' },
  qa: { next: 'release_gate', repair: 'implementation', agent: 'qa', kind: 'gate', prompt: '執行最終 QA，將每項驗收條件對應至可重現的通過證據，執行可用的完整測試，並誠實回報失敗或略過的檢查。不可修改實作檔案。' },
  release_gate: { next: 'complete', agent: 'reviewer', kind: 'gate', prompt: '只核對 Release risks 是否已關閉；不修改產品、不推送、不部署。開發與 QA 已完成，未決部署參數只能阻止正式發布。' },
  complete: { next: null, agent: null }
};
const PHASE_LABELS={not_started:'尚未開始',input_analysis:'原始資料分析與分類',requirements:'需求整理',requirements_gate:'需求審查關卡',architecture:'架構設計與 Archify',architecture_gate:'架構審查關卡',specification:'開發規格撰寫',specification_gate:'規格審查關卡',planning:'任務拆解與開發排程',planning_gate:'排程審查關卡',implementation:'Agent 程式開發',implementation_gate:'實作審查關卡',qa:'最終品質驗證',release_gate:'正式發布前置關卡',complete:'全部流程完成'};
const PROGRESS_PHASES=['input_analysis','requirements','requirements_gate','architecture','architecture_gate','specification','specification_gate','planning','planning_gate','implementation','implementation_gate','qa','release_gate'];
const PROGRESS_WEIGHTS={input_analysis:5,requirements:10,requirements_gate:5,architecture:15,architecture_gate:5,specification:10,specification_gate:5,planning:7,planning_gate:3,implementation:20,implementation_gate:5,qa:8,release_gate:2};
const OUTCOME_LABELS={pass:'通過',blocked:'等待操作者補充',failed:'未通過'};
const STATUS_LABELS={ready:'準備執行',running:'執行中',repairing:'自動修復中',quota_paused:'額度暫停',service_paused:'服務暫時過載',blocked:'等待操作者補充',failed:'執行失敗',stopped:'已停止',complete:'已完成'};
const DEFAULT_MODEL_ROUTING={
  input_analysis:{model:'sonnet',effort:'medium',reason:'資料盤點與分類需要良好理解力，但不需要最高成本推理'},
  requirements:{model:'sonnet',effort:'high',reason:'需求整合需要長上下文與嚴謹推理'},
  requirements_gate:{model:'opus',effort:'high',reason:'由高階模型獨立檢查需求缺口與矛盾'},
  architecture:{model:'sonnet',effort:'high',reason:'架構生產工作使用 Sonnet；高風險決策由獨立 Opus Gate 審查'},
  architecture_gate:{model:'opus',effort:'high',reason:'以全新獨立工作階段審查高影響架構決策'},
  specification:{model:'sonnet',effort:'high',reason:'將核准架構轉為完整可實作規格'},
  specification_gate:{model:'opus',effort:'high',reason:'獨立檢查跨規格一致性、邊界與安全要求'},
  planning:{model:'sonnet',effort:'high',reason:'任務拆解與相依排程需要穩定結構化推理'},
  planning_gate:{model:'opus',effort:'high',reason:'獨立檢查遺漏、錯誤相依與執行風險'},
  implementation:{model:'sonnet',effort:'high',reason:'一般開發任務以品質與額度效率平衡為主'},
  implementation_gate:{model:'opus',effort:'high',reason:'由不同於一般開發的高階模型進行獨立實作審查'},
  qa:{model:'opus',effort:'high',reason:'最終驗收需要跨需求、規格、程式碼與測試的完整判斷'}
  ,release_gate:{model:'sonnet',effort:'medium',reason:'只核對已記錄 Release risks，不需要再次全面審查產品'}
};
const UNITIZED_PHASES=new Set(['input_analysis','requirements','requirements_gate','architecture','architecture_gate','specification','specification_gate','planning','planning_gate','implementation_gate','qa','release_gate']);
const STATIC_WORK_UNITS={
  requirements:[
    {id:'REQ-ANALYZE',title:'整合輸入與需求缺口',repair_paths:['docs/requirements/requirements.md'],repair_keywords:['open question','unresolved-','需求缺口'],max_turns:20,prompt:'只盤點精簡輸入索引、既有需求、矛盾、缺口與待確認事項；更新 REQUIREMENTS.md，不撰寫架構或程式碼。'},
    {id:'REQ-PRD',title:'建立可驗收 PRD',repair_paths:['docs/prd.md'],repair_keywords:['functional requirement','產品需求'],max_turns:22,prompt:'只依已整理需求更新 PRD 的範圍、角色、流程、驗收條件與排除項目；不可編造未決商業規則。'}
  ],
  architecture:[
    {id:'ARCH-REQ-CONTEXT',title:'同步已核准需求精簡脈絡',repairable_from_gate:false,repair_paths:['docs/context/project_context.md'],repair_keywords:['需求精簡脈絡'],max_turns:10,prompt:'需求 Gate 已通過；現在只同步 docs/context/PROJECT_CONTEXT.md 的核准需求摘要、限制、未決事項與 Source of Truth 連結，不複製正文、不累加修訂歷程。'},
    {id:'ARCH-FOUNDATION',title:'架構邊界與正文',repair_paths:['docs/architecture/architecture.md'],repair_keywords:['archify evidence','部署假設','信任邊界'],max_turns:24,prompt:'只完成 ARCHITECTURE.md 的系統邊界、元件、資料流、資料完整性、安全控制、部署假設與取捨；暫不生成圖表。'},
    {id:'ARCH-ADR',title:'架構決策紀錄',repair_paths:['docs/decisions/'],repair_keywords:['adr ','架構決策'],max_turns:20,prompt:'只建立影響技術選型、資料正確性、安全或不可逆取捨的必要 ADR。每份新 ADR 必須標記 ADR-Admission: cross-cutting、irreversible、security 或 data-integrity 其中之一，並記錄被排除的替代方案；局部實作規則、部署數值、文件整理與可輕易回復的選擇應寫入 specification 或 release 設定，不得另立 ADR。架構 Gate 前新 ADR 一律標記 draft；只有技術決策完整且可由 Gate 核准者可加上 Gate-Eligible: true 與 Approval-Scope: technical。商業決策、操作者選擇或仍有未決內容者不得加此標記，維持 proposed 或 draft。同一決策族群應合併。每份 ADR 必須連結需求與取捨，不生成圖表，不在 README 累加複核歷程。'},
    {id:'ARCH-SYSTEM-SPEC',title:'系統架構圖規格',max_turns:10,prompt:'只建立或修復系統架構圖的結構化 architecture JSON。先檢查既有 JSON；若語意與需求仍有效就立即回傳 pass，不得產生 HTML、截圖或處理其他圖。'},
    {id:'ARCH-WORKFLOW-SPEC',title:'主要業務流程圖規格',max_turns:10,prompt:'只建立或修復一張主要跨角色業務流程圖的 workflow JSON。先檢查既有規格；若語意完整就立即回傳 pass，不產生 HTML 或截圖。'},
    {id:'ARCH-LIFECYCLE-SPEC',title:'關鍵實體生命週期圖規格',max_turns:10,prompt:'只建立或修復最關鍵實體的 lifecycle JSON；若既有規格完整就立即回傳 pass，不產生 HTML 或截圖。'},
    {id:'ARCH-DATAFLOW-SPEC',title:'資料流與信任邊界圖規格',max_turns:10,prompt:'只判斷系統架構圖是否已充分涵蓋資料流與信任邊界；若已涵蓋，以可追溯證據立即 pass，否則只建立結構化圖表 JSON。'},
    {id:'ARCH-SPEC-FREEZE',title:'圖表語意凍結審查',max_turns:16,prompt:'唯讀審查全部結構化圖表 JSON 與核准需求、架構正文、Draft ADR 是否一致。每次審查都必須重新讀取磁碟上的現行 JSON，不得沿用先前 session 對舊內容的記憶；若主張缺少節點、流程或授權語意，evidence 必須列出現行檔案路徑與可重現的具體證據。只回報會造成錯誤實作的阻斷缺陷；不得要求產生 HTML、圖片或純美化修改。全部通過才允許後續 deliver 與完整 visual-check。'},
    {id:'ARCH-SYSTEM-BUILD',title:'系統架構圖產生',max_turns:10,prompt:'只依語意已凍結的結構化 JSON 執行 Archify validate 與 deliver，產生或更新系統架構 HTML，不執行 visual-check。'},
    {id:'ARCH-SYSTEM-VERIFY',title:'系統架構圖最終驗證與證據',max_turns:10,prompt:'只對語意已凍結的最終系統架構產物執行完整 visual-check、雜湊與證據核對；不得重畫有效圖。'},
    {id:'ARCH-WORKFLOW-BUILD',title:'主要業務流程圖產生',max_turns:10,prompt:'只依語意已凍結的 workflow JSON 執行 validate 與 deliver，不執行 visual-check。'},
    {id:'ARCH-WORKFLOW-VERIFY',title:'主要業務流程圖最終驗證與證據',max_turns:10,prompt:'只對語意已凍結的最終主流程圖執行完整 visual-check、雜湊與證據核對；不得重做規格。'},
    {id:'ARCH-LIFECYCLE-BUILD',title:'關鍵實體生命週期圖產生',max_turns:10,prompt:'只依語意已凍結的 lifecycle JSON 執行 validate 與 deliver，不執行 visual-check。'},
    {id:'ARCH-LIFECYCLE-VERIFY',title:'關鍵實體生命週期圖最終驗證與證據',max_turns:10,prompt:'只對語意已凍結的最終生命週期圖執行完整 visual-check、狀態語意與證據核對。'},
    {id:'ARCH-DATAFLOW-BUILD',title:'資料流與信任邊界圖產生',max_turns:10,prompt:'若前一單元證明不需獨立圖，核對證據後立即 pass；否則只執行 validate 與 deliver，不做 visual-check。'},
    {id:'ARCH-DATAFLOW-VERIFY',title:'資料流與信任邊界圖最終驗證與證據',max_turns:10,prompt:'若不需獨立圖，核對可追溯理由後立即 pass；否則只對語意已凍結的最終產物執行完整 visual-check 與證據核對。'},
    {id:'ARCH-EVIDENCE-SYNC',title:'Archify 證據同步',repairable_from_gate:true,max_turns:6,prompt:'此單元由控制器確定性執行：讀取結構化規格、build receipt、HTML、raw visual receipt 與 effective visual acceptance，同步 docs/architecture/ARCHIFY_EVIDENCE.json。不得修改 semantic ARCHITECTURE.md。'}
  ],
  specification:[
    {id:'SPEC-ARCH-CONTEXT',title:'同步已核准架構精簡脈絡',repairable_from_gate:false,repair_paths:['docs/context/project_context.md'],repair_keywords:['架構精簡脈絡'],max_turns:12,prompt:'架構 Gate 已通過；現在只更新 docs/context/PROJECT_CONTEXT.md 的現行架構摘要、已核准 ADR、殘餘 Release risks 與證據連結。不複製正文、不累加修訂歷程。'},
    {id:'SPEC-BEHAVIOR',title:'功能行為與驗收規格',repair_paths:['docs/specs/behavior.md'],repair_keywords:['bhv-','功能行為'],max_turns:22,prompt:'只建立使用情境、狀態、邊界與驗收行為規格，按需求編號追溯。'},
    {id:'SPEC-DATA-API',title:'資料與 API 規格',repair_paths:['docs/specs/data_api.md'],repair_keywords:['idempotency','entity_type','entity_id','資料規則','api 契約'],max_turns:22,prompt:'只建立資料規則、API 契約、錯誤處理、冪等與一致性規格。'},
    {id:'SPEC-SECURITY-TEST',title:'安全與測試規格',repair_paths:['docs/specs/security_test.md'],repair_keywords:['csrf','rbac','authorization','authentication','sec-','nfr-','權限','授權','認證'],max_turns:20,prompt:'只建立權限、安全、稽核、測試矩陣與非功能驗收規格。'}
  ],
  planning:[
    {id:'PLAN-SPEC-CONTEXT',title:'同步已核准規格追溯摘要',repairable_from_gate:false,repair_paths:['docs/context/traceability.md'],repair_keywords:['追溯摘要'],max_turns:10,prompt:'規格 Gate 已通過；現在只更新 docs/context/TRACEABILITY.md，連結核准需求、規格與驗收證據，不複製正文、不累加修訂歷程。'},
    {id:'PLAN-TASKS',title:'建立原子開發任務',repair_paths:['docs/implementation_plan.md','.ai/task_graph.json'],repair_keywords:['write_scope','depends_on','parallel_policy','verification'],max_turns:24,prompt:'建立或修復 IMPLEMENTATION_PLAN.md 與 TASK_GRAPH.json；每個實作任務必須單一成果、明確相依、write_scope、risk、parallel_policy 與 verification argv 陣列。共用設定、套件鎖、Migration、認證、權限及資料遷移必須標示 serial。'},
    {id:'PLAN-VALIDATE',title:'檢查任務粒度與衝突',repair_keywords:['相依循環','檔案衝突','任務過大','原子性'],max_turns:18,prompt:'只檢查並修復任務是否過大、相依循環、檔案衝突、無法獨立驗證或缺少需求追溯。'}
  ],
  requirements_gate:[
    {id:'REQ-GATE-SCOPE',title:'範圍與商業規則審查',max_turns:18,prompt:'只以 docs/requirements/REQUIREMENTS.md 與 docs/PRD.md 為需求階段權威文件，審查需求範圍、角色、流程、商業規則、排除項目與未決問題；不可把尚未同步的 docs/context/PROJECT_CONTEXT.md 當成本 Gate 缺陷，不可修改檔案。'},
    {id:'REQ-GATE-ACCEPTANCE',title:'驗收與一致性審查',max_turns:18,prompt:'只以 docs/requirements/REQUIREMENTS.md 與 docs/PRD.md 為需求階段權威文件，審查每項需求是否可測試、具明確驗收條件且兩者一致；不可把尚未同步的 docs/context/PROJECT_CONTEXT.md 當成本 Gate 缺陷，不可修改檔案。'}
  ],
  architecture_gate:[
    {id:'ARCH-GATE-TRACE',title:'需求覆蓋與架構一致性審查',max_turns:22,prompt:'只審查需求到架構、ADR 與資料流的覆蓋及一致性；不可修改檔案。若通過，evidence 必須逐一列出實際審查且可核准的 Gate-Eligible technical Draft ADR 完整路徑；未點名者不得自動核准。'},
    {id:'ARCH-GATE-RISK',title:'安全、資料與部署風險審查',max_turns:22,prompt:'只審查安全、權限、資料完整性、故障邊界、容量與部署假設；不可修改檔案。'},
    {id:'ARCH-GATE-DIAGRAM',title:'Archify 證據審查',max_turns:20,prompt:'只審查結構化 Archify JSON、visual-check 收據與架構正文一致性；不得讀取完整生成 HTML 或圖片位元內容，不可修改檔案。'}
  ],
  specification_gate:[
    {id:'SPEC-GATE-TRACE',title:'需求與規格追溯審查',max_turns:18,prompt:'只審查每項需求是否有完整規格與驗收追溯；不可修改檔案。'},
    {id:'SPEC-GATE-QUALITY',title:'資料、API、安全與邊界審查',max_turns:20,prompt:'只審查資料、API、錯誤處理、安全、邊界與非功能規格；不可修改檔案。'}
  ],
  planning_gate:[
    {id:'PLAN-GATE-COVERAGE',title:'任務覆蓋與相依審查',max_turns:18,prompt:'只審查任務是否涵蓋核准規格、相依有效且無循環；不可修改檔案。'},
    {id:'PLAN-GATE-ATOMIC',title:'原子性與驗證審查',max_turns:18,prompt:'只審查每個任務是否單一成果、範圍合理、可獨立驗證且沒有檔案衝突；不可修改檔案。'}
  ],
  implementation_gate:[
    {id:'IMPL-GATE-DIFF',title:'變更正確性與迴歸審查',max_turns:22,prompt:'以 Git diff 與任務證據為入口，審查正確性、迴歸風險與可維護性；不可修改檔案。'},
    {id:'IMPL-GATE-SECURITY',title:'安全與資料完整性審查',max_turns:22,prompt:'只審查權限、安全、資料完整性、錯誤處理與高風險邊界；不可修改檔案。'},
    {id:'IMPL-GATE-TESTS',title:'測試與文件審查',max_turns:20,prompt:'只審查測試覆蓋、失敗情境、執行證據與文件同步；不可修改檔案。'}
  ],
  qa:[
    {id:'QA-ACCEPTANCE',title:'功能驗收與追溯',max_turns:24,prompt:'只執行需求與驗收條件對照的功能驗證，記錄可重現證據；不可修改實作。'},
    {id:'QA-REGRESSION',title:'回歸、安全與非功能驗證',max_turns:24,prompt:'只執行回歸、安全、資料完整性與可用非功能檢查，保留失敗摘要；不可修改實作。'},
    {id:'QA-EVIDENCE',title:'最終證據完整性審查',max_turns:18,prompt:'只確認所有驗收條件都有可重現通過證據，明確標記失敗或略過；不可修改實作。'}
  ],
  release_gate:[
    {id:'RELEASE-GATE-RISKS',title:'正式發布風險核對',max_turns:8,prompt:'只核對 .ai/RELEASE_RISKS.json 是否仍有 open 風險；不得重新審查開發內容。'}
  ]
};

const RESULT_SCHEMA = JSON.stringify({type:'object',properties:{outcome:{type:'string',enum:['pass','blocked','failed']},summary:{type:'string',maxLength:1200},evidence:{type:'array',maxItems:8,items:{type:'string',maxLength:500}},blocker:{type:['string','null'],maxLength:1600},gate_decision:{type:'string',enum:['pass','fail']},reviewed_adr_paths:{type:'array',maxItems:24,items:{type:'string',maxLength:240}},finding_results:{type:'array',maxItems:32,items:{type:'object',properties:{finding_instance_key:{type:'string',maxLength:80},pass:{type:'boolean'},evidence:{type:'string',maxLength:600}},required:['finding_instance_key','pass'],additionalProperties:false}},repair_targets:{type:'array',maxItems:12,items:{type:'string',maxLength:160}},findings:{type:'array',maxItems:12,items:{type:'object',properties:{severity:{type:'string'},blocking_stage:{type:'string',enum:['development','release']},category:{type:'string',maxLength:80},title:{type:'string',maxLength:180},summary:{type:'string',maxLength:800},source_files:{type:'array',maxItems:12,items:{type:'string',maxLength:240}},repair_targets:{type:'array',maxItems:12,items:{type:'string',maxLength:160}},repair_plan:{type:'array',minItems:1,maxItems:8,items:{type:'string',minLength:12,maxLength:600}},acceptance_check:{type:'array',maxItems:8,items:{type:'string',maxLength:500}}},required:['severity','blocking_stage','title','summary','repair_targets','repair_plan','acceptance_check'],additionalProperties:false}},strategy_reflection:{type:'object',properties:{previous_strategy:{type:'string',maxLength:600},failure_evidence:{type:'string',maxLength:800},root_cause:{type:'string',maxLength:800},new_strategy:{type:'string',maxLength:800},difference_from_previous:{type:'string',maxLength:600},files_to_change:{type:'array',maxItems:12,items:{type:'string',maxLength:240}},verification:{type:'array',maxItems:8,items:{type:'string',maxLength:500}}},required:['root_cause','new_strategy','difference_from_previous','verification'],additionalProperties:false},complexity_receipt:{type:'object',properties:{mode:{type:'string',enum:['off','lite','full','ultra']},rollout:{type:'string',enum:['shadow','enforce','off']},review_performed:{type:'boolean'},applied:{type:'boolean'},triggers:{type:'array',maxItems:12,items:{type:'string',maxLength:240}},reuse_decision:{type:'string',maxLength:500},native_or_stdlib_option:{type:'string',maxLength:500},new_dependency_justification:{type:['string','null'],maxLength:500},protected_complexity:{type:'array',maxItems:12,items:{type:'string',maxLength:240}},simplifications:{type:'array',maxItems:12,items:{type:'string',maxLength:500}},deferred_debt:{type:'array',maxItems:12,items:{type:'string',maxLength:500}}},required:['mode','rollout','review_performed','applied','triggers','reuse_decision','native_or_stdlib_option','new_dependency_justification','protected_complexity','simplifications','deferred_debt'],additionalProperties:false}},required:['outcome','summary','evidence','blocker'],additionalProperties:false});
const GATE_CACHE_VERSION=2;
const REPAIR_POLICY_VERSION='1.0.0';
const now = () => new Date().toISOString();
function taipeiTime(value) {
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) return String(value??'');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（台北）`;
}
const displayTaipeiTimes = value => String(value??'').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,match=>taipeiTime(match));
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, value) => { const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(t, p); };
const FIELD_LABELS={question:'問題',questions:'問題',open_questions:'待確認問題',reason:'原因',required:'需要補充',required_input:'需要補充',action:'處理方式',action_required:'操作者需執行',next_action:'下一個動作',details:'詳細資訊',message:'訊息',file:'檔案',files:'檔案'};
function displayText(value, depth=0) {
  if (value===null||value===undefined) return '';
  if (typeof value==='string'||typeof value==='number'||typeof value==='boolean') return displayTaipeiTimes(value);
  if (Array.isArray(value)) return value.map(v=>`${depth===0?'\n- ':'- '}${displayText(v,depth+1)}`).join('\n');
  if (typeof value==='object') return Object.entries(value).map(([k,v])=>`${depth===0?'\n- ':''}${FIELD_LABELS[k]??k}：${displayText(v,depth+1)}`).join('\n');
  return String(value);
}

function readKeyValueFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')&&line.includes('=')).map(line=>{ const at=line.indexOf('='); return [line.slice(0,at).trim(),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]; }));
}

async function notifyTelegram(project, event, title, state, detail='') {
  try {
    const secrets=readKeyValueFile(path.join(os.homedir(),'.config','page-autodev','telegram.env'));
    const token=secrets.TELEGRAM_BOT_TOKEN, chatId=secrets.TELEGRAM_CHAT_ID;
    if (!token||!chatId) { console.log('【Telegram 通知略過】尚未完成 Bot Token 或 Chat ID 設定。'); return false; }
    const projectName=path.basename(project);
    const signature=crypto.createHash('sha256').update(JSON.stringify({event,projectName,status:state?.status,phase:state?.phase,blocker:state?.blocker,next_action:state?.next_action,detail})).digest('hex');
    const notificationDir=path.join(os.homedir(),'.local','state','page-autodev','notifications');
    const notificationFile=path.join(notificationDir,`${safeName(projectName)}.json`);
    fs.mkdirSync(notificationDir,{recursive:true,mode:0o700});
    let previous={}; try { previous=readJson(notificationFile); } catch {}
    if(previous.signature===signature) { console.log('【Telegram 通知略過】相同狀態已通知過，避免重複推播。'); return true; }
    const lines=[
      title,
      '',
      `專案：${projectName}`,
      `狀態：${STATUS_LABELS[state?.status]??state?.status??'未知'}`,
      `階段：${PHASE_LABELS[state?.phase]??state?.phase??'未知'}`,
      `產品完成度：${state?productProgress(project,state):0}%`,
      `流程進度：${state?overallProgress(project,state).percent:0}%`
    ];
    if(detail) lines.push('',`說明：${displayText(detail)}`);
    if(state?.blocker) lines.push('',`阻塞原因：${displayText(state.blocker)}`);
    if(state?.next_action) lines.push('',`下一個動作：${displayText(state.next_action)}`);
    lines.push('',`時間：${taipeiTime(new Date())}`);
    const message=lines.join('\n').slice(0,4000);
    const response=await telegramPostWithRetry(`https://api.telegram.org/bot${token}/sendMessage`,{chat_id:chatId,text:message});
    if(!response.ok||!response.body.ok) throw new Error(response.body.description??`HTTP ${response.status}`);
    writeJson(notificationFile,{signature,event,sent_at:now()}); fs.chmodSync(notificationFile,0o600);
    console.log(`【Telegram 通知完成】${title}`); return true;
  } catch(error) {
    console.error(`【Telegram 通知失敗】${error.code??error.name??'NETWORK_ERROR'}｜${error.message}${error.cause?.message?`（${error.cause.message}）`:''}；已完成三次退避重試，自動開發狀態與日誌均已保留。`); return false;
  }
}
const safeName = s => { if (!/^[A-Za-z0-9._-]+$/.test(s)) throw new Error('專案名稱只能包含英文字母、數字、句點、底線與連字號。'); return s; };

function resolveProject(arg) {
  if (arg) return path.join(PROJECTS, safeName(arg));
  const cwd = fs.realpathSync(process.cwd());
  const base = fs.realpathSync(PROJECTS) + path.sep;
  if (!cwd.startsWith(base)) throw new Error('請在 ~/page-studio-dev/projects/<專案名稱> 內執行，或在指令後提供專案名稱。');
  return cwd;
}

function assertProject(project) {
  const real = fs.realpathSync(project), base = fs.realpathSync(PROJECTS) + path.sep;
  if (!real.startsWith(base)) throw new Error('專案不在受控的 Page Studio projects 根目錄內。');
  for (const rel of ['.git','CLAUDE.md','.ai/PROJECT_STATE.json','.ai/TASK_GRAPH.json','.ai/AUTODEV_CONFIG.json']) if (!fs.existsSync(path.join(real, rel))) throw new Error(`缺少必要檔案：${rel}`);
  return real;
}

function bootIdentity(){ try{ return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(); }catch{ return null; } }
function processStartIdentity(pid){
  if(!Number.isInteger(pid)||pid<1) return null;
  try{ const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).split(' '); return tail[19]??null; }catch{ return null; }
}
function lockOwnerIdentity(){ return {pid:process.pid,process_start_identity:processStartIdentity(process.pid),boot_id:bootIdentity(),owner_token:crypto.randomUUID(),created_at:now(),heartbeat_at:now()}; }
// 只有「擁有者確定不存在」才可回收；lock age 不再是充分條件，長時間 Architecture repair 不得被誤判為 stale。
function reclaimableLockOwner(owner){
  if(!owner||typeof owner!=='object') return {reclaimable:true,reason:'owner metadata 無法解析'};
  const boot=bootIdentity();
  if(owner.boot_id&&boot&&owner.boot_id!==boot) return {reclaimable:true,reason:'boot_id 不一致，擁有者屬於上一次開機'};
  if(!processAlive(owner.pid)) return {reclaimable:true,reason:`owner PID ${owner.pid} 已不存在`};
  const identity=processStartIdentity(owner.pid);
  if(owner.process_start_identity&&identity&&owner.process_start_identity!==identity) return {reclaimable:true,reason:`PID ${owner.pid} 已被重用，process start identity 不一致`};
  return {reclaimable:false,reason:`owner PID ${owner.pid} 仍存活`};
}
function lock(project) {
  if(process.env.PAGE_AUTODEV_PROJECT_LOCKED!==path.basename(project)) {
    const error=new Error(`${CONCURRENCY_CODES.automation}/${CONCURRENCY_CODES.conflict}: top-level execution 未持有 project-scoped OS lock`); error.code=CONCURRENCY_CODES.conflict; throw error;
  }
  const dir = path.join(project,'.ai','autodev.lock');
  try { fs.mkdirSync(dir); }
  catch {
    let verdict; try { verdict=reclaimableLockOwner(readJson(path.join(dir,'owner.json'))); } catch { verdict={reclaimable:true,reason:'owner.json 遺失或損毀'}; }
    if (!verdict.reclaimable) throw new Error(`另一個自動化程序正在執行此專案（${verdict.reason}）。執行鎖位置：${dir}`);
    console.log(`【執行鎖回收】${verdict.reason}；安全接管 ${dir}。`);
    fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir);
  }
  fs.writeFileSync(path.join(dir,'owner.json'), JSON.stringify(lockOwnerIdentity()));
  return () => fs.rmSync(dir,{recursive:true,force:true});
}

const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function processAlive(pid) {
  if (!Number.isInteger(pid)||pid<2) return false;
  try { process.kill(pid,0); return true; } catch { return false; }
}
function lockOwner(project) {
  try { return readJson(path.join(project,'.ai','autodev.lock','owner.json')); } catch { return null; }
}
function quotaUnitPrefix(project) { return `page-autodev-quota-${path.basename(project)}-`; }
function projectRuntimeUnits(project) {
  const name=path.basename(project),prefix=quotaUnitPrefix(project),base=[`page-autodev@${name}.service`,`page-autodev@${name}.timer`];
  const result=spawnSync('systemctl',['--user','list-units','--all','--plain','--no-legend','--full',`${prefix}*.service`,`${prefix}*.timer`],{encoding:'utf8'});
  const discovered=result.status===0?String(result.stdout??'').split(/\r?\n/).map(line=>line.trim().split(/\s+/)[0]).filter(unit=>unit?.startsWith(prefix)):[];
  return [...new Set([...base,...discovered])];
}
function unitState(unit) {
  const result=spawnSync('systemctl',['--user','show',unit,'--property=LoadState,ActiveState,SubState','--value'],{encoding:'utf8'});
  const [load='not-found',active='inactive',sub='dead']=String(result.stdout??'').trim().split(/\r?\n/);
  return {unit,load,active,sub,running:['active','activating','reloading','deactivating'].includes(active)};
}
function runtimeStatus(project) {
  const owner=lockOwner(project),ownerAlive=processAlive(owner?.pid),units=projectRuntimeUnits(project).map(unitState),activeUnits=units.filter(item=>item.running);
  return {owner,ownerAlive,units,activeUnits,running:ownerAlive||activeUnits.some(item=>item.unit.endsWith('.service'))};
}
function stopProject(project,{timeoutMs=30000}={}) {
  project=assertProject(project); const marker=path.join(project,'.ai','AUTODEV_STOP'),statePath=path.join(project,'.ai','PROJECT_STATE.json');
  fs.writeFileSync(marker,now()+'\n'); enable(project,false);
  const name=path.basename(project),before=runtimeStatus(project),units=before.units.map(item=>item.unit);
  spawnSync('systemctl',['--user','disable','--now',`page-autodev@${name}.timer`],{encoding:'utf8'});
  if(units.length) spawnSync('systemctl',['--user','stop',...units],{encoding:'utf8'});
  if(before.ownerAlive) { try { process.kill(before.owner.pid,'SIGTERM'); } catch {} }
  const deadline=Date.now()+Math.max(1000,timeoutMs); let after=runtimeStatus(project);
  while(after.running&&Date.now()<deadline){ sleepSync(250); after=runtimeStatus(project); }
  if(!after.running){
    const lockDir=path.join(project,'.ai','autodev.lock'); if(!processAlive(lockOwner(project)?.pid)) fs.rmSync(lockDir,{recursive:true,force:true});
    const state=readJson(statePath); state.status='stopped'; state.blocker=null; state.resume_after=null; state.next_action='等待操作者明確執行 page-autodev resume'; state.updated_at=now(); writeJson(statePath,state);
  }
  return {complete:!after.running,before,after};
}

function appendHistory(state, entry) {
  const compact=value=>String(value??'').slice(0,1200),normalized={...entry};
  if('summary' in normalized) normalized.summary=compact(normalized.summary);
  if('evidence' in normalized) normalized.evidence=(Array.isArray(normalized.evidence)?normalized.evidence:[normalized.evidence]).filter(Boolean).slice(0,8).map(item=>compact(item).slice(0,500));
  if('quality_checks' in normalized) normalized.quality_checks=(normalized.quality_checks??[]).slice(0,12).map(item=>({...item,detail:compact(item.detail).slice(0,500)}));
  state.history ??= []; state.history.push(normalized); if (state.history.length > 100) state.history = state.history.slice(-100);
}

const TASK_COMPLETE_STATUSES = new Set(['complete','completed','done','passed']);
function taskComplete(task) { return TASK_COMPLETE_STATUSES.has(String(task?.status??'').toLowerCase()); }

function taskGraphDone(project) {
  const graph = readJson(path.join(project,'.ai','TASK_GRAPH.json'));
  const implementation = graph.tasks.filter(t => !String(t.id).startsWith('REQ-'));
  return implementation.length > 0 && implementation.every(taskComplete);
}
function phaseGraphPath(project) { return path.join(project,'.ai','PHASE_TASK_GRAPH.json'); }
function inputFiles(project) {
  const root=path.join(project,'docs','input'), files=[];
  if(!fs.existsSync(root)) return files;
  const walk=dir=>{ for(const item of fs.readdirSync(dir,{withFileTypes:true})) { const full=path.join(dir,item.name); if(item.isDirectory()) walk(full); else if(!['README.md','INDEX.md','.gitkeep'].includes(item.name)) files.push(path.relative(project,full)); } };
  walk(root); return files.sort();
}
function buildWorkUnits(project,phase) {
  if(phase==='implementation') {
    const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json'));
    return (graph.tasks??[]).filter(task=>!String(task.id).startsWith('REQ-')).map(task=>({
      ...task,
      repair_paths:task.write_scope??[],
      repair_keywords:[task.id,task.title].filter(Boolean)
    }));
  }
  if(phase==='input_analysis') {
    const files=inputFiles(project), batches=[];
    for(let at=0;at<files.length;at+=6) { const group=files.slice(at,at+6); batches.push({id:`INPUT-BATCH-${String(batches.length+1).padStart(3,'0')}`,title:`分析原始資料批次 ${batches.length+1}`,max_turns:16,prompt:`只分析下列原始檔案並把結論合併至 docs/context/INPUT_DIGEST.md 與索引；不得重新讀取其他已完成批次：\n${group.map(file=>`- ${file}`).join('\n')}`,files:group}); }
    if(!batches.length) batches.push({id:'INPUT-EMPTY-CHECK',title:'確認原始資料狀態',max_turns:8,prompt:'確認 docs/input/ 是否只有說明與索引；若沒有實際專案資料，必須回傳 blocked 並列出操作者需要提供的資料。'});
    batches.push({id:'INPUT-INTEGRATE',title:'整合原始資料索引',max_turns:12,prompt:'只整合已完成批次，更新 docs/input/INDEX.md、.ai/INPUT_INDEX.json 與 docs/context/INPUT_DIGEST.md；檢查每筆來源路徑、SHA-256、擷取時間與轉換限制。'});
    return batches;
  }
  return (STATIC_WORK_UNITS[phase]??[]).map(unit=>({...unit}));
}
function loadPhaseGraph(project) {
  const file=phaseGraphPath(project);
  if(!fs.existsSync(file)) return {schema_version:1,revision:0,phases:{}};
  try { const graph=readJson(file); graph.phases??={}; return graph; } catch { return {schema_version:1,revision:0,phases:{}}; }
}
function migrateArchitectureDiagramUnits(project,graph,plan){
  const mappings={
    'ARCH-SYSTEM-DIAGRAM':{prefix:'ARCH-SYSTEM',title:'系統架構圖',spec:'docs/architecture/diagrams/system-architecture.architecture.json',html:'docs/architecture/diagrams/system-architecture.html'},
    'ARCH-WORKFLOW-DIAGRAM':{prefix:'ARCH-WORKFLOW',title:'主要業務流程圖',spec:'docs/architecture/diagrams/work-order-flow.workflow.json',html:'docs/architecture/diagrams/work-order-flow.html'},
    'ARCH-LIFECYCLE-DIAGRAM':{prefix:'ARCH-LIFECYCLE',title:'關鍵實體生命週期圖',spec:'docs/architecture/diagrams/work-order-lifecycle.lifecycle.json',html:'docs/architecture/diagrams/work-order-lifecycle.html'},
    'ARCH-DATAFLOW-DIAGRAM':{prefix:'ARCH-DATAFLOW',title:'資料流與信任邊界圖',spec:null,html:null}
  };
  let changed=false;
  for(const [legacyId,map] of Object.entries(mappings)){
    const index=plan.units.findIndex(unit=>unit.id===legacyId); if(index<0||plan.units[index].status==='complete') continue;
    const legacy=plan.units[index],created=legacy.created_at??now(),specExists=map.spec&&fs.existsSync(path.join(project,map.spec)),htmlExists=map.html&&fs.existsSync(path.join(project,map.html));
    const base=(id,title,maxTurns,prompt,status,depends)=>({id,title,max_turns:maxTurns,prompt,status,attempt:0,continuations:0,no_progress_count:0,depends_on:depends,evidence:status==='complete'?[`由舊工作單元 ${legacyId} 遷移；既有檔案已存在，保留成果不重做。`]:[],files_changed:[],created_at:created,migrated_from:legacyId});
    const spec=base(`${map.prefix}-SPEC`,`${map.title}規格`,10,`只檢查或完成「${map.title}」結構化規格；既有有效成果不得重做。`,specExists?'complete':'pending',legacy.depends_on??[]);
    const build=base(`${map.prefix}-BUILD`,`${map.title}產生`,10,`只完成「${map.title}」validate 與 deliver；不得進行視覺驗證。`,htmlExists?'complete':'pending',[spec.id]);
    const verify=base(`${map.prefix}-VERIFY`,`${map.title}驗證與證據`,12,`只完成「${map.title}」showcase、visual-check、語意追溯與證據收尾；先檢查既有收據，不得重做有效圖，完成後立即回傳結構化結果。`,'pending',[build.id]);
    plan.units.splice(index,1,spec,build,verify);
    for(const unit of plan.units) unit.depends_on=(unit.depends_on??[]).map(id=>id===legacyId?verify.id:id);
    changed=true;
    console.log(`【工作單元自動細分】${legacyId} 已拆成規格、產生、驗證三段；既有規格：${specExists?'保留':'待完成'}，既有 HTML：${htmlExists?'保留':'待完成'}。`);
  }
  if(changed){ plan.updated_at=now(); graph.revision=(graph.revision??0)+1; }
  return changed;
}
function migratePhasePlanToCurrent(project,phase,graph,plan){
  const canonical=buildWorkUnits(project,phase); if(!canonical.length) return false;
  const existing=new Map(plan.units.map(unit=>[unit.id,unit])); let changed=false;
  const readOnlyParallel=PHASES[phase]?.kind==='gate';
  const units=canonical.map((definition,index)=>{
    const previous=existing.get(definition.id);
    if(previous) return {...previous,...definition,depends_on:readOnlyParallel?[]:(index?[canonical[index-1].id]:[]),parallel_safe:readOnlyParallel};
    changed=true;
    return {...definition,status:definition.status??'pending',attempt:0,continuations:0,no_progress_count:0,depends_on:readOnlyParallel?[]:(definition.depends_on??(index?[canonical[index-1].id]:[])),parallel_safe:readOnlyParallel,evidence:definition.evidence??[],files_changed:definition.files_changed??[],created_at:now(),migrated_by:'workflow-v2'};
  });
  const retired=plan.units.filter(unit=>!canonical.some(item=>item.id===unit.id));
  if(retired.length){ plan.retired_units??=[]; plan.retired_units.push(...retired.map(unit=>({...unit,retired_at:now(),retired_reason:'新版工作單元已取代'}))); changed=true; }
  if(plan.units.map(unit=>unit.id).join('|')!==units.map(unit=>unit.id).join('|')) changed=true;
  if(changed){ plan.units=units; plan.workflow_version=2; plan.updated_at=now(); graph.schema_version=2; graph.revision=(graph.revision??0)+1; console.log(`【既有專案安全遷移】「${PHASE_LABELS[phase]??phase}」保留既有成果，補入 ${units.filter(unit=>unit.migrated_by==='workflow-v2').length} 個新版工作單元；未刪除專案內容。`); }
  return changed;
}
function ensurePhasePlan(project,phase,state) {
  const graph=loadPhaseGraph(project), inputRevision=state.input_revision??0;
  let plan=graph.phases[phase];
  if(!plan||plan.input_revision!==inputRevision) {
    let raw=buildWorkUnits(project,phase);
    if(PHASES[phase]?.kind==='gate'&&state.gate_verification_mode==='targeted'&&state.active_findings?.length){
      const store=loadFindings(project),wanted=new Set(store.findings.filter(item=>state.active_findings.includes(item.id)).flatMap(item=>String(item.gate_unit??'').split('、'))),filtered=raw.filter(unit=>wanted.has(unit.id)); if(filtered.length) raw=filtered;
    }
    const readOnlyParallel=PHASES[phase]?.kind==='gate';
    const units=raw.map((unit,index)=>({...unit,status:'pending',attempt:0,continuations:0,no_progress_count:0,depends_on:readOnlyParallel?[]:(index?[raw[index-1].id]:[]),parallel_safe:readOnlyParallel,evidence:[],files_changed:[],created_at:now()}));
    plan={status:'in_progress',input_revision:inputRevision,created_at:now(),updated_at:now(),units}; graph.phases[phase]=plan; graph.revision=(graph.revision??0)+1; writeJson(phaseGraphPath(project),graph);
    console.log(`【工作單元規劃】「${PHASE_LABELS[phase]??phase}」已預先拆分為 ${units.length} 個可續跑子任務。`);
  }
  else {
    const latestLimits=new Map(buildWorkUnits(project,phase).map(unit=>[unit.id,unit.max_turns]));
    let limitsChanged=false;
    for(const unit of plan.units) {
      const latest=latestLimits.get(unit.id);
      if(Number.isFinite(latest)&&unit.max_turns!==latest) { unit.max_turns=latest; limitsChanged=true; }
    }
    if(limitsChanged) { plan.updated_at=now(); graph.revision=(graph.revision??0)+1; writeJson(phaseGraphPath(project),graph); console.log(`【Turns 預算更新】「${PHASE_LABELS[phase]??phase}」已套用依任務類型配置的新預算。`); }
    if(phase==='architecture'&&migrateArchitectureDiagramUnits(project,graph,plan)) writeJson(phaseGraphPath(project),graph);
    if(migratePhasePlanToCurrent(project,phase,graph,plan)) writeJson(phaseGraphPath(project),graph);
    if(PHASES[phase]?.kind==='gate'&&!plan.units.some(unit=>unit.status==='running')) {
    let changed=false;
    for(const unit of plan.units) if(unit.status!=='complete'&&(unit.parallel_safe!==true||(unit.depends_on??[]).length)) { unit.parallel_safe=true; unit.depends_on=[]; changed=true; }
    if(changed) { plan.updated_at=now(); graph.revision=(graph.revision??0)+1; writeJson(phaseGraphPath(project),graph); console.log(`【併行計畫升級】「${PHASE_LABELS[phase]??phase}」未完成的唯讀審查單元已標記為可安全併行。`); }
    }
  }
  return {graph,plan};
}
function currentWorkUnit(plan) { const complete=new Set(plan.units.filter(unit=>unit.status==='complete').map(unit=>unit.id)); return plan.units.find(unit=>unit.status!=='complete'&&(unit.depends_on??[]).every(id=>complete.has(id)))??null; }
function readyWorkUnits(plan) { const complete=new Set(plan.units.filter(unit=>unit.status==='complete').map(unit=>unit.id)); return plan.units.filter(unit=>!['complete','running'].includes(unit.status)&&(unit.depends_on??[]).every(id=>complete.has(id))); }
function parallelReadOnlyUnits(plan,phase,config) {
  const parallel=config.parallel_execution??{};
  if(parallel.enabled===false||parallel.read_only_gates===false||PHASES[phase]?.kind!=='gate') return [];
  const limit=parallelConcurrency(parallel,'read');
  return readyWorkUnits(plan).filter(unit=>unit.parallel_safe===true).slice(0,limit);
}
function phasePlanDone(plan) { return plan.units.length>0&&plan.units.every(unit=>unit.status==='complete'); }
function savePhaseGraph(project,graph) { graph.updated_at=now(); writeJson(phaseGraphPath(project),graph); }
function resetPhasePlan(project,phase) { const graph=loadPhaseGraph(project); if(graph.phases[phase]) { delete graph.phases[phase]; graph.revision=(graph.revision??0)+1; savePhaseGraph(project,graph); } }
function registerRepairCycle(state,gatePhase,targets,config,diagnosticKey='',openDevelopmentCount=null,materialSignature=null) {
  state.repair_guard??={}; const key=`${gatePhase}:${state.input_revision??0}`, guard=state.repair_guard[key]??={total:0,signatures:{}};
  const targetSignature=targets.slice().sort().join('|'),signature=`${targetSignature}::${diagnosticKey||'未提供診斷識別'}`; guard.total+=1; guard.signatures[signature]=(guard.signatures[signature]??0)+1; guard.last_targets=targets; guard.last_diagnostic_key=diagnosticKey||null; guard.updated_at=now(); state.repair_guard[key]=guard;
  let progressed=false;
  // 雙訊號：未結案數下降，或實質 artifact/evidence 指紋改變，都算真正的進展。
  const materialChanged=Boolean(materialSignature)&&guard.last_material_signature!==undefined&&guard.last_material_signature!==materialSignature;
  if(materialSignature) guard.last_material_signature=materialSignature;
  if(Number.isFinite(openDevelopmentCount)){ if(!Number.isFinite(guard.best_open_development_count)||openDevelopmentCount<guard.best_open_development_count){ guard.best_open_development_count=openDevelopmentCount; guard.consecutive_no_progress=0; progressed=true; } else if(materialChanged){ guard.consecutive_no_progress=0; progressed=true; } else guard.consecutive_no_progress=(guard.consecutive_no_progress??0)+1; guard.last_open_development_count=openDevelopmentCount; }
  else if(materialChanged){ guard.consecutive_no_progress=0; progressed=true; }
  // 相同目標＋相同 finding 但確實有實質進展時，不得沿用舊的 same-target 計數熔斷。
  if(materialChanged) guard.signatures[signature]=1;
  const maxTotal=Number(config.repair_loops?.max_hard_total_per_gate??20),maxSame=Number(config.repair_loops?.max_same_target??2),maxNoProgress=Number(config.repair_loops?.max_consecutive_no_progress??3);
  return {blocked:guard.total>maxTotal||guard.signatures[signature]>maxSame||(guard.consecutive_no_progress??0)>=maxNoProgress,total:guard.total,same:guard.signatures[signature],maxTotal,maxSame,signature,progressed,openDevelopmentCount,noProgress:guard.consecutive_no_progress??0,maxNoProgress};
}
function declaredRepairOwners(plan,value){
  const lower=String(value??'').toLowerCase().replaceAll('\\','/'),owners=[];
  for(const unit of plan.units){
    if(unit.repairable_from_gate===false) continue;
    const paths=[...(unit.repair_paths??[]),...(unit.write_scope??[])].map(item=>String(item).toLowerCase().replaceAll('\\','/'));
    const keywords=(unit.repair_keywords??[]).map(item=>String(item).toLowerCase());
    if(paths.some(item=>item&&lower.includes(item))||keywords.some(item=>item&&lower.includes(item))) owners.push(unit.id);
  }
  return owners;
}
function normalizeRepairSuggestions(plan,suggestions=[]){
  const valid=new Set(plan.units.map(unit=>unit.id)),mapped=new Set(),ignored=[];
  const add=id=>{ if(valid.has(id)) mapped.add(id); };
  for(const raw of suggestions){
    const value=String(raw??''),lower=value.toLowerCase(); let matched=false;
    for(const id of declaredRepairOwners(plan,value)){ add(id); matched=true; }
    for(const id of valid) if(value.includes(id)){ add(id); matched=true; }
    const rules=[
      [/docs\/requirements\/requirements\.md|\brequirements\.md\b|open questions?|\boq\d+\b|unresolved-\d+/i,['REQ-ANALYZE']],
      [/docs\/prd\.md|\bprd\.md\b|functional requirements?/i,['REQ-PRD']],
      [/docs\/architecture\/architecture\.md|system-architecture.*語意追溯|archify evidence/i,['ARCH-FOUNDATION']],
      [/docs\/decisions\/|\badr\s*0*\d+/i,['ARCH-ADR']],
      [/docs\/context\/project_context\.md/i,[]],
      [/system-architecture\.architecture\.json/i,['ARCH-SYSTEM-SPEC']],
      [/system-architecture\.html/i,['ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY']],
      [/system-architecture\.visual-check\.json/i,['ARCH-SYSTEM-VERIFY']],
      [/work-order-flow\.workflow\.json/i,['ARCH-WORKFLOW-SPEC']],
      [/work-order-flow\.html/i,['ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY']],
      [/work-order-flow\.visual-check\.json/i,['ARCH-WORKFLOW-VERIFY']],
      [/work-order-lifecycle\.lifecycle\.json/i,['ARCH-LIFECYCLE-SPEC']],
      [/work-order-lifecycle\.html/i,['ARCH-LIFECYCLE-BUILD','ARCH-LIFECYCLE-VERIFY']],
      [/work-order-lifecycle\.visual-check\.json/i,['ARCH-LIFECYCLE-VERIFY']],
      [/data-trust-boundary\.dataflow\.json/i,['ARCH-DATAFLOW-SPEC']],
      [/data-trust-boundary\.html/i,['ARCH-DATAFLOW-BUILD','ARCH-DATAFLOW-VERIFY']],
      [/data-trust-boundary\.visual-check\.json/i,['ARCH-DATAFLOW-VERIFY']]
      ,[/docs\/specs\/behavior\.md|\bbehavior\.md\b|bhv-[a-z0-9-]+/i,['SPEC-BEHAVIOR']]
      ,[/docs\/specs\/data[_-]api\.md|\bdata[_-]api\.md\b|\/api\/|entity_type|entity_id|idempotency|work_order_sequence/i,['SPEC-DATA-API']]
      ,[/docs\/specs\/security[_-]test\.md|\bsecurity[_-]test\.md\b|sec-[a-z0-9-]+|nfr-[a-z0-9-]+|csrf|rbac|authorization|authentication|權限|授權|認證/i,['SPEC-SECURITY-TEST']]
      ,[/\.ai\/task_graph\.json|docs\/implementation_plan\.md|\b(?:be|fe|db|infra|int|ops|doc|sec)-[a-z0-9-]+\b|write_scope|depends_on|verification/i,['PLAN-TASKS']]
    ];
    for(const [pattern,ids] of rules) if(pattern.test(lower)){ ids.forEach(add); matched=true; }
    if(!matched) ignored.push(value);
  }
  if(!mapped.size&&suggestions.some(item=>String(item??'').trim())){
    const candidates=plan.units.filter(unit=>unit.repairable_from_gate!==false);
    if(candidates.length===1) mapped.add(candidates[0].id);
  }
  for(const family of ['SYSTEM','WORKFLOW','LIFECYCLE','DATAFLOW']){
    if(!mapped.has(`ARCH-${family}-SPEC`)) continue;
    mapped.delete(`ARCH-${family}-BUILD`);
    mapped.delete(`ARCH-${family}-VERIFY`);
  }
  return {mapped:[...mapped],ignored};
}
function findingRepairSuggestions(finding={}){
  return [
    ...normalizeStringList(finding.repair_targets),
    ...normalizeStringList(finding.source_files),
    ...normalizeStringList(finding.repair_plan),
    ...normalizeStringList(finding.acceptance_check),
    finding.title,
    finding.summary
  ].filter(Boolean);
}
function inferFindingRepairTargets(plan,finding={}){
  const tiers=[normalizeStringList(finding.repair_targets),normalizeStringList(finding.repair_plan),normalizeStringList(finding.source_files),normalizeStringList(finding.acceptance_check),[finding.title,finding.summary].filter(Boolean)];
  for(const suggestions of tiers){ const result=normalizeRepairSuggestions(plan,suggestions); if(result.mapped.length) return result; }
  return {mapped:[],ignored:findingRepairSuggestions(finding)};
}
function preferDedicatedRepairOwner(plan,targets=[]){
  const valid=new Set(plan.units.map(unit=>unit.id)),mapped=[...new Set(normalizeStringList(targets).filter(id=>valid.has(id)))];
  const dedicated=plan.units.filter(unit=>/-GATE-REPAIR-[A-Z0-9-]+$/i.test(unit.id));
  if(!dedicated.length) return mapped;
  const owner=dedicated.find(unit=>mapped.includes(unit.id))??dedicated.at(-1);
  const inherited=mapped.filter(id=>id!==owner.id).flatMap(id=>plan.units.find(unit=>unit.id===id)?.write_scope??[]);
  owner.write_scope=[...new Set([...(owner.write_scope??[]),...inherited])];
  return mapped.length?[owner.id]:mapped;
}
function atomicRepairScope(plan,findings,scope,maxTargets=3){
  if(!scope.over_scope||scope.targets.length>Math.max(1,Number(maxTargets)||3)) return scope;
  const valid=new Set(plan.units.map(unit=>unit.id));
  const owner=(findings??[]).find(finding=>{
    const direct=[...new Set(normalizeStringList(finding.repair_targets).filter(id=>valid.has(id)))];
    return direct.length===scope.targets.length&&scope.targets.every(id=>direct.includes(id));
  });
  if(!owner) return scope;
  return {...scope,over_scope:false,atomic_group:true,base_limit:scope.limit,limit:scope.targets.length,atomic_finding:owner.id??owner.title??'unnamed'};
}
function prepareTargetedGateRepair(project,state,config,failedGatePhase,repairPhase,unitId,verdict) {
  state.phase=repairPhase;
  const {graph,plan}=ensurePhasePlan(project,repairPhase,state);
  const inferredFindings=[]; if(Array.isArray(verdict.findings)) for(const finding of verdict.findings){ const result=inferFindingRepairTargets(plan,finding); finding.repair_targets=preferDedicatedRepairOwner(plan,result.mapped); inferredFindings.push(...finding.repair_targets); }
  const raw=[...normalizeStringList(verdict.repair_targets),...inferredFindings],normalized=normalizeRepairSuggestions(plan,raw); verdict.repair_targets=normalized.mapped;
  const findingResult=upsertGateFindings(project,{gatePhase:failedGatePhase,unitId,verdict,inputRevision:state.input_revision??0});
  for(const finding of findingResult.touched) finding.repair_targets=preferDedicatedRepairOwner(plan,finding.repair_targets);
  const suggested=[...verdict.repair_targets,...findingResult.touched.flatMap(item=>item.repair_targets??[])],finalNormalized=normalizeRepairSuggestions(plan,[...new Set(suggested)]),baseScope=resolveRepairTargets({suggested:finalNormalized.mapped,plan,maxFraction:resolveRepairSafetyPolicy(config).maxFraction}),scope=atomicRepairScope(plan,findingResult.touched,baseScope,config.repair_loops?.max_atomic_target_count??3),targets=scope.targets;
  if(normalized.ignored.length) console.log(`【修復目標正規化】已忽略 ${normalized.ignored.length} 項非本階段或無法對應的路徑建議；不因此阻塞可執行的定點修復。`);
  if(scope.atomic_group) console.log(`【原子修復群組】${scope.atomic_finding} 明確同時涵蓋 ${targets.join('、')}；一般安全上限仍為 ${scope.base_limit}，本輪僅對此單一 finding 受控放行 ${scope.limit} 個工作單元。`);
  if(scope.empty||scope.over_scope) {
    state.status='blocked'; state.blocker=scope.empty?`${unitId} 未提供可映射至本階段工作單元的 repair_targets`:`${unitId} 的修復目標 ${targets.length} 個超過安全上限 ${scope.limit}`; state.next_action='請檢查 GATE_FINDINGS.json 的修復目標後執行 page-autodev resume'; writeJson(path.join(project,'.ai','PROJECT_STATE.json'),state); return {blocked:true,targets,guard:{total:0,same:0,maxTotal:0,maxSame:0},scope};
  }
  const diagnosticKey=findingResult.touched.map(item=>item.id).sort().join('|')||crypto.createHash('sha256').update(String(verdict.summary??verdict.blocking_reason??'')).digest('hex').slice(0,16);
  const openDevelopmentCount=findingResult.store.findings.filter(item=>['open','reopened','repairing'].includes(item.status)&&item.blocking_stage!=='release').length;
  const guard=registerRepairCycle(state,failedGatePhase,targets,config,diagnosticKey,openDevelopmentCount,materialProgressSignature(project,{visualQualityProfile:resolveArchitectureQualityPolicy(config).visual_acceptance_quality}));
  if(guard.blocked) {
    state.status='blocked'; state.blocker=`${unitId} 的自動修復已達安全上限：同一 Gate 共 ${guard.total}/${guard.maxTotal} 輪；相同修復目標與 finding ${guard.same}/${guard.maxSame} 輪；未結案 development findings ${guard.openDevelopmentCount??'未知'} 項，連續無進展 ${guard.noProgress}/${guard.maxNoProgress} 輪。最後診斷：${verdict.summary}`; state.next_action='請操作者檢查 Gate 證據與修復目標，調整後再執行 page-autodev resume'; writeJson(path.join(project,'.ai','PROJECT_STATE.json'),state); return {blocked:true,targets,guard};
  }
  const findingIds=findingResult.touched.map(item=>item.id),reflectionRequired=findingResult.touched.some(needsReflection); beginRepair(findingResult.store,findingIds,verdict.strategy_reflection??null); saveFindings(project,findingResult.store);
  const feedbackForTarget=targetId=>{
    const relevant=findingResult.touched.filter(item=>(item.repair_targets??[]).includes(targetId)),ids=relevant.map(item=>item.id),needs= relevant.some(needsReflection);
    const header=`來源 Gate：${unitId}\nFinding：${ids.join('、')}\n控制器核准修復目標：${targetId}\n失敗摘要：${relevant.map(item=>item.title).join('；')}\n證據：${(verdict.evidence??[]).join('\n')}${needs?'\n此缺陷已重複出現；必須回傳 strategy_reflection，說明前次失敗根因、本次不同策略與驗證方式。':''}`;
    const plan='\n可執行修復計畫：\n'+relevant.map(item=>item.id+'｜'+item.title+'\n根因／缺陷：'+item.summary+'\n依序修復：\n'+normalizeStringList(item.repair_plan).map((step,index)=>(index+1)+'. '+step).join('\n')+'\n完成驗收：\n'+normalizeStringList(item.acceptance_check).map(check=>'- '+check).join('\n')).join('\n\n')+'\n只處理屬於目前任務 write_scope 的步驟；其他步驟已分派給其檔案所有者，不得跨任務代辦。控制器因 Gate finding 明確將此既有任務重開，即構成對其原 write_scope 的定點修復授權；governance_rules 的「一次／依序修改」限制用於阻止其他未授權任務，不能用來拒絕 Gate 明確要求的原所有者修復。不得新增 write_scope 外檔案或未獲 finding 要求的套件。';
    return {feedback:header+plan,findingIds:ids,reflectionRequired:needs};
  };
  // semantic owner 才接受 machine_feedback 並進入 repairing；BUILD／VERIFY／FREEZE／EVIDENCE-SYNC
  // 一律整代失效（清掉上一版 evidence／session），避免 pending 單元仍攜帶舊世代證據。
  const derivedInvalidations=[...new Set([...(scope.derived_invalidations??[]),...(scope.deterministic_repair_actions??[])])];
  for(const unit of plan.units) if(targets.includes(unit.id)) {
    const assigned=feedbackForTarget(unit.id);
    unit.status='repairing';
    unit.machine_feedback=assigned.feedback; unit.repair_source=unitId; unit.finding_ids=assigned.findingIds; unit.reflection_required=assigned.reflectionRequired;
    unit.lifetime_continuations=(unit.lifetime_continuations??0)+(unit.continuations??0); unit.continuations=0; unit.no_progress_count=0; unit.repair_cycle_started_at=now();
    unit.updated_at=now(); delete unit.completed_at; delete unit.session_id;
  }
  for(const unit of plan.units) if(derivedInvalidations.includes(unit.id)&&!targets.includes(unit.id)) invalidateDerivedWorkUnit(unit,{reason:`上游 semantic 修復（${targets.join('、')}）使本單元整代失效`,at:now()});
  // 任一 semantic owner 重修都會使既有 Semantic Freeze 失去代表性；timestamp 不得跨世代偷渡。
  if(derivedInvalidations.includes(SEMANTIC_FREEZE_UNIT)||targets.some(id=>SEMANTIC_REPAIR_UNITS.includes(id))) {
    delete state.architecture_spec_frozen_at; delete state.semantic_freeze_fingerprint; delete state.architecture_generation_key;
  }
  if(repairPhase==='implementation') {
    const taskPath=path.join(project,'.ai','TASK_GRAPH.json'),taskGraph=readJson(taskPath);
    for(const task of taskGraph.tasks??[]) if(targets.includes(task.id)) {
      const assigned=feedbackForTarget(task.id); task.status='repairing'; task.machine_feedback=assigned.feedback; task.finding_ids=assigned.findingIds;
      task.continuations=0; task.no_progress_count=0; task.updated_at=now();
      delete task.completed_at; delete task.session_id; delete task.blocked_reason;
    }
    writeJson(taskPath,taskGraph);
  }
  plan.status='in_progress'; plan.updated_at=now(); delete graph.phases[failedGatePhase]; graph.revision=(graph.revision??0)+1; savePhaseGraph(project,graph);
  state.status='repairing'; state.blocker=verdict.summary; state.active_findings=findingIds; state.gate_verification_mode='repairing'; state.next_action=`定點修復 ${targets.join('、')}`; writeJson(path.join(project,'.ai','PROJECT_STATE.json'),state); return {blocked:false,targets,guard,scope,findingIds,derivedInvalidations};
}
function resolveRepairSafetyPolicy(config={}){
  const fraction=Number(config?.repair_loops?.max_target_fraction);
  return {maxFraction:Number.isFinite(fraction)&&fraction>0?fraction:0.4,maxAtomicTargetCount:Number(config?.repair_loops?.max_atomic_target_count??3)};
}
// 定點複驗必須逐筆對應 finding instance；沒有結果就不是通過。
function collectTargetedFindingResults(phasePlan,activeFindings=[]){
  const reported=new Map();
  for(const unit of phasePlan?.units??[]){
    for(const entry of unit.finding_results??[]){
      const id=entry?.finding_instance_key??entry?.finding_id??entry?.id; if(!id) continue;
      reported.set(String(id),{pass:entry.pass===true,evidence:entry.evidence??unit.last_summary??'定點 Gate 複驗'});
    }
  }
  const results=[],missing=[],failed=[];
  for(const id of activeFindings){
    const entry=reported.get(String(id));
    if(!entry){ missing.push(id); continue; }
    results.push({id,pass:entry.pass,evidence:entry.evidence});
    if(!entry.pass) failed.push(id);
  }
  return {results,missing,failed};
}
// 進展判定必須看實質 artifact/evidence 改變，不能只看 finding 數或 workflow status 轉移。
function materialProgressSignature(project,{visualQualityProfile='standard'}={}){
  const parts=[];
  try{ const freeze=readSemanticFreeze(project); parts.push(`freeze:${freeze?.semantic_fingerprint??'none'}`); }catch{ parts.push('freeze:none'); }
  for(const key of ['system','workflow','lifecycle','dataflow']){
    try{
      const provenance=buildProvenanceStatus(project,key,{});
      parts.push(`${key}:${provenance.current?'current':'stale'}:${provenance.htmlSha??'none'}:${provenance.specSha??'none'}`);
    }catch{ parts.push(`${key}:unknown`); }
  }
  try{ const facts=diagramVisualFacts(project,visualQualityProfile); for(const [base,item] of Object.entries(facts).sort()) parts.push(`vis:${base}:${item.effective_status}`); }catch{}
  try{ parts.push(`evidence:${evidenceSyncStatus(project,{visualQualityProfile}).current?'current':'stale'}`); }catch{}
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0,32);
}
// 真正的 single-shot：以 runtime context 表示，不永久修改 config。
const backgroundWakeAllowed=()=>process.env.PAGE_AUTODEV_NO_BACKGROUND!=='1';
function singleShotPause(state,kind,resumeAfter,detail){
  state.status=kind; state.resume_after=null; state.recommended_resume_after=resumeAfter;
  state.next_action=`single-shot 模式不建立自動喚醒；建議於 ${taipeiTime(resumeAfter)} 後再次手動執行 page-autodev resume-once。${detail??''}`.trim();
  return state;
}
// Gate 判讀所需的確定性事實（所有 Gate 入口共用同一組）。
function gateDeterministicFacts(project,config){
  const quality=resolveArchitectureQualityPolicy(config).visual_acceptance_quality;
  return {visual:diagramVisualFacts(project,quality),lifecycle:lifecycleCanonicalFacts(project)};
}
const gateSourceOptions=(state,config)=>({inputRevision:state.input_revision??0,gatePhase:state.phase,
  policyBundle:policyBundleFingerprint({gateCacheVersion:GATE_CACHE_VERSION,repairPolicyVersion:REPAIR_POLICY_VERSION,findingAdjudicationVersion:FINDING_ADJUDICATION_VERSION})});

/**
 * AK/AF：Architecture / Requirements Gate 的 crash-safe commit。
 * 任一步失敗都中止，且 findings 只在 approval receipt 成功寫入後才 finalize。
 */
function commitGatePhase(project,state,config,phasePlan,def){
  const log=[],gatePhase=state.phase,inputRevision=state.input_revision??0;
  const sourceOptions=gateSourceOptions(state,config);
  const sourceFingerprint=computeGateSourceFingerprint(project,sourceOptions);
  const isArchitecture=gatePhase==='architecture_gate';

  const txn=beginTransaction(project,{type:'GATE_COMMIT',phase:gatePhase,gatePhase,inputRevision,
    sourceManifestFingerprint:sourceFingerprint,
    details:{next_phase:def.next,reviewed_adr_paths:isArchitecture?structuredReviewedAdrPaths(phasePlan):[]}});
  let record=advanceTransaction(project,txn,'APPLYING');
  try{
    let acceptedAdrs=[];
    if(isArchitecture){
      // AF：只有 structured reviewed_adr_paths 具 promotion authority，free-text evidence 無效。
      const manifest=computeGateSourceManifest(project,sourceOptions);
      const reviewed=validateReviewedAdrPaths(project,record.details.reviewed_adr_paths,manifest);
      for(const item of reviewed.rejected) log.push(`【ADR 核准保護】${item.path}：${item.reason}；不予 promotion。`);
      const promotion=promoteReviewedAdrs(project,reviewed.accepted);
      if(!promotion.ok){
        advanceTransaction(project,record,'ABORTED',{abort_reason:promotion.violations.map(item=>`${item.path}：${item.reason}`).join('；')});
        return {ok:false,reason:`ADR promotion diff guard 失敗：${promotion.violations.map(item=>item.reason).join('；')}`};
      }
      acceptedAdrs=reviewed.accepted.map(item=>item.name);
      if(promotion.promoted.length) log.push(`【ADR Gate 核准】${promotion.promoted.length} 份 structured reviewed ADR 已轉為 accepted。`);
    }
    record=advanceTransaction(project,record,'APPLIED',{details:{...record.details,accepted_adrs:acceptedAdrs}});

    // Approval receipt 必須先於 finding finalization 建立。
    let approvalFingerprint=null;
    if(isArchitecture){
      // Hard invariant：upstream requirements approval 為 null 時不得 mint Architecture Approval。
      const upstream=requirementsApprovalGate(project,inputRevision);
      if(!upstream.ok){
        advanceTransaction(project,record,'ABORTED',{abort_reason:`ARCHITECTURE_APPROVAL_BLOCKED：${upstream.reason}`});
        return {ok:false,reason:`ARCHITECTURE_APPROVAL_BLOCKED：${upstream.reason}；findings 未 finalize、階段未推進`};
      }
      const receipt=mintArchitectureApproval(project,{inputRevision,
        requirementsApprovalFingerprint:upstream.fingerprint,
        gateSourceFingerprint:sourceFingerprint,
        gateReceiptsFingerprint:crypto.createHash('sha256').update(canonicalJson(phasePlan.units.map(unit=>({id:unit.id,evidence:unit.evidence??[]})))).digest('hex'),
        policyBundleFingerprint:sourceOptions.policyBundle,acceptedAdrs});
      approvalFingerprint=receipt.architecture_approval_fingerprint;
      state.architecture_gate_approved_at=now(); state.semantic_freeze_attempts=0; delete state.semantic_freeze_guard;
      log.push(`【Architecture Approval】fingerprint ${approvalFingerprint.slice(0,16)}…；此後 Specification 只接受此版本。`);
    } else if(gatePhase==='requirements_gate'){
      const receipt=mintRequirementsApproval(project,{inputRevision,inputFingerprint:state.input_fingerprint??null,
        gateReceiptsFingerprint:crypto.createHash('sha256').update(canonicalJson(phasePlan.units.map(unit=>({id:unit.id,evidence:unit.evidence??[]})))).digest('hex')});
      approvalFingerprint=receipt.requirements_approval_fingerprint;
      log.push(`【Requirements Approval】fingerprint ${approvalFingerprint.slice(0,16)}…`);
    }
    record=advanceTransaction(project,record,'VERIFYING',{details:{...record.details,approval_fingerprint:approvalFingerprint}});

    const store=loadFindings(project),settled=finalizeGateFindings(store,{gatePhase,inputRevision,evidence:approvalFingerprint?`Gate 通過並已建立 approval ${approvalFingerprint}`:'最終完整 Gate 通過'}); saveFindings(project,store);
    log.push(`【Gate findings 清帳】${gatePhase}：結案 ${settled.closed}、舊 revision 失效 ${settled.stale}、維持 ${settled.unchanged}。`);

    captureCompletedInputFingerprint(state,project,gatePhase);
    state.phase=def.next; state.attempt=0; state.next_action=`執行「${PHASE_LABELS[state.phase]??state.phase}」`; state.updated_at=now();
    writeJson(path.join(project,'.ai','PROJECT_STATE.json'),state);
    advanceTransaction(project,record,'COMMITTED',{details:{...record.details,advanced_to:def.next}});
    gitCheckpoint(project,config,`${PHASE_LABELS[gatePhase]??gatePhase} 通過並完成 Gate Commit`);
    appendGateAudit(project,{event:'gate_commit',gate_phase:gatePhase,transaction_id:record.transaction_id,source_fingerprint:sourceFingerprint,approval_fingerprint:approvalFingerprint});
    return {ok:true,log,approvalFingerprint};
  }catch(error){
    try{ advanceTransaction(project,record,'ABORTED',{abort_reason:error.message}); }catch{}
    return {ok:false,reason:`Gate Commit 失敗：${error.message}`};
  }
}
// reviewer 必須以 structured 欄位回報；沒有 structured 結果就沒有 promotion authority。
function structuredReviewedAdrPaths(phasePlan){
  const paths=[];
  for(const unit of phasePlan?.units??[]) for(const item of normalizeStringList(unit.reviewed_adr_paths)) paths.push(item);
  return [...new Set(paths)];
}

/** 啟動時收斂未完成 transaction：source 已變則 ABORT 重算，否則 idempotent roll-forward。 */
function reconcileGateTransactions(project,state,config){
  const log=[],pending=pendingTransactions(project);
  if(!pending.length) return log;
  const current=computeGateSourceFingerprint(project,gateSourceOptions(state,config));
  const results=reconcilePendingTransactions(project,{currentSourceFingerprint:current,rollForward:record=>{
    // COMMITTED 之前的中斷：狀態已由各步驟自身 durable 保存，重跑時由既有 idempotent 檢查接手。
    if(record.state==='APPLIED'||record.state==='VERIFYING') return {disposition:'ROLL_FORWARD_PENDING'};
    return {disposition:'RESUMABLE'};
  }});
  for(const item of results) log.push(`【Transaction 收斂】${item.transaction_id}（${item.type}）→ ${item.disposition}`);
  return log;
}

/** 上游 approval 失效時必須回頭驗證，不得讓下游沿用未核准版本。 */
function reconcileStageApprovals(project,state){
  const log=[],revision=state.input_revision??0,index=PROGRESS_PHASES.indexOf(state.phase);
  if(index>PROGRESS_PHASES.indexOf('requirements_gate')){
    let requirements=requirementsApprovalStatus(project,revision);
    // Legacy 專案：在進入 Semantic Freeze 之前先做一次 read-only compatibility verification。
    // 只讀取現行 Requirements/PRD，不修改任何 semantic source；PASS 才 mint receipt。
    if(!requirements.current&&!readApproval(project,'requirements',revision)){
      let cacheEntry=null; try{ cacheEntry=readJson(path.join(project,'.ai','GATE_CACHE.json')).entries?.['requirements_gate:REQ-GATE-SCOPE']??null; }catch{}
      const verification=verifyRequirementsCompatibility(project,{inputRevision:revision,inputFingerprint:state.input_fingerprint??null,gateCacheEntry:cacheEntry});
      log.push(`【Requirements 相容性驗證】${verification.code}｜legacy cache：${verification.legacy_disposition}`);
      for(const check of verification.checks??[]) log.push(`  ${check.ok?'PASS':'FAIL'} ${check.name}：${check.detail}`);
      if(verification.ok){
        const receipt=mintVerifiedRequirementsApproval(project,verification,{inputRevision:revision,inputFingerprint:state.input_fingerprint??null});
        delete state.requirements_approval_stale; delete state.legacy_approval_pending;
        log.push(`【Requirements Approval 已建立】fingerprint ${receipt.requirements_approval_fingerprint.slice(0,16)}…；此後 Architecture 只接受此版本 Requirements。`);
        requirements=requirementsApprovalStatus(project,revision);
      } else {
        state.requirements_approval_stale=verification.reason;
        log.push(`【Requirements 核准未通過】${verification.reason}；不得建立 authoritative Semantic Freeze。`);
      }
    }
    if(!requirements.current&&readApproval(project,'requirements',revision)){ state.requirements_approval_stale=requirements.reason; log.push(`【Requirements 核准待驗證】${requirements.reason}`); }
    else if(requirements.current) delete state.requirements_approval_stale;
    // 以 null upstream 產生的既有 Freeze 不具權威性，必須失效重建。
    const freeze=readSemanticFreeze(project);
    if(freeze){
      const upstream=semanticFreezeUpstreamValid(freeze,requirements.fingerprint??null);
      if(!upstream.valid){
        try{ fs.rmSync(path.join(project,'.ai','architecture','semantic-freeze.json'),{force:true}); }catch{}
        delete state.architecture_spec_frozen_at; delete state.semantic_freeze_fingerprint; delete state.architecture_generation_key;
        log.push(`【Semantic Freeze 失效】${upstream.reason}；已清除 generation key，必須重新凍結。`);
      }
    }
  }
  if(index>PROGRESS_PHASES.indexOf('architecture_gate')){
    // Specification boundary：必須驗證完整 approval chain，任一層 stale/null 都不得繼續。
    const architecture=architectureApprovalStatus(project,revision);
    const upstream=requirementsApprovalGate(project,revision);
    const freeze=readSemanticFreeze(project);
    const chain=[
      !upstream.ok?`requirements approval：${upstream.reason}`:null,
      !freeze?.semantic_fingerprint?'semantic freeze：尚未建立 content-addressed receipt':null,
      !architecture.current?`architecture approval：${architecture.reason}`:null
    ].filter(Boolean);
    if(chain.length){ state.architecture_approval_stale=chain.join('；'); log.push(`【Approval chain 不完整】${chain.join('；')}；下游不得沿用未核准版本。`); }
    else delete state.architecture_approval_stale;
  }
  return log;
}
function continuationCircuit(runtime,config) {
  const maxNoProgress=Number(config.work_units?.max_no_progress_attempts??2);
  const maxTotal=Number(config.work_units?.max_total_continuations_per_cycle??8);
  if((runtime.no_progress_count??0)>=maxNoProgress) return {blocked:true,reason:`連續 ${runtime.no_progress_count} 次未偵測到實質進度`,kind:'no_progress'};
  if((runtime.continuations??0)>=maxTotal) return {blocked:true,reason:`本輪已達 ${runtime.continuations}/${maxTotal} 次絕對安全上限`,kind:'total_limit'};
  return {blocked:false,reason:null,kind:null};
}
function progressSnapshot(project,phase,state) {
  if(!UNITIZED_PHASES.has(phase)) return null;
  const {plan}=ensurePhasePlan(project,phase,state), done=plan.units.filter(unit=>unit.status==='complete').length, current=currentWorkUnit(plan);
  return {done,total:plan.units.length,percent:plan.units.length?Math.round(done/plan.units.length*100):0,current};
}
function overallProgress(project,state) {
  if(state.phase==='complete'||state.status==='complete') return {percent:100,phase_fraction:1};
  if(state.phase==='not_started') return {percent:0,phase_fraction:0};
  const currentIndex=PROGRESS_PHASES.indexOf(state.phase); if(currentIndex<0) return {percent:0,phase_fraction:0};
  let earned=PROGRESS_PHASES.slice(0,currentIndex).reduce((sum,phase)=>sum+PROGRESS_WEIGHTS[phase],0), fraction=0;
  const plan=loadPhaseGraph(project).phases[state.phase];
  if(plan?.units?.length) fraction=plan.units.filter(unit=>unit.status==='complete').length/plan.units.length;
  else if(state.phase==='implementation') {
    try { const tasks=readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks.filter(task=>!String(task.id).startsWith('REQ-')); fraction=tasks.length?tasks.filter(task=>task.status==='complete').length/tasks.length:0; } catch {}
  } else if(state.gates?.[state.phase]?.status==='passed') fraction=1;
  earned+=(PROGRESS_WEIGHTS[state.phase]??0)*fraction;
  return {percent:Math.max(0,Math.min(100,Math.round(earned))),phase_fraction:fraction};
}
function productProgress(project,state) {
  if(state.phase==='complete'||state.status==='complete') return 100;
  let taskFraction=0;
  try {
    const tasks=(readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks??[]).filter(task=>!String(task.id??'').startsWith('REQ-'));
    if(tasks.length) taskFraction=tasks.filter(task=>['complete','completed','done','passed'].includes(String(task.status??'').toLowerCase())).length/tasks.length;
  } catch {}
  let earned=80*taskFraction;
  const graph=loadPhaseGraph(project),currentIndex=PROGRESS_PHASES.indexOf(state.phase);
  for(const [phase,weight] of [['implementation_gate',10],['qa',8],['release_gate',2]]) {
    const index=PROGRESS_PHASES.indexOf(phase),plan=graph.phases?.[phase]; let fraction=0;
    if(currentIndex>index) fraction=1;
    else if(plan?.units?.length) fraction=plan.units.filter(unit=>unit.status==='complete').length/plan.units.length;
    else if(state.gates?.[phase]?.status==='passed') fraction=1;
    earned+=weight*fraction;
  }
  return Math.max(0,Math.min(100,Math.round(earned)));
}
function changedFileSnapshot(project) {
  const result=spawnSync('git',['status','--porcelain=v1','-z'],{cwd:project,encoding:'utf8'}), hash=crypto.createHash('sha256'), entries=String(result.stdout??'').split('\0').filter(Boolean);
  for(const entry of entries) { const rel=entry.slice(3).split(' -> ').pop(), full=path.join(project,rel); hash.update(entry); try { const stat=fs.statSync(full); hash.update(`${stat.size}|${stat.mtimeMs}`); if(stat.isFile()&&stat.size<=5*1024*1024) hash.update(fs.readFileSync(full)); } catch { hash.update('missing'); } }
  return hash.digest('hex');
}
function gateScopePatterns(phase){
  return {
    requirements_gate:[/^docs\/(input|requirements)\//,/^docs\/PRD\.md$/,/^\.ai\/INPUT_INDEX\.json$/],
    architecture_gate:[/^docs\/(requirements|architecture|decisions)\//,/^docs\/PRD\.md$/],
    specification_gate:[/^docs\/(requirements|architecture|decisions|specs)\//,/^docs\/PRD\.md$/],
    planning_gate:[/^docs\/(requirements|specs)\//,/^docs\/IMPLEMENTATION_PLAN\.md$/,/^\.ai\/TASK_GRAPH\.json$/],
    implementation_gate:[/^docs\/(requirements|specs)\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//,/^package(-lock)?\.json$/],
    qa:[/^docs\/(requirements|specs)\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//,/^package(-lock)?\.json$/]
  }[phase]??[/^docs\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//];
}
function gateArtifactManifest(project,phase,unit){
  const listed=spawnSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:project,encoding:'utf8'}),patterns=gateScopePatterns(phase),files=String(listed.stdout??'').split('\0').filter(Boolean).map(file=>file.replaceAll('\\','/')).filter(file=>patterns.some(pattern=>pattern.test(file))).sort();
  const manifest={}; for(const relative of files){ const full=path.join(project,relative); try{ const stat=fs.statSync(full); if(stat.isFile()&&stat.size<=8*1024*1024) manifest[relative]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'); }catch{} }
  manifest['@policy']=crypto.createHash('sha256').update(`${GATE_CACHE_VERSION}|${phase}|${unit?.id??''}|${unit?.prompt??''}|${RESULT_SCHEMA}|${policyBundleFingerprint({gateCacheVersion:GATE_CACHE_VERSION,repairPolicyVersion:REPAIR_POLICY_VERSION,findingAdjudicationVersion:FINDING_ADJUDICATION_VERSION})}`).digest('hex'); return manifest;
}
const gateCachePath=project=>path.join(project,'.ai','GATE_CACHE.json');
function loadGateCache(project){ try{ const value=readJson(gateCachePath(project)); return value.schema_version===GATE_CACHE_VERSION?value:{schema_version:GATE_CACHE_VERSION,entries:{}}; }catch{return {schema_version:GATE_CACHE_VERSION,entries:{}};} }
function gateCacheKey(phase,unit){ return `${phase}:${unit.id}`; }
function gateCacheProbe(project,phase,unit){
  const manifest=gateArtifactManifest(project,phase,unit),cache=loadGateCache(project),previous=cache.entries?.[gateCacheKey(phase,unit)],fingerprint=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const changed=previous?.manifest?[...new Set([...Object.keys(previous.manifest),...Object.keys(manifest)])].filter(file=>previous.manifest[file]!==manifest[file]&&file!=='@policy'):Object.keys(manifest).filter(file=>file!=='@policy');
  return {hit:Boolean(previous?.outcome==='pass'&&previous.fingerprint===fingerprint),fingerprint,manifest,changed,previous};
}
function saveGateCachePass(project,phase,unit,verdict){
  const probe=gateCacheProbe(project,phase,unit),cache=loadGateCache(project); cache.entries??={}; cache.entries[gateCacheKey(phase,unit)]={outcome:'pass',fingerprint:probe.fingerprint,manifest:probe.manifest,summary:String(verdict.summary??'').slice(0,1200),evidence:(verdict.evidence??[]).slice(0,8),updated_at:now()}; cache.updated_at=now(); writeJson(gateCachePath(project),cache);
}
function gateDeltaContext(project,phase,unit){ const probe=gateCacheProbe(project,phase,unit); if(!probe.previous) return {probe,text:'尚無可信任的前次 Gate 基線，本輪必須執行完整審查。'}; return {probe,text:probe.changed.length?`相對前次通過基線的變更檔案（${probe.changed.length}）：\n${probe.changed.map(file=>`- ${file}`).join('\n')}\n先審查這些差異及其直接相依；最終結論仍須確認未變更區域的既有通過假設沒有失效。`:'來源內容未變更；控制器應直接使用 hash 快取，不應啟動模型。'}; }
function diagramStageTarget(project,unitId){
  const match=String(unitId??'').match(/^ARCH-(SYSTEM|WORKFLOW|LIFECYCLE|DATAFLOW)-(SPEC|BUILD|VERIFY)$/); if(!match) return null;
  const definitions={SYSTEM:{type:'architecture',base:'system-architecture',spec:'system-architecture.architecture.json'},WORKFLOW:{type:'workflow',base:'work-order-flow',spec:'work-order-flow.workflow.json'},LIFECYCLE:{type:'lifecycle',base:'work-order-lifecycle',spec:'work-order-lifecycle.lifecycle.json'},DATAFLOW:{type:'dataflow',base:'data-trust-boundary',spec:'data-trust-boundary.dataflow.json'}};
  const definition=definitions[match[1]],dir=path.join(project,'docs','architecture','diagrams');
  return {stage:match[2],type:definition.type,spec:path.join(dir,definition.spec),html:path.join(dir,`${definition.base}.html`),receipt:path.join(dir,`${definition.base}.visual-check.json`),acceptance:path.join(dir,`${definition.base}.visual-acceptance.json`),relative:[`docs/architecture/diagrams/${definition.spec}`,`docs/architecture/diagrams/${definition.base}.html`,`docs/architecture/diagrams/${definition.base}.visual-check.json`]};
}
// 唯一的收據判讀入口：raw 事實保持原樣，由 evaluateVisualAcceptance 疊加 policy 判定。
function inspectDiagramReceipt(target,visualQualityProfile='showcase'){
  try{
    readJson(target.spec);
    const receipt=readJson(target.receipt),html=fs.readFileSync(target.html),sha=sha256(html);
    const rawReceiptSha=sha256(fs.readFileSync(target.receipt));
    const acceptance=evaluateVisualAcceptance({receipt,visualQualityProfile,htmlSha:sha,htmlBytes:html.length,rawReceiptSha});
    return {ok:acceptance.policy_accepted,acceptance,receipt,sha,bytes:html.length,
      reason:acceptance.policy_accepted
        ?`結構化規格有效；raw=${acceptance.raw_status}／effective=${acceptance.effective_status}，收據雜湊與 HTML 一致`
        :`visual acceptance 未通過：${acceptance.blocking_reasons.join('；')||'收據不存在或已落後於目前 HTML'}`};
  }catch(error){ return {ok:false,reason:error.message}; }
}
function runArchify(project,args){ const cli=path.join(os.homedir(),'.claude','skills','archify','bin','archify.mjs'); return spawnSync(process.execPath,[cli,...args],{cwd:project,encoding:'utf8',timeout:600000,env:{...process.env,PATH:`${path.join(os.homedir(),'.local','bin')}:/usr/local/bin:/usr/bin:/bin:/snap/bin`}}); }
function archifyFailure(result){ const raw=String(result.stdout||result.stderr||''); try{ const parsed=JSON.parse(raw); return String(parsed.error??parsed.message??raw).slice(-12000); }catch{return raw.slice(-12000);} }
function archifyJson(result){
  const raw=String(result.stdout||result.stderr||''),start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<start) return null;
  try{return JSON.parse(raw.slice(start,end+1));}catch{return null;}
}
function diagramQualityProfile(config={}){
  const requested=config.workflow_efficiency?.architecture_quality_profile;
  return requested==='standard'||requested==='showcase'?requested:'showcase';
}
// 結構驗證品質與視覺驗收品質是兩件事，不得再共用單一 `quality` 變數。
function resolveArchitectureQualityPolicy(config={}){
  const efficiency=config.workflow_efficiency??{};
  const normalize=value=>value==='standard'||value==='showcase'?value:null;
  const base=diagramQualityProfile(config);
  return {
    structural_validation_quality:normalize(efficiency.structural_validation_quality)??base,
    visual_acceptance_quality:normalize(efficiency.visual_acceptance_quality)??base
  };
}
// Machine-owned evidence 一律走 durable canonical writer，確保 idempotent 且無 volatile timestamp。
function writeMachineOwnedJson(file,value){ return writeDurableJson(file,value); }
function semanticFreezeFingerprint(project){
  try{ return readJson(path.join(project,'.ai','architecture','semantic-freeze.json')).semantic_fingerprint??null; }catch{ return null; }
}
function architectureGenerationKey(project){
  try{ return readJson(path.join(project,'.ai','architecture','semantic-freeze.json')).architecture_generation_key??null; }catch{ return null; }
}
const diagramFamilyKey=id=>({'SYSTEM':'system','WORKFLOW':'workflow','LIFECYCLE':'lifecycle','DATAFLOW':'dataflow'})[String(id??'').match(/^ARCH-(SYSTEM|WORKFLOW|LIFECYCLE|DATAFLOW)-/)?.[1]]??null;
function machineHandleDiagramUnit(project,workUnit,config={}){
  // ARCH-EVIDENCE-SYNC 是確定性機器單元：只同步 machine-owned evidence，不碰 semantic 正文。
  if(workUnit?.id===EVIDENCE_SYNC_UNIT){
    const quality=resolveArchitectureQualityPolicy(config).visual_acceptance_quality;
    const synced=syncArchifyEvidence(project,{visualQualityProfile:quality});
    if(!synced.ok) return {ok:false,reason:synced.reason};
    const summary=Object.entries(synced.evidence.diagrams).map(([key,item])=>`${key}=${item.effective_visual_status??item.status}`).join('、');
    return {ok:true,evidence:[
      `控制器確定性同步 docs/architecture/ARCHIFY_EVIDENCE.json（policy v${synced.evidence.evidence_policy_version}）`,
      `visual_quality_profile=${quality}；各圖 effective 狀態：${summary}`,
      `semantic_freeze_fingerprint=${synced.evidence.semantic_freeze_fingerprint??'未建立'}`,
      `此檔為 machine-owned evidence，semantic ARCHITECTURE.md 未被修改`
    ]};
  }
  const target=diagramStageTarget(project,workUnit?.id); if(!target) return null;
  const quality=diagramQualityProfile(config);
  const finalVisuals=(config.workflow_efficiency?.architecture_visual_delivery??'final_only')==='final_only';
  if(target.stage!=='SPEC'&&finalVisuals&&config.workflow_efficiency?.semantic_freeze_before_render!==false){
    let state={}; try{ state=readJson(path.join(project,'.ai','PROJECT_STATE.json')); }catch{}
    if(!state.architecture_spec_frozen_at) return {ok:false,deferred:true,reason:'圖表語意尚未凍結；禁止提前執行 deliver 或 visual-check'};
  }
  if(target.stage==='SPEC'){
    try{
      const value=readJson(target.spec),size=fs.statSync(target.spec).size; if(!value||size<100) return {ok:false,reason:'結構化圖表規格內容不足'};
      const validate=runArchify(project,['validate',target.type,target.spec,'--json','--quality',quality]);
      if(validate.status!==0) return {ok:false,reason:`結構化規格尚未通過 ${quality} validate：${archifyFailure(validate)}`};
      return {ok:true,evidence:[`控制器辨識既有結構化規格：${target.relative[0]}（${size} bytes）`,`archify validate ${target.type} --quality ${quality}：通過`,`需求語意將由後續 Architecture Gate 審查`]};
    }catch(error){ return {ok:false,reason:`尚無可用結構化規格：${error.message}`}; }
  }
  if(target.stage==='BUILD'){
    try{ readJson(target.spec); }catch(error){ return {ok:false,reason:`結構化規格無效：${error.message}`}; }
    console.log(`【確定性 Archify 產生】${workUnit.id} 由控制器執行 validate 與 deliver，不消耗 Claude turns。`);
    const validate=runArchify(project,['validate',target.type,target.spec,'--json','--quality',quality]); if(validate.status!==0) return {ok:false,reason:`Archify validate 失敗：${archifyFailure(validate)}`};
    const deliverArgs=['deliver',target.type,target.spec,target.html,'--json','--quality',quality]; if(target.type==='architecture') deliverArgs.push('--repo-root',project);
    const specShaBefore=sha256(fs.readFileSync(target.spec));
    const deliver=runArchify(project,deliverArgs); if(deliver.status!==0||!fs.existsSync(target.html)) return {ok:false,reason:`Archify deliver 失敗：${String(deliver.stderr||deliver.stdout).slice(-2000)}`};
    // BUILD TOCTOU：deliver 期間 SPEC 若改變，本次產物不可被接受。
    if(sha256(fs.readFileSync(target.spec))!==specShaBefore) return {ok:false,reason:'SOURCE_CHANGED_DURING_BUILD：deliver 期間結構化規格已改變，本次產物不予接受'};
    const freeze=readSemanticFreeze(project),familyKey=diagramFamilyKey(workUnit.id);
    const buildReceipt=familyKey?writeBuildReceipt(project,familyKey,{architectureGenerationKey:freeze?.architecture_generation_key??null,semanticFreezeFingerprint:freeze?.semantic_fingerprint??null,structuralValidationQuality:quality,builderVersion:'page-autodev',archifyVersion:null}):null;
    return {ok:true,evidence:[`控制器執行 archify validate ${target.type} --quality ${quality}：通過`,`控制器執行 archify deliver：已產生 ${target.relative[1]}（${fs.statSync(target.html).size} bytes）`,
      buildReceipt?`build provenance：spec_sha=${buildReceipt.spec_sha}／html_sha=${buildReceipt.html_sha}／freeze=${buildReceipt.semantic_freeze_fingerprint??'未建立'}`:'未能建立 build receipt',
      `圖表需求語意將由後續 Architecture Gate 審查`]};
  }
  const visualQuality=resolveArchitectureQualityPolicy(config).visual_acceptance_quality;
  const familyKey=diagramFamilyKey(workUnit.id),freezeReceipt=readSemanticFreeze(project);
  if(familyKey){
    const provenance=buildProvenanceStatus(project,familyKey,{semanticFreezeFingerprint:freezeReceipt?.semantic_fingerprint??null});
    if(!provenance.current) return {ok:false,reason:`STALE_BUILD：${provenance.reason}；必須重新執行 BUILD 後才可驗證`};
  }
  let inspected=inspectDiagramReceipt(target,visualQuality);
  if(!inspected.ok&&fs.existsSync(target.spec)&&fs.existsSync(target.html)){
    console.log(`【確定性 Archify 驗證】${workUnit.id} 的收據需要更新；控制器直接執行 visual-check，不消耗 Claude turns。`);
    const result=runArchify(project,['visual-check',target.html,'--json']);
    // exit code 不是最終判定：只要收據存在且可讀，就交由唯一的 visual acceptance policy 裁定。
    inspected=inspectDiagramReceipt(target,visualQuality);
    if(!inspected.ok&&!fs.existsSync(target.receipt)) return {ok:false,reason:`Archify visual-check 未產生可讀收據（exit ${result.status}）：${String(result.stderr||result.stdout).slice(-2000)}`};
  }
  if(!inspected.ok) return {ok:false,reason:inspected.reason};
  writeMachineOwnedJson(target.acceptance,visualAcceptanceReceipt(inspected.acceptance,{architectureGenerationKey:architectureGenerationKey(project),semanticFreezeFingerprint:semanticFreezeFingerprint(project)}));
  return {ok:true,evidence:[
    `控制器確定性驗證：${target.relative[0]} JSON 格式有效`,
    ...visualAcceptanceEvidence(target.relative[1],inspected.acceptance),
    `HTML ${inspected.bytes} bytes，與收據完全一致`,
    `圖表需求語意將由後續 Architecture Gate 獨立審查`
  ]};
}
function postInterruptAcceptance(project,phase,workUnit,config){
  if(config.work_units?.post_interrupt_acceptance===false) return {eligible:false};
  if(phase!=='architecture'||!workUnit) return {eligible:false};
  if(workUnit.machine_feedback) return {eligible:false,reason:'此工作單元帶有語意修復診斷，格式或版面驗證通過不足以證明語意缺陷已修復；必須續接原 Session 完成實質修改。'};
  const receipt=machineHandleDiagramUnit(project,workUnit,config);
  if(!receipt) return {eligible:false};
  return receipt.ok
    ? {eligible:true,accepted:true,evidence:receipt.evidence,summary:'AI 達到 turns 上限，但控制器已依現有產物完成確定性驗收；需求語意仍由後續 Architecture Gate 獨立審查。'}
    : {eligible:true,accepted:false,reason:receipt.reason};
}
function completeInterruptedWorkUnit(project,state,statePath,config,phaseGraph,phasePlan,workUnit,receipt){
  workUnit.status='complete'; workUnit.completed_at=now(); workUnit.updated_at=now(); workUnit.last_summary=receipt.summary; workUnit.evidence=receipt.evidence??[]; workUnit.after_snapshot=changedFileSnapshot(project); workUnit.continuations=0; workUnit.no_progress_count=0; workUnit.last_terminal_reason='max_turns_accepted_by_controller';
  delete workUnit.session_id; delete workUnit.machine_feedback; delete workUnit.repair_source;
  phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
  const done=phasePlan.units.filter(unit=>unit.status==='complete').length;
  state.status='running'; state.blocker=null; state.next_action=done===phasePlan.units.length?`完成「${PHASE_LABELS[state.phase]??state.phase}」工作單元並進入 Gate`:'執行下一個工作單元'; state.updated_at=now();
  appendHistory(state,{at:now(),phase:state.phase,work_unit:workUnit.id,outcome:'pass_after_interrupt_acceptance',terminal_reason:'max_turns',evidence:receipt.evidence??[]}); writeJson(statePath,state);
  gitCheckpoint(project,config,`${workUnit.id} 中斷後確定性驗收通過`);
  console.log(`【中斷後驗收通過】${workUnit.id} 雖未及回傳最終 JSON，但現有成果已通過控制器確定性驗證，因此直接標記完成，不再消耗 Claude turns。`);
  for(const evidence of receipt.evidence??[]) console.log(`【驗收證據】${evidence}`);
  console.log(`【階段進度】${done}/${phasePlan.units.length}（${Math.round(done/phasePlan.units.length*100)}%）`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
}
function terminalReason(stdout) { try { const value=JSON.parse(stdout); return {reason:value.terminal_reason,subtype:value.subtype,errors:value.errors??[],session_id:value.session_id??null,api_error_status:value.api_error_status??null,result:value.result??null}; } catch { return {}; } }
function nextReadyTask(project) {
  const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')), done=new Set(graph.tasks.filter(taskComplete).map(t=>t.id));
  const task=graph.tasks.find(t=>!String(t.id).startsWith('REQ-')&&!taskComplete(t)&&(t.depends_on??[]).every(id=>done.has(id)))??null;
  if(taskComplete(task)) throw new Error(`任務派發安全檢查失敗：已完成任務 ${task.id} 不可再次派發`);
  return task;
}
function composeEnvironment(service={}) {
  const value=service.environment??{};
  if(Array.isArray(value)) return Object.fromEntries(value.map(item=>String(item).split(/=(.*)/s).slice(0,2)));
  return value&&typeof value==='object'?value:{};
}
function databaseUrlFacts(value) {
  try { const parsed=new URL(String(value??'')); return {ok:/^postgres(?:ql)?:$/.test(parsed.protocol),host:parsed.hostname,port:parsed.port||'5432',user:decodeURIComponent(parsed.username),database:parsed.pathname.replace(/^\//,'')}; }
  catch { return {ok:false,host:'',port:'',user:'',database:''}; }
}
function validateComposeDatabaseBoundary(compose) {
  const services=compose?.services??{}, issues=[], facts={};
  for(const [service,key] of [['migrate','MIGRATION_DATABASE_URL'],['api','RUNTIME_DATABASE_URL'],['backupjob','BACKUP_DATABASE_URL']]) {
    if(!services[service]) continue;
    const env=composeEnvironment(services[service]), fact=databaseUrlFacts(env[key]); facts[service]=fact;
    if(!fact.ok) issues.push(`${service}.${key} 不是有效的 PostgreSQL URL`);
    else if(['localhost','127.0.0.1','::1'].includes(fact.host)||fact.host!=='db'||fact.port!=='5432') issues.push(`${service}.${key} 在容器內指向 ${fact.host||'空值'}:${fact.port||'空值'}，應指向 db:5432`);
  }
  const dbEnv=composeEnvironment(services.db), expected={migrate:String(dbEnv.POSTGRES_USER??''),api:String(dbEnv.RUNTIME_DB_USER??''),backupjob:String(dbEnv.BACKUP_DB_USER??'')};
  for(const [service,user] of Object.entries(expected)) if(facts[service]?.ok&&user&&facts[service].user!==user) issues.push(`${service} URL 使用者 ${facts[service].user||'空值'} 與資料庫宣告 ${user} 不一致`);
  return {ok:issues.length===0,issues,facts,expected};
}
function deploymentPreflightNeeded(task) {
  const text=[task?.id,task?.title,...(task?.write_scope??[]),...(task?.verification??[]).flat()].join(' ');
  return /docker-compose\.ya?ml|docker\s+compose|smoke-test|\bINT-E2E\b/i.test(text);
}
function deploymentPreflight(project,task) {
  if(!deploymentPreflightNeeded(task)||!fs.existsSync(path.join(project,'docker-compose.yml'))) return {ok:true,skipped:true,checks:[]};
  const configured=spawnSync('docker',['compose','config','--format','json'],{cwd:project,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  if(configured.status!==0) return {ok:false,checks:[],issues:[`docker compose config 無法解析：${String(configured.stderr||configured.stdout).trim().slice(-1200)}`]};
  let compose; try { compose=JSON.parse(configured.stdout); } catch(error) { return {ok:false,checks:[],issues:[`docker compose config 未回傳有效 JSON：${error.message}`]}; }
  const boundary=validateComposeDatabaseBoundary(compose), checks=['Compose 設定可完整解析'];
  if(!boundary.ok) return {ok:false,checks,issues:boundary.issues};
  checks.push('migrate／api／backupjob 皆使用容器內 db:5432，且 URL 角色與資料庫宣告一致');
  const running=spawnSync('docker',['compose','ps','--status','running','-q','db'],{cwd:project,encoding:'utf8',timeout:15000});
  if(running.status!==0||!String(running.stdout).trim()) return {ok:true,checks:[...checks,'資料庫尚未執行，略過既有 volume 即時檢查（啟動後仍由 integration verification 驗證）'],issues:[]};
  const migrationUser=boundary.facts.migrate?.user??'',runtimeUser=boundary.facts.api?.user??'',backupUser=boundary.facts.backupjob?.user??'',database=boundary.facts.migrate?.database??'';
  const identifiers=[migrationUser,runtimeUser,backupUser,database].filter(Boolean);
  if(identifiers.some(value=>!/^[A-Za-z_][A-Za-z0-9_$-]*$/.test(value))) return {ok:false,checks,issues:['資料庫角色或名稱含不安全字元，無法執行唯讀 volume 預檢']};
  if(!migrationUser||!database) return {ok:false,checks,issues:['缺少 migrate 資料庫角色或資料庫名稱，無法核對既有 volume']};
  const sql=`SELECT current_database(), pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database(); SELECT rolname FROM pg_roles WHERE rolname IN ('${migrationUser}','${runtimeUser}','${backupUser}') ORDER BY rolname; SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public'; SELECT count(*) FILTER (WHERE tableowner <> '${migrationUser}') FROM pg_tables WHERE schemaname='public';`;
  const inspected=spawnSync('docker',['compose','exec','-T','-u','postgres','db','psql','-XAt','-d',database,'-c',sql],{cwd:project,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(inspected.status!==0) return {ok:false,checks,issues:[`既有資料卷無法用 postgres 本機管理連線檢查：${String(inspected.stderr||inspected.stdout).trim().slice(-1200)}`]};
  const output=String(inspected.stdout), missing=[migrationUser,runtimeUser,backupUser].filter(role=>role&&!output.split(/\r?\n/).includes(role));
  const databaseOwner=output.split(/\r?\n/).find(line=>line.startsWith(`${database}|`))?.split('|')[1], schemaOwner=output.split(/\r?\n/).find(line=>line.startsWith('public|'))?.split('|')[1], last=output.trim().split(/\r?\n/).at(-1), foreignOwners=Number(last);
  const issues=[]; if(missing.length) issues.push(`既有資料卷缺少角色：${missing.join('、')}`); if(databaseOwner&&databaseOwner!==migrationUser) issues.push(`資料庫 ${database} owner=${databaseOwner}，預期 ${migrationUser}`); if(schemaOwner&&![migrationUser,'pg_database_owner'].includes(schemaOwner)) issues.push(`public schema owner=${schemaOwner}，預期 ${migrationUser} 或 PostgreSQL 標準 pg_database_owner`); if(Number.isFinite(foreignOwners)&&foreignOwners>0) issues.push(`public schema 有 ${foreignOwners} 個資料表不屬於 ${migrationUser}`);
  return {ok:issues.length===0,checks:[...checks,'既有資料卷角色、資料庫 owner、schema owner 與資料表 owner 已核對'],issues};
}
function modelRouting(project, phase, config) {
  const configured=config.stage_models?.[phase]??{}, defaults=DEFAULT_MODEL_ROUTING[phase]??{};
  let route={model:configured.model??defaults.model??config.model??'sonnet',effort:configured.effort??defaults.effort??config.effort??'high',reason:configured.reason??defaults.reason??'使用專案預設模型',fallback:configured.fallback??config.fallback_model??'sonnet',task:null};
  if(phase==='implementation') {
    route.task=nextReadyTask(project);
    const risk=String(route.task?.risk??'').toLowerCase(), text=`${route.task?.title??''} ${route.task?.description??''}`.toLowerCase();
    if(['critical','high','重大','高'].includes(risk)||/(security|auth|permission|payment|migration|encryption|安全|權限|付款|遷移|加密)/i.test(text)) { route.model='opus'; route.effort='high'; route.reason=`任務 ${route.task?.id??''} 被判定為高風險或涉及安全／權限／付款／資料遷移，因此自動升級 Opus`; }
    route.complexity_policy=selectComplexityPolicy(route.task,config);
  }
  return route;
}
function adaptiveTurnBudget(project,phase,routing,config){
  const base=Number(routing.unit?.max_turns??routing.task?.max_turns??(phase==='implementation'?config.turn_budget?.implementation_base:null)??config.stage_max_turns?.[phase]??config.max_turns_per_stage??18),continuations=Math.max(0,Number(routing.continuations??routing.unit?.continuations??0)),step=Math.max(0,Number(config.turn_budget?.continuation_increment??4)),cap=Math.max(base,Number(config.turn_budget?.maximum??32));
  let complexity=0; const reasons=[];
  if(routing.unit?.machine_feedback){ complexity+=4; reasons.push('具體修復診斷 +4'); }
  const findingCount=(String(routing.finding_context??'').match(/^GF-/gm)??[]).length; if(findingCount){ const extra=Math.min(6,findingCount*2); complexity+=extra; reasons.push(`${findingCount} 項 finding +${extra}`); }
  const risk=String(routing.task?.risk??'').toLowerCase(); if(['critical','high','重大','高'].includes(risk)){ complexity+=4; reasons.push('高風險任務 +4'); }
  if(routing.gate_verification_mode==='targeted'&&!routing.unit?.machine_feedback){ complexity=Math.max(0,complexity-2); reasons.push('定點複驗 -2'); }
  const turns=Math.min(cap,Math.max(8,base+complexity+continuations*step)); return {turns,base,complexity,continuations,cap,reasons};
}
function applyGateRouteEfficiency(project,phase,state,unit,routing,config){
  if(PHASES[phase]?.kind!=='gate'||!unit) return routing;
  const delta=gateDeltaContext(project,phase,unit); routing.gate_delta_context=delta.text; routing.gate_cache_probe=delta.probe;
  if(state.gate_verification_mode==='targeted'){
    const highRisk=/(critical|high|安全|權限|認證|授權|資料完整|不可逆|migration|encryption|payment)/i.test(String(routing.finding_context??''));
    if(!highRisk){ routing.model=config.gate_efficiency?.targeted_review_model??'sonnet'; routing.effort='high'; routing.reason='既有 finding 的定點 acceptance_check 複驗使用成本較低模型；全部收斂後仍由 Opus 執行最終完整回歸 Gate'; }
  }
  return routing;
}
function contextPolicy(phase,routing) {
  const common='優先讀取 docs/context/*.md 精簡閱讀層，再用 Glob／Grep／Git diff 定位必要原始證據與相關段落；禁止無目的遍歷整個 repository。不得將 node_modules、dist、build、coverage、.git、.ai/logs、PNG/JPEG/WebP、完整 Archify HTML 或其他生成物讀入 Context。圖表驗證優先讀取結構化 architecture JSON 與 visual-check JSON 收據。大型文件只讀本階段所需段落；Markdown 閱讀層是衍生索引，不是唯一 Source of Truth，若與原始證據矛盾，必須以原始資料為準並修正 Markdown。';
  const byPhase={
    input_analysis:'優先讀取 docs/input/ 的檔名、類型、異動與既有 INDEX；只對新增或變更資料做內容分析，再更新完整索引。',
    requirements:'優先讀取 docs/input/INDEX.md、.ai/INPUT_INDEX.json、docs/requirements/REQUIREMENTS.md 與 docs/PRD.md；架構與程式碼僅在驗證既有限制時定點查閱。',
    requirements_gate:'完整追溯需求與 PRD，但先依需求編號、驗收條件與未決事項定位；不得讀取圖像與生成式架構 HTML。',
    architecture:'優先讀取已核准需求、PRD、現有 ARCHITECTURE 與 ADR；程式碼以搜尋確認現況，不得整庫讀取。',
    architecture_gate:'完整追溯已核准需求、架構、ADR 與結構化 Archify 驗證收據；不讀取完整生成 HTML 或圖片位元內容。',
    specification:'優先讀取需求編號、PRD、ARCHITECTURE、ADR 與相關既有規格；按功能邊界分段處理。',
    specification_gate:'以需求到規格的追溯矩陣為入口，再定點核對原始需求、架構與規格段落。',
    planning:'優先讀取核准規格、TASK_GRAPH 與 IMPLEMENTATION_PLAN；只在相依關係有疑義時回查需求和架構。',
    planning_gate:'以任務圖、規格追溯與 Git 狀態為入口，定點驗證相依、證據與衝突風險。',
    implementation:`只處理目前任務 ${routing.task?.id??'未指定'}；先讀該任務、直接相依、相關規格與將修改的程式碼，不重讀全部需求或架構。`,
    implementation_gate:'先看 Git diff、任務證據與受影響測試，再沿相關需求／規格追溯；不要重讀無關模組。',
    qa:'保留完整驗收覆蓋，但以驗收條件、追溯矩陣與測試結果為入口；大型測試輸出只保留失敗摘要與必要證據。'
  };
  return `${common}\n本階段 Context 路由：${byPhase[phase]??'依目前任務定點讀取必要 Source of Truth。'}`;
}
function gitCheckpoint(project,config,label) {
  if(config.auto_checkpoint_commits===false) return null;
  const identity=config.git_checkpoint_identity??{name:'Page Studio Autodev',email:'autodev@page-studio.local'};
  const call=args=>spawnSync('git',args,{cwd:project,encoding:'utf8'});
  if(call(['config','--get','user.name']).status!==0) call(['config','user.name',identity.name]);
  if(call(['config','--get','user.email']).status!==0) call(['config','user.email',identity.email]);
  const runtimeOnly=new Set(['.ai/PROJECT_STATE.json','.ai/PHASE_TASK_GRAPH.json','.ai/GATE_FINDINGS.json','.ai/GATE_CACHE.json']);
  const status=String(call(['status','--porcelain=v1','-z']).stdout??'').split('\0').filter(Boolean).map(entry=>entry.slice(3).split(' -> ').pop().replaceAll('\\','/'));
  const meaningful=status.filter(file=>!runtimeOnly.has(file)&&!file.startsWith('.ai/logs/')&&!file.endsWith('.lock'));
  if(!meaningful.length){ console.log(`【Git checkpoint 略過】${label} 只有執行狀態變更；狀態已原子保存，不建立無內容 commit。`); return call(['rev-parse','--verify','HEAD']).stdout?.trim()||null; }
  const add=call(['add','-A']); if(add.status!==0) throw new Error(`Git checkpoint 無法加入變更：${add.stderr||add.stdout}`);
  const whitespace=call(['diff','--cached','--check']); if(whitespace.status!==0) throw new Error(`Git checkpoint 發現 whitespace 品質問題，拒絕提交：${whitespace.stdout||whitespace.stderr}`);
  if(call(['diff','--cached','--quiet']).status===0) { console.log('【Git checkpoint】目前沒有需要提交的變更。'); return call(['rev-parse','--verify','HEAD']).stdout?.trim()||null; }
  const commit=call(['commit','-m',`chore(autodev): ${label}`]); if(commit.status!==0) throw new Error(`Git checkpoint 建立失敗：${commit.stderr||commit.stdout}`);
  const hash=call(['rev-parse','--short','HEAD']).stdout.trim(); console.log(`【Git checkpoint】已建立 ${hash}｜${label}`); console.log(`【復原參考】如需檢查此版本：git show ${hash}`); return hash;
}
function inputFingerprint(project) {
  const root=path.join(project,'docs','input'); if(!fs.existsSync(root)) return 'missing';
  const rows=[];
  const walk=dir=>{ for(const item of fs.readdirSync(dir,{withFileTypes:true})) { const full=path.join(dir,item.name); if(item.isDirectory()) walk(full); else if(!['README.md','INDEX.md','.gitkeep'].includes(item.name)) { const s=fs.statSync(full); rows.push(`${item.name}|${s.size}|${s.mtimeMs}`); } } };
  walk(root); return crypto.createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}
function captureCompletedInputFingerprint(state,project,phase) {
  if(phase!=='input_analysis') return false;
  state.input_fingerprint=inputFingerprint(project);
  state.input_fingerprint_updated_at=now();
  return true;
}
function routeChangedInput(state, project) {
  const fingerprint=inputFingerprint(project);
  if (state.phase==='input_analysis'||state.input_fingerprint===fingerprint) return false;
  const previousPhase=state.phase;
  state.phase='input_analysis'; state.status='running'; state.attempt=0; state.blocker=null;
  state.next_action='分析新增或變更的 docs/input/ 資料，並重新整合至完整專案流程';
  state.gates={}; state.input_revision=(state.input_revision??0)+1;
  appendHistory(state,{at:now(),phase:'input_analysis',outcome:'input_changed',summary:`在「${PHASE_LABELS[previousPhase]??previousPhase}」期間偵測到第 ${state.input_revision} 次輸入資料變更；已使既有 Gate 失效並重新進入完整整合流程。`});
  console.log(`【偵測到第 ${state.input_revision} 次資料提供】docs/input/ 有新增或更新內容。`);
  console.log(`【流程調整】原階段為「${PHASE_LABELS[previousPhase]??previousPhase}」；現在先重新分析與分類資料，之後依序重跑需求、架構、規格、排程、實作審查與 QA。`);
  return true;
}

function activeFindingContext(project,state){
  if(!state.active_findings?.length) return '';
  try { const store=loadFindings(project),items=store.findings.filter(item=>state.active_findings.includes(item.id)); return items.map(item=>`${item.id}｜${item.title}\n驗收：${normalizeStringList(item.acceptance_check).join('；')}`).join('\n'); } catch { return ''; }
}
const RELEASE_ONLY_CATEGORIES=new Set(['deployment_destination','deployment_capacity','operations_schedule','certificate_ownership','monitoring_threshold','backup_destination']);
const DEVELOPMENT_RISK_PATTERN=/(security|auth|authorization|authentication|permission|rbac|access.control|data.integrity|data.loss|corrupt|encryption|secret|credential|migration|rollback|irreversible|transaction|idempot|audit|安全|認證|授權|權限|存取控制|資料完整|資料遺失|毀損|加密|密鑰|憑證外洩|遷移|回滾|不可逆|交易|冪等|稽核)/i;
function classifyFindingStage(item){
  const text=[item.category,item.title,item.summary,...normalizeStringList(item.source_files),...normalizeStringList(item.acceptance_check)].join(' ');
  if(DEVELOPMENT_RISK_PATTERN.test(text)||['critical','high','重大','高'].includes(String(item.severity??'').toLowerCase())) return 'development';
  return item.blocking_stage==='release'&&RELEASE_ONLY_CATEGORIES.has(String(item.category??'').toLowerCase())?'release':'development';
}
function deferReleaseFindings(project,verdict,gatePhase){
  if(!Array.isArray(verdict.findings)||!verdict.findings.length) return verdict;
  for(const item of verdict.findings){ const requested=item.blocking_stage; item.blocking_stage=classifyFindingStage(item); if(requested==='release'&&item.blocking_stage==='development') console.log(`【Release risk 防誤判】「${item.title}」涉及開發期品質／安全邊界，控制器已強制改為 development blocker。`); }
  const release=verdict.findings.filter(item=>item.blocking_stage==='release'),development=verdict.findings.filter(item=>item.blocking_stage!=='release');
  if(release.length){
    const file=path.join(project,'.ai','RELEASE_RISKS.json'),store=fs.existsSync(file)?readJson(file):{schema_version:1,revision:0,risks:[]}; store.risks??=[];
    for(const item of release){
      const fingerprint=crypto.createHash('sha256').update(`${item.title}|${item.summary}`).digest('hex'); const existing=store.risks.find(risk=>risk.fingerprint===fingerprint);
      if(existing){ existing.last_seen_at=now(); existing.occurrences=(existing.occurrences??1)+1; existing.status='open'; }
      else store.risks.push({id:`RR-${fingerprint.slice(0,10).toUpperCase()}`,fingerprint,title:item.title,summary:item.summary,severity:item.severity,category:item.category??'deployment',source_files:item.source_files??[],acceptance_check:item.acceptance_check??[],gate_phase:gatePhase,status:'open',first_seen_at:now(),last_seen_at:now(),occurrences:1});
    }
    store.revision=(store.revision??0)+1; store.updated_at=now(); writeJson(file,store); console.log(`【Release Gate 延後】${release.length} 項部署／維運風險已記錄至 .ai/RELEASE_RISKS.json，不阻塞目前開發。`);
  }
  verdict.findings=development; verdict.repair_targets=[...new Set(development.flatMap(item=>item.repair_targets??[]))];
  if(verdict.outcome==='failed'&&!development.length){ verdict.outcome='pass'; verdict.gate_decision='pass'; verdict.blocker=null; verdict.summary=`${verdict.summary}（僅剩 ${release.length} 項 Release Gate 風險，已延後，不阻塞開發。）`; }
  return verdict;
}
function promoteDraftAdrs(project,gateVerdict={},reviewedPaths=[]){
  const dir=path.join(project,'docs','decisions'); if(!fs.existsSync(dir)) return 0; let promoted=0;
  const evidence=(gateVerdict.evidence??[]).join('\n'); let protectedCount=0;
  for(const name of fs.readdirSync(dir).filter(name=>/^\d{4}-.+\.md$/.test(name))){
    const file=path.join(dir,name),before=fs.readFileSync(file,'utf8');
    if(!/(\*\*Status:\*\*\s*|^Status:\s*|^-\s*Status:\s*)draft\b/mi.test(before)) continue;
    const eligible=/(\*\*Gate-Eligible:\*\*\s*|^Gate-Eligible:\s*|^-\s*Gate-Eligible:\s*)true\b/mi.test(before)&&/(\*\*Approval-Scope:\*\*\s*|^Approval-Scope:\s*|^-\s*Approval-Scope:\s*)technical\b/mi.test(before);
    const admitted=/(\*\*ADR-Admission:\*\*\s*|^ADR-Admission:\s*|^-\s*ADR-Admission:\s*)(cross-cutting|irreversible|security|data-integrity)\b/mi.test(before);
    // AF：free-text evidence 不再是 promotion authority；改由 structured reviewed_adr_paths 決定。
    const explicitlyReviewed=reviewedPaths.some(item=>item===name||item.endsWith(`/${name}`));
    if(!eligible||!admitted||!explicitlyReviewed){ protectedCount++; continue; }
    const after=before.replace(/(\*\*Status:\*\*\s*|^Status:\s*|^-\s*Status:\s*)draft\b/gmi,'$1accepted'); fs.writeFileSync(file,after); promoted++;
  }
  if(promoted) console.log(`【ADR Gate 核准】${promoted} 份具 technical／Gate-Eligible 標記且被 Gate 證據點名的 Draft ADR 已轉為 accepted。`);
  if(protectedCount) console.log(`【ADR 核准保護】${protectedCount} 份 Draft ADR 未同時符合核准標記與明確審查證據，維持 draft。`);
  return promoted;
}

function slimMarkdownDocuments(project,{apply=false}={}){
  const candidates=[path.join(project,'docs','architecture','ARCHITECTURE.md'),path.join(project,'docs','decisions','README.md')].filter(fs.existsSync);
  const archiveRoot=path.join(project,'.ai','archive','document-slim',new Date().toISOString().replace(/[:.]/g,'-')); const report=[];
  for(const file of candidates){
    const before=fs.readFileSync(file,'utf8'); let after=before,archived=[];
    if(path.basename(file)==='ARCHITECTURE.md') after=after.replace(/(^# Architecture\s*\n)([\s\S]*?)(?=^## Context and constraints\s*$)/m,(all,head,history)=>{ if(!/(修訂|回合|驗證方式|沿革)/.test(history)) return all; archived.push(history.trim()); return `${head}\n`; });
    if(file.endsWith(path.join('decisions','README.md'))) after=after.replace(/(^## 架構決策盤點[^\n]*\n)([\s\S]*?)(?=^\|[^\n]+\|\s*$)/m,(all,head,history)=>{ if(!/(本回合|最近一次盤點|複核回合)/.test(history)) return all; archived.push(history.trim()); return `${head}\n`; });
    const removed=Buffer.byteLength(before)-Buffer.byteLength(after); if(removed<=0) continue;
    report.push({file:path.relative(project,file),removed_bytes:removed,before_bytes:Buffer.byteLength(before),after_bytes:Buffer.byteLength(after)});
    if(apply){ const destination=path.join(archiveRoot,path.relative(project,file)); fs.mkdirSync(path.dirname(destination),{recursive:true}); fs.writeFileSync(destination,archived.join('\n\n---\n\n')+'\n'); fs.writeFileSync(file,after); }
  }
  console.log(`【文件安全瘦身${apply?'完成':'預覽'}】${report.length} 份文件可移除 ${report.reduce((sum,item)=>sum+item.removed_bytes,0)} bytes 的回合／修訂歷程；架構正文、決策表與原始證據未刪除。`);
  for(const item of report) console.log(`- ${item.file}：${item.before_bytes} → ${item.after_bytes} bytes`);
  if(apply&&report.length) console.log(`【可回復封存】移除段落已保存於 ${path.relative(project,archiveRoot)}`);
  return report;
}
function migrateProjectWorkflow(project){
  project=assertProject(project); const graph=loadPhaseGraph(project),state=readJson(path.join(project,'.ai','PROJECT_STATE.json')); let changed=false;
  for(const [phase,plan] of Object.entries(graph.phases??{})) if(STATIC_WORK_UNITS[phase]?.length) changed=migratePhasePlanToCurrent(project,phase,graph,plan)||changed;
  if(changed) savePhaseGraph(project,graph);
  // phase 位置不能證明 Architecture Gate 曾經通過：唯一 authority 是 Architecture Approval Receipt。
  // 沒有 receipt 的既有專案標記 legacy_approval_pending，不得據此批次結案 findings。
  if(PROGRESS_PHASES.indexOf(state.phase)>PROGRESS_PHASES.indexOf('architecture_gate')){
    const approval=architectureApprovalStatus(project,state.input_revision??0);
    if(approval.current){
      const store=loadFindings(project),settled=finalizeGateFindings(store,{gatePhase:'architecture_gate',inputRevision:state.input_revision??0,evidence:`既有專案遷移：Architecture Approval ${approval.fingerprint} 已驗證`}); saveFindings(project,store);
      console.log('【既有 findings 清帳】結案 '+settled.closed+'、舊 revision 失效 '+settled.stale+'、維持 '+settled.unchanged+'。');
    } else {
      state.legacy_approval_pending=true; changed=true;
      console.log(`【既有專案核准待驗證】${approval.reason}；不得僅因 phase 位置推論 Architecture Gate 已通過，findings 維持原狀待確定性驗證。`);
    }
  }
  console.log(changed?'【遷移完成】既有專案已安全套用新版工作單元；已完成成果與證據均保留。':'【遷移檢查】專案工作單元已是目前版本，不需變更。');
  return changed;
}
const SEMANTIC_SPEC_FILES={
  'ARCH-SYSTEM-SPEC':'docs/architecture/diagrams/system-architecture.architecture.json',
  'ARCH-WORKFLOW-SPEC':'docs/architecture/diagrams/work-order-flow.workflow.json',
  'ARCH-LIFECYCLE-SPEC':'docs/architecture/diagrams/work-order-lifecycle.lifecycle.json',
  'ARCH-DATAFLOW-SPEC':'docs/architecture/diagrams/data-trust-boundary.dataflow.json'
};
function semanticFreezeArtifactFingerprint(project,targets){
  const hash=crypto.createHash('sha256');
  for(const id of [...targets].sort()){ const relative=SEMANTIC_SPEC_FILES[id],file=relative&&path.join(project,relative); hash.update(`${id}\0${relative??''}\0`); if(file&&fs.existsSync(file)) hash.update(fs.readFileSync(file)); hash.update('\0'); }
  return hash.digest('hex');
}
function registerSemanticFreezeFailure(project,state,targets,config={}){
  const limits=config.semantic_freeze??{},maxTotal=Math.max(3,Number(limits.max_total_attempts??6)),maxSame=Math.max(1,Number(limits.max_same_artifact_failures??2)),maxNoProgress=Math.max(1,Number(limits.max_consecutive_no_progress??2));
  const fingerprint=semanticFreezeArtifactFingerprint(project,targets),guard=state.semantic_freeze_guard??={total:0,best_target_count:null,consecutive_no_progress:0,artifact_failures:{}};
  const previous=guard.last_artifact_fingerprint,first=guard.total===0,artifactChanged=Boolean(previous&&previous!==fingerprint),targetReduced=Number.isFinite(guard.best_target_count)&&targets.length<guard.best_target_count;
  const progressed=first||artifactChanged||targetReduced;
  guard.total+=1; guard.best_target_count=guard.best_target_count===null?targets.length:Math.min(guard.best_target_count,targets.length); guard.consecutive_no_progress=progressed?0:(guard.consecutive_no_progress??0)+1; guard.artifact_failures[fingerprint]=(guard.artifact_failures[fingerprint]??0)+1; guard.last_artifact_fingerprint=fingerprint; guard.last_targets=[...targets]; guard.updated_at=now(); state.semantic_freeze_guard=guard; state.semantic_freeze_attempts=guard.total;
  const same=guard.artifact_failures[fingerprint],blocked=guard.total>=maxTotal||same>=maxSame||guard.consecutive_no_progress>=maxNoProgress;
  const reason=guard.total>=maxTotal?`總修復輪數 ${guard.total}/${maxTotal} 已達上限`:same>=maxSame?`相同規格內容已失敗 ${same}/${maxSame} 次`:`連續 ${guard.consecutive_no_progress}/${maxNoProgress} 輪沒有規格內容進展`;
  return {blocked,progressed,artifactChanged,targetReduced,total:guard.total,same,noProgress:guard.consecutive_no_progress,maxTotal,maxSame,maxNoProgress,reason,fingerprint};
}
function resetSemanticFreezeReviewer(unit,reason){
  if(!unit) return;
  unit.status='pending';
  unit.lifetime_continuations=(unit.lifetime_continuations??0)+(unit.continuations??0);
  unit.continuations=0;
  unit.no_progress_count=0;
  unit.reviewer_reset_reason=reason;
  delete unit.session_id;
  delete unit.completed_at;
  unit.updated_at=now();
}
function runClaude(project, phase, def, config, logPath, routing) {
  const executionTarget=routing.unit?`${routing.unit.id}「${routing.unit.title}」`:routing.task?`${routing.task.id}「${routing.task.title}」`:`「${PHASE_LABELS[phase]??phase}」`;
  const parallelMarker=routing.parallel_slot?`｜併行 ${routing.parallel_slot}/${routing.parallel_total}`:'';
  const taskInstruction=routing.task?`\n本次只能處理指定任務 ${routing.task.id}：${routing.task.title}。不可自行改選其他任務。`:'';
  const layoutRepairAuthority=phase==='architecture'&&/-SPEC$/.test(String(routing.unit?.id??''))?'\n確定性 showcase 版面驗證是本工作單元的必要驗收。若只調整 route/via/side 無法收斂，你已被明確授權在同一結構化圖表 artifact 內重新配置所有直接相關元件的座標、尺寸、分區與 viewBox，並重算受影響的任意數量連線。純幾何布局重排不是業務／架構語意決策，不需要操作者或後續 Architecture Gate 預先核准，也不得以「牽動多條已通過連線」為由回傳 blocked；Architecture Gate 會在產出完成後獨立審查。你必須保留全部已核准元件、關係、方向、語意與追溯，完成後重新執行完整 showcase validation，只有真正缺少業務規則或存在互斥語意時才可 blocked。':'';
  const unitInstruction=routing.unit?`\n本次工作單元為 ${routing.unit.id}：${routing.unit.title}。${routing.unit.prompt}${routing.unit.machine_feedback?`\n控制器最近一次確定性檢查失敗摘要如下；只修復這些具體診斷，不重新設計已通過語意：\n${routing.unit.machine_feedback}`:''}${layoutRepairAuthority}${routing.unit.reflection_required?'\n此缺陷已重複出現。執行前必須比較前次方法。回傳的 strategy_reflection 物件內必須同時包含：非空字串 root_cause、new_strategy、difference_from_previous，以及非空字串陣列 files_to_change、verification；不可把後兩欄放在最外層。新策略必須有可驗證差異。':''}\n只能完成此工作單元；既有有效成果不得重做。若先前因 turns 上限中斷，先檢查 Git diff 與現有檔案，只完成剩餘工作。`:'';
  const scopedContext=config.context_management?.phase_scoped_context===false?'依 CLAUDE.md 讀取必要資料。':contextPolicy(phase,routing);
  const resumeInstruction=routing.resume_session_id?'這是同一工作單元的原 session 續跑。直接延續先前工具狀態與未完成工作，禁止重新盤點、重新讀取已確認檔案或重做既有成果；優先完成剩餘動作並回傳最終結構化 JSON。':'本次為此工作單元的新 session。';
  const isSemanticFreeze=routing.unit?.id==='ARCH-SPEC-FREEZE';
  const gateRepairContract=def.kind==='gate'?`若 Gate 判定未通過，outcome 必須為 failed，且每個 findings 項目必須提供 severity、blocking_stage（development 或 release）、title、summary、repair_targets 與 acceptance_check。若本單元為 ARCH-GATE-TRACE 且判定通過，必須以 reviewed_adr_paths 陣列逐一列出實際審查且可核准的 Draft ADR 相對路徑；未列於此陣列者一律不會被核准，於 evidence 自由文字提及檔名不具任何核准效力。只有會造成錯誤實作、權限漏洞、資料錯誤或不可逆損害的 development finding 可以使 Gate 失敗；容量數值、異地目的地、維運參數等只記為 release finding，不阻塞開發。${routing.gate_verification_mode==='targeted'?`本輪是定點複驗，只檢查下列既有 findings 的 acceptance_check，不得擴張審查範圍或建立無關改善項目：\n${routing.finding_context}`:''}`:isSemanticFreeze?'若語意凍結未通過，outcome 必須為 failed，repair_targets 只能使用 ARCH-SYSTEM-SPEC、ARCH-WORKFLOW-SPEC、ARCH-LIFECYCLE-SPEC、ARCH-DATAFLOW-SPEC；不得要求 BUILD、VERIFY、Context、純美化或部署參數工作。':'';
  const deltaInstruction=def.kind==='gate'&&routing.gate_delta_context?`\nGate 差異審查：${routing.gate_delta_context}`:'';
  const complexityPolicyInstruction=phase==='implementation'?complexityInstruction(routing.complexity_policy):'';
  const prompt = `你正在 Page Studio 全自動控制器下執行「${PHASE_LABELS[phase]??phase}」階段。${resumeInstruction}${routing.unit?'本階段已由控制器預先拆分，請勿嘗試一次完成整個大階段。':def.prompt}${taskInstruction}${unitInstruction}\n只能在目前 Git repository 內工作。先閱讀 CLAUDE.md；本次由控制器提供的階段 Context 路由優先於 CLAUDE.md 的通用啟動建議。${scopedContext}${deltaInstruction}${complexityPolicyInstruction}\n不可修改 .ai/PROJECT_STATE.json 或 .ai/PHASE_TASK_GRAPH.json，不可 commit、push、部署、存取相鄰專案或等待使用者即時回答。所有說明、摘要、證據、阻塞原因與回覆內容必須使用臺灣繁體中文；技術名稱、程式碼與檔名可保留英文。請回傳精簡但完整的結構化 JSON；摘要只保留決策所需資訊，證據優先使用檔案、行號、雜湊與驗證結果，不複製長篇原文。outcome=pass 代表本工作單元完整完成；blocked 代表必須由外部決策或不可用相依項目處理；failed 代表檢查失敗或工作尚未完成。${gateRepairContract}`;
  const budget=adaptiveTurnBudget(project,phase,routing,config),turnLimit=budget.turns;
  const repairPlanInstruction=def.kind==='gate'?'\n若 Gate 未通過，每個 finding 必須提供 repair_plan：依序列出可直接執行且可驗證的步驟，指出要核對或修改的檔案／符號、預期變更及驗證方式。不可只寫「修正問題」「重新檢查」等空泛內容，不可要求 commit、push、部署或修改控制器狀態檔。Gate 只提出計畫，不可親自修改檔案。'+(phase==='architecture_gate'?'\nPROJECT_CONTEXT.md 是 Gate 通過後才重建的衍生閱讀層，不是權威 Source of Truth；其落差不得成為 development finding 或 repair_target。請追溯並修復真正的 REQUIREMENTS、ARCHITECTURE、ADR 或結構化圖表來源，最終 Context 由後續工作單元一次同步。':''):'';
  const args = ['-p', prompt+repairPlanInstruction, '--agent', def.agent, '--permission-mode', def.kind === 'gate' ? 'dontAsk' : 'auto', '--output-format','json','--json-schema',RESULT_SCHEMA,'--max-turns',String(turnLimit),'--model',routing.model,'--effort',routing.effort,'--no-chrome'];
  const resumable=config.context_management?.resume_same_work_unit!==false&&Boolean(routing.unit||routing.task);
  if(routing.resume_session_id) args.push('--resume',routing.resume_session_id);
  else if(!resumable) args.push('--no-session-persistence');
  if(routing.fallback&&routing.fallback!==routing.model) args.push('--fallback-model',routing.fallback);
  const hardDeny=['Bash(git push:*)','Bash(git reset --hard:*)','Bash(git clean:*)','Bash(rm -rf:*)','Bash(sudo:*)','Bash(ssh:*)','Bash(scp:*)','Bash(curl:*)','Bash(wget:*)','Bash(gh pr create:*)','Bash(npm publish:*)','Bash(docker push:*)'];
  if (def.kind === 'gate'||isSemanticFreeze) { args.push('--allowedTools','Read,Grep,Glob,Bash'); hardDeny.push('Write','Edit'); }
  args.push('--disallowedTools',hardDeny.join(','));
  const identity=leaseIdentity({project,inputRevision:routing.input_revision??0,phase,unitId:routing.unit?.id??routing.task?.id??phase,attempt:routing.unit?.attempt??routing.task?.attempt??0});
  const lease=acquireWorkUnitLease(project,identity);
  return new Promise(resolve => {
    const out = [], err = [];
    const compactPercent=Math.min(90,Math.max(60,Number(config.context_management?.auto_compact_percent??80)));
    let child;
    try { child = spawn(path.join(os.homedir(),'.local','bin','claude'), args, {cwd:project,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:`${path.join(os.homedir(),'.local','bin')}:/usr/local/bin:/usr/bin:/bin:/snap/bin`,CLAUDE_AUTOCOMPACT_PCT_OVERRIDE:String(compactPercent)}}); trackChild(child,lease); }
    catch(error) { lease.release(); throw error; }
    const timeoutSeconds=(config.stage_timeout_minutes ?? 90)*60;
    const started=Date.now();
    const heartbeat=setInterval(()=>{
      lease.heartbeat();
      const elapsed=Math.floor((Date.now()-started)/1000), remaining=Math.max(0,timeoutSeconds-elapsed);
      if (remaining<=300) console.log(`【接近安全上限｜產品 ${routing.product_percent??0}%｜流程 ${routing.overall_percent??0}%${parallelMarker}】${executionTarget} 已執行 ${elapsed} 秒；若再過 ${remaining} 秒仍未結束，系統將安全停止本次程序並保留日誌。`);
      else console.log(`【執行中｜產品 ${routing.product_percent??0}%｜流程 ${routing.overall_percent??0}%${parallelMarker}】${executionTarget} 已執行 ${elapsed} 秒；完成後將個別解析此子任務結果。`);
    },10000);
    const timer = setTimeout(() => { console.error(`【安全停止${parallelMarker}】${executionTarget} 已達 ${timeoutSeconds} 秒安全上限，正在停止本次 Claude 程序群組並保留成果。`); terminateChildGroup(child,'SIGTERM'); }, timeoutSeconds * 1000);
    child.stdout.on('data', d => out.push(d)); child.stderr.on('data', d => err.push(d));
    child.on('close', code => { clearTimeout(timer); clearInterval(heartbeat); lease.release(); const stdout=Buffer.concat(out).toString(), stderr=Buffer.concat(err).toString(); fs.appendFileSync(logPath, `\n=== ${now()} ${phase} exit=${code}\n${stdout}\nSTDERR\n${stderr}\n`); resolve({code,stdout,stderr}); });
  });
}

function parseResult(raw) {
  const outer = JSON.parse(raw);
  const value = outer.structured_output ?? outer.result ?? outer;
  let parsed=value;
  if (typeof value === 'string') {
    const fenced=value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if(!fenced&&(value.indexOf('{')<0||value.lastIndexOf('}')<value.indexOf('{'))) throw new Error('Claude 已完成工作，但最後只回傳一般文字，未提供完整 JSON 收據');
    const cleaned=fenced?fenced[1].trim():value.trim().slice(value.indexOf('{'),value.lastIndexOf('}')+1);
    if(!cleaned) throw new Error('Claude 回傳的 JSON 收據是空白內容');
    parsed=JSON.parse(cleaned);
  }
  if (!parsed.outcome && parsed.status) {
    const status=String(parsed.status).toLowerCase();
    parsed={outcome:['pass','passed','complete','completed','success'].includes(status)?'pass':status==='blocked'?'blocked':'failed',summary:parsed.summary??parsed.recommendation??`階段回傳狀態：${status}`,evidence:[...(parsed.actions_taken??[]),...(parsed.files_changed??[])],blocker:parsed.blocker??null};
  }
  const gateDecision=String(parsed.gate_decision??parsed.gateDecision??'').toLowerCase();
  if(['fail','failed','reject','rejected','block','blocked'].includes(gateDecision)) parsed.outcome='failed';
  else if(['pass','passed','approve','approved'].includes(gateDecision)&&!parsed.outcome) parsed.outcome='pass';
  const blockingReason=parsed.blocker??parsed.blocking_reason??parsed.blockingReason??parsed.blockedReason??parsed.blocked_reason;
  parsed.summary=displayText(parsed.summary??parsed.rootCause?.summary??parsed.root_cause??blockingReason??parsed.reason??parsed.next_action??parsed.next_action_for_controller??parsed.recommendedNextAction??parsed.findings?.map(item=>item.summary??item.title).filter(Boolean).join('；')??'未提供摘要');
  const blocker=blockingReason??(parsed.outcome==='blocked'?(parsed.reason??parsed.summary):null);
  parsed.blocker=blocker==null?null:displayText(blocker);
  const evidence=parsed.evidence??parsed.checksPerformed??parsed.diagnostics??[];
  parsed.evidence=Array.isArray(evidence)?evidence.map(v=>displayText(v)):[displayText(evidence)].filter(Boolean);
  parsed.models_used=Object.keys(outer.modelUsage??{});
  return parsed;
}

function routeDiagramVerifyRepair(state,phasePlan,verifyUnit,diagnostic){
  const match=String(verifyUnit?.id??'').match(/^(ARCH-(?:SYSTEM|WORKFLOW|LIFECYCLE|DATAFLOW))-VERIFY$/);
  if(!match||!phasePlan) return {routed:false};
  verifyUnit.layout_repair_attempts=(verifyUnit.layout_repair_attempts??0)+1;
  if(verifyUnit.layout_repair_attempts>2) return {routed:false,exhausted:true};
  const specId=`${match[1]}-SPEC`,buildId=`${match[1]}-BUILD`,specUnit=phasePlan.units.find(unit=>unit.id===specId),buildUnit=phasePlan.units.find(unit=>unit.id===buildId),freezeUnit=phasePlan.units.find(unit=>unit.id==='ARCH-SPEC-FREEZE');
  if(!specUnit||!buildUnit||!freezeUnit) return {routed:false};
  specUnit.status='repairing'; specUnit.machine_feedback=`來源：${verifyUnit.id} 確定性 visual-check。${diagnostic}\n只修復造成 visual-check 失敗的版面／資訊密度問題，必須保留已核准語意與追溯；完成後由新語意凍結 session 重新核對。`; specUnit.continuations=0; specUnit.no_progress_count=0; delete specUnit.session_id; delete specUnit.completed_at; specUnit.updated_at=now();
  for(const unit of [buildUnit,verifyUnit]){ unit.status='pending'; unit.continuations=0; unit.no_progress_count=0; delete unit.session_id; delete unit.completed_at; unit.updated_at=now(); }
  resetSemanticFreezeReviewer(freezeUnit,`${specId} 因 visual-check 失敗將調整，必須重新確認語意未退化`);
  phasePlan.status='in_progress'; phasePlan.updated_at=now(); delete state.architecture_spec_frozen_at; state.status='repairing'; state.blocker=null; state.next_action=`定點修復 ${specId} 的視窗溢位，重新凍結語意後再產生與驗證圖表`; state.updated_at=now();
  return {routed:true,specId,attempt:verifyUnit.layout_repair_attempts};
}

function normalizeStrategyReceipt(verdict) {
  if (!verdict?.strategy_reflection || typeof verdict.strategy_reflection !== 'object') return verdict;
  const reflection={...verdict.strategy_reflection};
  if (reflection.files_to_change==null && verdict.files_to_change!=null) reflection.files_to_change=verdict.files_to_change;
  if (reflection.verification==null && verdict.verification!=null) reflection.verification=verdict.verification;
  return {...verdict,strategy_reflection:reflection};
}

function quotaError(text) {
  const value=String(text??'');
  if(/(?:session|usage|rate|weekly|5.hour|quota).{0,60}(?:limit|exceed|reset|reached|hit)|resets?\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:am|pm)|api_error_status["']?\s*:\s*429/i.test(value)) return true;
  try { const parsed=JSON.parse(value.trim()); return Number(parsed.api_error_status)===429||parsed.terminal_reason==='api_error'&&/limit|reset|quota|429/i.test(String(parsed.result??'')); } catch { return false; }
}
function authenticationError(text){
  const value=String(text??'');
  if(/failed to authenticate|oauth session expired|authentication (?:failed|required)|not logged in|login required|unauthorized|invalid_grant/i.test(value)) return true;
  try{ const parsed=JSON.parse(value.trim()); return parsed.terminal_reason==='api_error'&&/auth|oauth|login|unauthorized|invalid_grant/i.test(String(parsed.result??'')); }catch{return false;}
}
function transientServiceError(text) {
  const value=String(text??'');
  if(/api_error_status["']?\s*:\s*(?:500|502|503|504|529)|\b(?:500|502|503|504|529)\b.{0,80}(?:overload|unavailable|timeout|server|api)|(?:overload|temporar(?:y|ily) unavailable|server-side issue|econnreset|etimedout|socket hang up)/i.test(value)) return true;
  try { const parsed=JSON.parse(value.trim()),status=Number(parsed.api_error_status); return parsed.terminal_reason==='api_error'&&[500,502,503,504,529].includes(status); } catch { return false; }
}
function transientResumeAt(attempt=1,baseMinutes=2,maxMinutes=15) {
  const delay=Math.min(Math.max(1,Number(maxMinutes)||15),Math.max(1,Number(baseMinutes)||2)*2**Math.max(0,Number(attempt)-1));
  return {delay_minutes:delay,resume_after:new Date(Date.now()+delay*60000).toISOString()};
}
function quotaResumeAt(text,fallbackMinutes=30,delayMinutes=5) {
  const match=String(text??'').match(/resets?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)/i);
  const delay=Math.max(0,Number(delayMinutes)||0);
  if(!match) return new Date(Date.now()+(Math.max(1,Number(fallbackMinutes)||30)+delay)*60000).toISOString();
  let hour=Number(match[1])%12; if(match[3].toLowerCase()==='pm') hour+=12; const target=new Date(); target.setHours(hour,Number(match[2]),30,0); if(target<=new Date()) target.setDate(target.getDate()+1); target.setMinutes(target.getMinutes()+delay); return target.toISOString();
}

function quotaRetrySchedule(project,resumeAfter) {
  const projectName=path.basename(path.resolve(project));
  const suffix=String(resumeAfter).replace(/[^0-9]/g,'').slice(0,14)||Date.now();
  const unit=`page-autodev-quota-${projectName}-${suffix}`;
  const onCalendar=new Date(resumeAfter).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');
  return {
    unit,
    onCalendar,
    args:['--user',`--unit=${unit}`,`--on-calendar=${onCalendar}`,'--timer-property=AccuracySec=30s','--property=SuccessExitStatus=75','--property=KillMode=control-group','--property=TimeoutStopSec=30s','--collect',path.join(ROOT,'bin','page-autodev'),'run',projectName]
  };
}

function scheduleQuotaRetry(project,resumeAfter) {
  if(!backgroundWakeAllowed()){ console.log('【single-shot】不建立額度自動喚醒單元；請依建議時間手動執行 resume-once。'); return false; }
  const schedule=quotaRetrySchedule(project,resumeAfter);
  const result=spawnSync('systemd-run',schedule.args,{encoding:'utf8'});
  if(result.status===0){
    console.log(`【額度自動喚醒】已排程 ${taipeiTime(resumeAfter)} 精準檢查額度；正常即接續原任務。`);
    return true;
  }
  console.warn(`【額度排程備援】精準排程建立失敗，保留週期巡檢自動續跑：${String(result.stderr||result.stdout||'未知錯誤').trim()}`);
  return false;
}
function scheduleServiceRetry(project,resumeAfter) {
  if(!backgroundWakeAllowed()){ console.log('【single-shot】不建立服務恢復自動喚醒單元；請依建議時間手動執行 resume-once。'); return false; }
  const schedule=quotaRetrySchedule(project,resumeAfter),result=spawnSync('systemd-run',schedule.args,{encoding:'utf8'});
  if(result.status===0){ console.log(`【服務恢復重試】已排程 ${taipeiTime(resumeAfter)} 自動接續原任務。`); return true; }
  console.warn(`【服務重試備援】精準排程建立失敗，保留週期巡檢：${String(result.stderr||result.stdout||'未知錯誤').trim()}`); return false;
}

async function runParallelImplementation(project,state,config,logPath,statePath){
  let run=currentParallelStatus(project);
  if(!run||!['running','quota_paused','interrupted','failed','blocked'].includes(run.status)) {
    const tasks=selectParallelWriteBatch(project,config); if(tasks.length<2) return null;
    const graphFile=path.join(project,'.ai','TASK_GRAPH.json'),graph=readJson(graphFile);
    for(const selected of tasks){ const task=graph.tasks.find(item=>item.id===selected.id); task.status='leased'; task.lease={run_id:'preparing',at:now()}; }
    writeJson(graphFile,graph); gitCheckpoint(project,config,`準備併行開發：${tasks.map(task=>task.id).join('、')}`);
    run=createParallelRun(project,tasks);
  } else {
    gitCheckpoint(project,config,`續跑併行批次 ${run.run_id} 前保存主專案狀態`);
    console.log(`【續跑併行批次】${run.run_id}｜保留既有 worktree 與候選 commit，只續跑未完成 Worker。`); run.status='running'; updateParallelRun(run);
  }
  console.log(`【寫入型受控併行】批次 ${run.run_id}，共 ${run.workers.length} 個隔離 Git worktree。`);
  console.log(`【品質保護】Agent 不得修改狀態檔；候選 commit 將依序整合並逐一執行任務驗證。`);
  if(run.workers.every(worker=>worker.status==='integrated')&&run.integration?.receipts?.length===run.workers.length&&run.integration.receipts.every(receipt=>receipt.ok)){
    console.log('【恢復已驗證整合】所有候選均已整合並通過驗證；略過 Agent 與重複測試，直接完成安全快轉。'); finishIntegratedParallelRun(project,run); gitCheckpoint(project,config,`併行批次 ${run.run_id} 完成並通過逐任務驗證`); state.status='running'; state.blocker=null; state.next_action='重新計算任務圖，派發下一批安全任務或進入實作 Gate'; state.updated_at=now(); writeJson(statePath,state); return {status:'complete'};
  }
  const active=run.workers.filter(worker=>!['candidate_ready','integrated','complete'].includes(worker.status));
  const results=await Promise.all(active.map(async (worker,index)=>{
    const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')),task=graph.tasks.find(item=>item.id===worker.task_id);
    const routing={...modelRouting(project,'implementation',config),task,unit:null,overall_percent:overallProgress(project,state).percent,product_percent:productProgress(project,state),resume_session_id:worker.session_id??null,continuations:worker.continuations??0,parallel_slot:index+1,parallel_total:active.length};
    routing.complexity_policy=selectComplexityPolicy(task,config);
    console.log(`【Worker 啟動】${worker.task_id}｜${worker.title}｜${routing.model}｜${worker.worktree}`); worker.status='running'; worker.started_at=now(); updateParallelRun(run);
    const result=await runClaude(worker.worktree,'implementation',PHASES.implementation,config,logPath,routing);
    return {worker,task,routing,result,combined:result.stdout+'\n'+result.stderr};
  }));
  let quota=false,interrupted=false,blocked=null,failed=null;
  for(const item of results){
    if(item.result.code!==0){
      const terminal=terminalReason(item.result.stdout);
      if(quotaError(item.combined)){ item.worker.status='quota_paused'; quota=true; }
      else if(terminal.reason==='max_turns'){ item.worker.status='interrupted'; item.worker.continuations=(item.worker.continuations??0)+1; item.worker.session_id=terminal.session_id??item.worker.session_id??null; interrupted=true; }
      else { item.worker.status='failed'; item.worker.error=`Claude 程序以錯誤代碼 ${item.result.code} 結束`; failed=item; }
      item.worker.updated_at=now(); updateParallelRun(run); continue;
    }
    let verdict; try{ verdict=parseResult(item.result.stdout); }catch(error){ item.worker.status='failed'; item.worker.error=`無法解析結果：${error.message}`; failed=item; updateParallelRun(run); continue; }
    if(verdict.outcome==='blocked'){
      const resolved=resolveContradictedImplementationBlock(item.worker.worktree,item.task,verdict);
      verdict=resolved.verdict;
      if(resolved.contradiction){
        console.log(`【併行實作過期阻塞自動駁回】${item.task.id}｜${resolved.contradiction}`);
        if(!resolved.verified.ok) console.log(`【確定性驗證發現真實失敗】${resolved.verified.reason}`);
      }
    }
    const complexitySnapshot=diffComplexitySnapshot(item.worker.worktree,item.task,item.routing.complexity_policy),complexityReceipt=normalizeComplexityReceipt(verdict.complexity_receipt,item.routing.complexity_policy,complexitySnapshot);
    appendHistory(state,{at:now(),phase:'implementation',task:item.task.id,outcome:verdict.outcome,summary:verdict.summary,evidence:verdict.evidence,parallel_run:run.run_id,model_route:{requested:item.routing.model,effort:item.routing.effort},complexity:{...complexitySnapshot,receipt:complexityReceipt}});
    if(verdict.outcome==='blocked'){ item.worker.status='blocked'; item.worker.summary=verdict.summary; blocked={item,verdict}; updateParallelRun(run); continue; }
    if(verdict.outcome!=='pass'){ item.worker.status='failed'; item.worker.summary=verdict.summary; failed=item; updateParallelRun(run); continue; }
    try { finalizeWorker(item.worker,verdict.summary,verdict.evidence,config.git_checkpoint_identity); updateParallelRun(run); console.log(`【候選完成】${item.worker.task_id}｜${item.worker.commit.slice(0,8)}｜等待串行整合。`); }
    catch(error){ item.worker.status='scope_violation'; item.worker.error=error.message; failed=item; updateParallelRun(run); console.error(`【範圍驗證失敗】${error.message}`); }
  }
  if(quota){ run.status='quota_paused'; updateParallelRun(run); state.status='quota_paused'; state.resume_after=quotaResumeAt(results.map(item=>item.combined).join('\n'),config.quota_retry_minutes??30,config.quota_retry_delay_minutes??5); state.blocker='寫入型併行 Worker 偵測到 Claude 使用額度限制'; state.next_action=`系統將於 ${taipeiTime(state.resume_after)}（額度刷新後延遲 ${config.quota_retry_delay_minutes??5} 分鐘）從既有 worktree 自動續跑`; writeJson(statePath,state); scheduleQuotaRetry(project,state.resume_after); await notifyTelegram(project,'parallel_quota_paused','⏸️ 頁構所 AI：併行開發因額度暫停',state,`批次 ${run.run_id} 已保留所有 worktree 與候選 commit。`); return {status:'quota'}; }
  if(blocked){ run.status='blocked'; updateParallelRun(run); state.status='blocked'; state.blocker=blocked.verdict.blocker||blocked.verdict.summary; state.next_action='補齊資訊後執行 page-autodev resume，系統會從既有 worktree 續跑'; writeJson(statePath,state); await notifyTelegram(project,'parallel_blocked','🙋 頁構所 AI：併行開發需要操作者提供資訊',state,blocked.item.worker.task_id); return {status:'blocked'}; }
  if(failed){ run.status='failed'; updateParallelRun(run); state.status='failed'; state.blocker=`併行任務 ${failed.worker.task_id} 失敗：${failed.worker.error??failed.worker.summary??'未通過'}`; state.next_action=`查看 ${logPath} 與併行狀態，排除後執行 page-autodev resume`; writeJson(statePath,state); timer(project,false); await notifyTelegram(project,'parallel_failed','❌ 頁構所 AI：併行開發任務失敗',state,failed.worker.task_id); return {status:'failed'}; }
  if(interrupted){
    const over=run.workers.find(worker=>(worker.continuations??0)>(config.work_units?.max_continuations_per_unit??3));
    if(over){ run.status='blocked'; updateParallelRun(run); state.status='blocked'; state.blocker=`併行任務 ${over.task_id} 已超過自動續跑上限`; state.next_action='請檢查該 worktree 與日誌後執行 page-autodev resume'; writeJson(statePath,state); return {status:'blocked'}; }
    run.status='interrupted'; updateParallelRun(run); state.status='repairing'; state.next_action=`從既有 worktree 續跑批次 ${run.run_id} 的未完成任務`; writeJson(statePath,state); console.log('【併行自動續跑】已保留各 Worker 的檔案進度；下一輪只續跑中斷任務。'); return {status:'retry'};
  }
  if(!run.workers.every(worker=>worker.status==='candidate_ready')) return {status:'retry'};
  console.log('【開始串行整合】所有 Worker 均已產生候選 commit；依序 cherry-pick 並執行每項任務驗證。');
  const integrated=integrateParallelRun(project,run,config);
  if(!integrated.ok){ state.status='failed'; state.blocker=integrated.reason; state.next_action='請查看併行整合驗證收據，修復失敗任務後執行 page-autodev resume'; writeJson(statePath,state); timer(project,false); await notifyTelegram(project,'parallel_integration_failed','❌ 頁構所 AI：併行結果整合驗證失敗',state,integrated.reason); return {status:'failed'}; }
  gitCheckpoint(project,config,`併行批次 ${run.run_id} 完成並通過逐任務驗證`);
  state.status='running'; state.blocker=null; state.next_action='重新計算任務圖，派發下一批安全任務或進入實作 Gate'; state.updated_at=now(); writeJson(statePath,state);
  console.log(`【併行批次完成】${run.workers.map(worker=>worker.task_id).join('、')} 已整合並通過驗證。`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
  return {status:'complete'};
}

async function run(project) {
  project = assertProject(project); const release = lock(project);
  const statePath=path.join(project,'.ai','PROJECT_STATE.json'), configPath=path.join(project,'.ai','AUTODEV_CONFIG.json');
  const logDir=path.join(project,'.ai','logs'); fs.mkdirSync(logDir,{recursive:true});
  const logPath=path.join(logDir,`autodev-${new Date().toISOString().slice(0,10)}.log`);
  try {
    let state=readJson(statePath), config=readJson(configPath);
    console.log(`\n【專案】${path.basename(project)}`);
    console.log(`【目前狀態】${STATUS_LABELS[state.status]??state.status}`);
    console.log(`【目前階段】${PHASE_LABELS[state.phase]??state.phase}`);
    console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
    if (!config.enabled) { console.log('【停止】此專案的全自動執行目前未啟用。請使用 page-autodev start 或 resume。'); return 0; }
    // 主迴圈最前段：先收斂未完成的 transaction，再檢查 stage approval，最後才處理輸入變更。
    const reconciled=reconcileGateTransactions(project,state,config);
    for(const line of reconciled) console.log(line);
    for(const line of reconcileStageApprovals(project,state)) console.log(line);
    routeChangedInput(state,project);
    if (['blocked','failed','stopped','complete'].includes(state.status)) { console.log(`【不執行】目前狀態為「${STATUS_LABELS[state.status]??state.status}」。若已排除問題，請明確執行 page-autodev resume。`); return 0; }
    if (fs.existsSync(path.join(project,'.ai','AUTODEV_STOP'))) { state.status='stopped'; state.updated_at=now(); writeJson(statePath,state); return 0; }
    if (state.resume_after && Date.parse(state.resume_after)>Date.now()) { const seconds=Math.ceil((Date.parse(state.resume_after)-Date.now())/1000),kind=state.status==='service_paused'?'服務恢復':'額度'; console.log(`【${kind}等待】距下次允許嘗試尚有 ${seconds} 秒；預計於 ${taipeiTime(state.resume_after)} 自動重新檢查。`); return 75; }
    state.run_id ??= `run-${Date.now()}`; state.status='running'; state.blocker=null; state.resume_after=null; state.next_action=`執行「${PHASE_LABELS[state.phase]??state.phase}」`; state.updated_at=now(); writeJson(statePath,state);
    while (state.phase !== 'complete') {
      if (fs.existsSync(path.join(project,'.ai','AUTODEV_STOP'))) { state.status='stopped'; break; }
      if (state.phase === 'not_started') { state.phase='input_analysis'; state.attempt=0; state.next_action='分析並分類 docs/input/ 原始資料'; console.log('【下一步】進入原始資料分析與分類。'); writeJson(statePath,state); continue; }
      routeChangedInput(state,project);
      const def=PHASES[state.phase]; if (!def) throw new Error(`無法辨識的流程階段：${state.phase}`);
      // A task may be completed outside the controller while the project is
      // blocked (for example, an operator-approved infrastructure repair).
      // Reconcile the task graph before dispatching Claude so an empty
      // implementation phase advances directly to its gate instead of
      // launching an unscoped agent that can only end at max_turns.
      if(state.phase==='implementation'&&taskGraphDone(project)){
        state.phase=def.next; state.attempt=0; state.status='running'; state.blocker=null;
        state.next_action=`所有開發任務已完成；執行「${PHASE_LABELS[state.phase]??state.phase}」`;
        state.updated_at=now(); writeJson(statePath,state);
        console.log(`【任務圖已收斂】所有開發任務均已完成，不再啟動無指定任務的 Agent；直接前往「${PHASE_LABELS[state.phase]??state.phase}」。`);
        continue;
      }
      if(state.phase==='implementation') {
        const parallel=await runParallelImplementation(project,state,config,logPath,statePath);
        if(parallel?.status==='complete'||parallel?.status==='retry') continue;
        if(parallel?.status==='quota') return 75;
        if(parallel?.status==='failed') return 1;
        if(parallel?.status==='blocked') break;
      }
      let phaseGraph=null, phasePlan=null, workUnit=null, parallelUnits=[];
      if(UNITIZED_PHASES.has(state.phase)&&config.work_units?.enabled!==false) {
        ({graph:phaseGraph,plan:phasePlan}=ensurePhasePlan(project,state.phase,state));
        if(phasePlanDone(phasePlan)) {
          phasePlan.status='complete'; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
          if(PHASES[state.phase]?.kind==='gate'&&state.gate_verification_mode==='targeted'&&state.active_findings?.length){
            // 逐筆 structured 結果才可關閉；缺結果者維持 open/verifying，不得因階段完成就整批放行。
            const store=loadFindings(project),reported=collectTargetedFindingResults(phasePlan,state.active_findings);
            finishVerification(store,reported.results); saveFindings(project,store);
            if(reported.missing.length){
              state.status='repairing'; state.gate_verification_mode='repairing'; state.active_findings=reported.missing;
              state.next_action=`定點複驗未涵蓋 ${reported.missing.join('、')}；必須逐筆回報 finding_results 後才可進入完整 Gate`;
              writeJson(statePath,state); console.log(`【定點複驗不完整】${reported.missing.length} 筆 finding 未取得逐筆驗證結果，維持未關閉。`); continue;
            }
            if(reported.failed.length){
              state.status='repairing'; state.gate_verification_mode='repairing'; state.active_findings=reported.failed;
              state.next_action=`定點複驗未通過 ${reported.failed.join('、')}`;
              writeJson(statePath,state); console.log(`【定點複驗未通過】${reported.failed.join('、')} 仍未達 acceptance。`); continue;
            }
            state.gate_verification_mode='final'; resetPhasePlan(project,state.phase); state.status='running'; state.next_action='所有定點缺陷已關閉；執行一次完整回歸 Gate'; writeJson(statePath,state); console.log('【定點複驗通過】相關 findings 已關閉；接著只執行一次完整回歸 Gate。'); continue;
          }
          if(PHASES[def.next]?.kind==='gate'&&state.active_findings?.length&&state.gate_verification_mode==='repairing'){
            const store=loadFindings(project); beginVerification(store,state.active_findings); saveFindings(project,store); state.gate_verification_mode='targeted';
          }
          // AK：Gate 通過後的多檔案變更必須是一個可 crash-recovery 的 logical transaction。
          // 順序固定為 promotion → approval receipt → finding finalization → phase advance。
          if(PHASES[state.phase]?.kind==='gate'){
            const commit=commitGatePhase(project,state,config,phasePlan,def);
            if(!commit.ok){
              state.status='blocked'; state.blocker=commit.reason; state.next_action='請確認 Gate 來源與 ADR 內容後執行 page-autodev resume-once';
              writeJson(statePath,state); console.log(`【Gate Commit 中止】${commit.reason}`);
              await notifyTelegram(project,'gate_commit_aborted','🛑 頁構所 AI：Gate 提交被安全中止',state,commit.reason); break;
            }
            for(const line of commit.log) console.log(line);
          } else {
            captureCompletedInputFingerprint(state,project,state.phase);
            state.phase=def.next; state.attempt=0; state.next_action=`執行「${PHASE_LABELS[state.phase]??state.phase}」`; state.updated_at=now(); writeJson(statePath,state);
          }
          if(state.gate_verification_mode==='final'&&PHASES[state.phase]?.kind!=='gate'){ delete state.gate_verification_mode; delete state.active_findings; writeJson(statePath,state); }
          console.log(`【階段工作單元完成｜產品 ${productProgress(project,state)}%｜流程 ${overallProgress(project,state).percent}%】全部 ${phasePlan.units.length} 個子任務均已完成，前往「${PHASE_LABELS[state.phase]??state.phase}」。`); continue;
        }
        if(PHASES[state.phase]?.kind==='gate'&&config.gate_efficiency?.artifact_hash_fast_pass!==false){
          let reused=0; for(const unit of readyWorkUnits(phasePlan)){ const probe=gateCacheProbe(project,state.phase,unit); if(!probe.hit) continue; unit.status='complete'; unit.completed_at=now(); unit.last_summary=`來源、Gate 規則與 Prompt 版本均未變更；沿用 ${taipeiTime(probe.previous.updated_at)} 的通過結果。`; unit.evidence=[`Artifact hash ${probe.fingerprint}`,`Gate cache ${gateCacheKey(state.phase,unit)}：pass`]; unit.cache_hit=true; reused++; console.log(`【Artifact hash 快速通過】${unit.id}｜來源與審查規則未變更，不啟動 Claude。`); }
          if(reused){ phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); state.status='running'; state.next_action='繼續執行尚未通過快取的 Gate 單元'; writeJson(statePath,state); continue; }
        }
        parallelUnits=parallelReadOnlyUnits(phasePlan,state.phase,config);
        workUnit=parallelUnits[0]??currentWorkUnit(phasePlan);
        if(!workUnit) throw new Error(`「${PHASE_LABELS[state.phase]??state.phase}」找不到相依條件已滿足的工作單元。`);
      }
      if(workUnit?.id==='RELEASE-GATE-RISKS'){
        const file=path.join(project,'.ai','RELEASE_RISKS.json'),store=fs.existsSync(file)?readJson(file):{risks:[]},open=(store.risks??[]).filter(risk=>risk.status==='open');
        if(open.length){ workUnit.status='blocked'; workUnit.last_summary=`仍有 ${open.length} 項正式發布風險待處理`; workUnit.evidence=open.map(risk=>`${risk.id}｜${risk.title}`); savePhaseGraph(project,phaseGraph); state.status='blocked'; state.blocker=`開發與 QA 已完成，但正式發布前仍有 ${open.length} 項部署／維運風險待關閉`; state.next_action='請查看 .ai/RELEASE_RISKS.json；補齊部署參數或證據後執行 page-autodev resume'; writeJson(statePath,state); console.log(`【Release Gate 暫停】開發與 QA 不受影響；正式發布前仍須處理 ${open.length} 項風險。`); await notifyTelegram(project,'release_gate_blocked','🚦 頁構所 AI：正式發布仍有前置風險',state,open.map(risk=>`${risk.id}｜${risk.title}`).join('\n')); break; }
        workUnit.status='complete'; workUnit.completed_at=now(); workUnit.last_summary='沒有未關閉的 Release risks'; workUnit.evidence=['.ai/RELEASE_RISKS.json：0 項 open']; savePhaseGraph(project,phaseGraph); state.status='running'; state.blocker=null; state.next_action='完成正式發布前置關卡'; writeJson(statePath,state); console.log('【Release Gate 通過】沒有未關閉的部署／維運風險；未執行 push 或部署。'); continue;
      }
      if(workUnit&&workUnit.last_terminal_reason==='max_turns'){
        const acceptance=postInterruptAcceptance(project,state.phase,workUnit,config);
        if(acceptance.accepted){
          console.log(`【續跑前成果驗收】${workUnit.id} 上次因 turns 上限中斷；先驗收已保存成果，不先啟動 Claude。`);
          completeInterruptedWorkUnit(project,state,statePath,config,phaseGraph,phasePlan,workUnit,acceptance);
          continue;
        }
        if(acceptance.eligible) console.log(`【續跑前成果未通過】${workUnit.id}｜${acceptance.reason}；才交由 Agent 接續修復。`);
      }
      if(workUnit&&state.phase==='architecture'){
        // machine 單元一律由控制器確定性執行，即使帶有 Gate 診斷也不得交給 Claude 做語意修復。
        const machineOnly=isMachineUnit(workUnit.id);
        const machine=(workUnit.machine_feedback&&!machineOnly)?null:machineHandleDiagramUnit(project,workUnit,config);
        if(workUnit.machine_feedback&&!machineOnly) console.log(`【語意修復優先】${workUnit.id} 帶有 Gate 定點診斷，本輪必須由 Architect 修正語意；不以純格式或版面驗證提前跳過。`);
        if(workUnit.machine_feedback&&machineOnly) console.log(`【確定性修復動作】${workUnit.id} 為 machine 單元，由控制器重新產生產物與證據，不消耗 Claude turns。`);
        if(machine?.ok){
          workUnit.status='complete'; workUnit.completed_at=now(); workUnit.last_summary='控制器已確定性完成此 Archify 規格辨識、產生或驗證單元；需求語意留待 Architecture Gate 獨立審查。'; workUnit.evidence=machine.evidence; workUnit.continuations=0; workUnit.no_progress_count=0; delete workUnit.session_id; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
          const done=phasePlan.units.filter(unit=>unit.status==='complete').length; state.status='running'; state.blocker=null; state.next_action=done===phasePlan.units.length?`完成「${PHASE_LABELS[state.phase]??state.phase}」工作單元並進入 Gate`:'執行下一個工作單元'; state.updated_at=now(); writeJson(statePath,state);
          gitCheckpoint(project,config,`${workUnit.id} 控制器確定性驗證通過`);
          console.log(`【免 AI 驗證通過】${workUnit.id}｜不消耗 Claude turns。`); for(const evidence of machine.evidence) console.log(`【驗證證據】${evidence}`); console.log(`【階段進度】${done}/${phasePlan.units.length}（${Math.round(done/phasePlan.units.length*100)}%）`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`); continue;
        }
        if(machine&&!machine.ok){
          console.log(`【確定性驗證未通過】${machine.reason}；才交由 Architect Agent 定點修復。`);
          if(workUnit.id.endsWith('-BUILD')){
            const specId=workUnit.id.replace(/-BUILD$/,'-SPEC'),specUnit=phasePlan.units.find(unit=>unit.id===specId);
            if(specUnit){ specUnit.status='repairing'; specUnit.machine_feedback=machine.reason; specUnit.updated_at=now(); workUnit.status='pending'; workUnit.machine_feedback=machine.reason; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); state.status='repairing'; state.blocker=null; state.next_action=`依 Archify validate 診斷修復 ${specId}`; writeJson(statePath,state); console.log(`【自動退回規格修復】${workUnit.id} 無法產生，已退回 ${specId}；保留精確診斷並使用同一工作單元 session 續跑。`); continue; }
          }
          workUnit.machine_feedback=machine.reason; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
        }
      }
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`【開始步驟】${PHASE_LABELS[state.phase]??state.phase}`);
      console.log(`【執行 Agent】${def.agent}`);
      const routing=modelRouting(project,state.phase,config);
      routing.unit=workUnit;
      routing.input_revision=state.input_revision??0;
      if(workUnit?.id==='ARCH-SPEC-FREEZE') Object.assign(routing,{model:'opus',effort:'high',reason:'圖表規格語意凍結屬高風險獨立審查，通過後才允許產生最終視覺成果'});
      routing.resume_session_id=workUnit?.session_id??(routing.task?state.task_runtime?.[routing.task.id]?.session_id:null);
      routing.continuations=workUnit?.continuations??(routing.task?state.task_runtime?.[routing.task.id]?.continuations:0)??0;
      routing.gate_verification_mode=state.gate_verification_mode; routing.finding_context=activeFindingContext(project,state);
      applyGateRouteEfficiency(project,state.phase,state,workUnit,routing,config);
      routing.overall_percent=overallProgress(project,state).percent; routing.product_percent=productProgress(project,state);
      console.log(`【產品完成度】${routing.product_percent}%`); console.log(`【流程進度】${routing.overall_percent}%`);
      console.log(`【選用模型】${routing.model}（推理強度：${routing.effort}）`);
      console.log(`【選用原因】${routing.reason}`);
      if(routing.fallback&&routing.fallback!==routing.model) console.log(`【備援模型】若 ${routing.model} 暫時不可用，改用 ${routing.fallback}，並在執行紀錄中標示實際模型。`);
      if(routing.task) console.log(`【指定任務】${routing.task.id}｜${routing.task.title}｜風險：${routing.task.risk??'未標示'}`);
      if(routing.task&&routing.complexity_policy) console.log(`【Ponytail 複雜度政策】${routing.complexity_policy.mode}／${routing.complexity_policy.rollout}｜${routing.complexity_policy.review_required?'符合條件，完成前執行一次 diff-only 自審':'一般最小正確實作檢查'}｜獨立 Gate 不受影響`);
      if(workUnit) { const done=phasePlan.units.filter(unit=>unit.status==='complete').length,budget=adaptiveTurnBudget(project,state.phase,routing,config); console.log(`【目前子任務】${workUnit.id}｜${workUnit.title}`); console.log(`【階段進度】${done}/${phasePlan.units.length}（${Math.round(done/phasePlan.units.length*100)}%）`); console.log(`【子任務動作】${workUnit.prompt}`); console.log(`【Turns 動態預算】基礎 ${budget.base}；本輪 ${budget.turns}/${budget.cap} turns${budget.reasons.length?`｜${budget.reasons.join('、')}`:''}。若中斷會保存成果並接續原 Session。`); }
      else console.log(`【本步驟動作】${def.prompt}`);
      console.log(`【完成後動作】${workUnit?'保存子任務證據與 Git checkpoint，然後執行下一個相依條件已滿足的子任務。':def.kind==='gate'?'依審查結果進入下一階段，或退回上一階段自動修復。':'解析執行證據、更新狀態並前往下一個 Gate。'}`);
      console.log(`【詳細日誌】${logPath}`);
      console.log(`【等待提示】每 10 秒回報一次執行狀態；平常只顯示已執行時間，僅在距安全停止上限剩下 5 分鐘時顯示警告倒數。`);
      if(state.phase==='implementation'&&routing.task&&deploymentPreflightNeeded(routing.task)) {
        console.log('【部署前預檢】此任務涉及 Compose／端對端驗證；先核對容器連線與既有資料卷，不啟動 Claude。');
        const preflight=deploymentPreflight(project,routing.task);
        for(const check of preflight.checks??[]) console.log(`【預檢通過】${check}`);
        if(!preflight.ok) {
          const detail=(preflight.issues??[]).join('；');
          state.status='blocked'; state.blocker=`部署前一致性預檢未通過：${detail}`; state.next_action='先修正 Compose／環境變數／既有資料卷漂移，再執行 page-autodev resume；本次未啟動 Claude'; state.updated_at=now();
          appendHistory(state,{at:now(),phase:state.phase,task:routing.task.id,outcome:'deployment_preflight_blocked',issues:preflight.issues??[]}); writeJson(statePath,state); timer(project,false);
          console.log(`【部署前預檢停止】${detail}`); await notifyTelegram(project,'deployment_preflight_blocked','🧭 頁構所 AI：部署前一致性預檢未通過',state,`任務：${routing.task.id}\n${detail}\nClaude 尚未啟動，因此未消耗本輪 Agent 額度。`); break;
        }
      }
      gitCheckpoint(project,config,`${PHASE_LABELS[state.phase]??state.phase}執行前`);
      if(def.kind==='gate'&&config.machine_quality_gates!==false) {
        console.log(`【機器品質 Gate】先執行可重現檢查；全部通過後才會使用 ${routing.model} 進行 AI 審查。`);
        const receipt=runQualityGate(project,state.phase);
        for(const check of receipt.checks) console.log(`${check.ok?'【品質通過】':'【品質失敗】'}${check.name}：${check.detail||'無補充資訊'}`);
        appendHistory(state,{at:now(),phase:state.phase,outcome:receipt.ok?'machine_gate_pass':'machine_gate_fail',quality_checks:receipt.checks});
        if(!receipt.ok) {
          state.attempt=(state.attempt??0)+1;
          if(state.attempt>(config.max_repair_attempts??3)) { state.status='blocked'; state.blocker='機器品質 Gate 已超過自動修復次數上限'; state.next_action='請操作者查看品質檢查紀錄並修復後執行 page-autodev resume'; console.log(`【停止自動修復】${state.blocker}`); writeJson(statePath,state); gitCheckpoint(project,config,'機器品質 Gate 達修復上限'); await notifyTelegram(project,'machine_gate_repair_limit','🛑 頁構所 AI：品質檢查需要人工介入',state,'機器品質 Gate 已達自動修復次數上限。'); break; }
          const failedGatePhase=state.phase; state.status='repairing'; state.blocker='機器品質 Gate 未通過'; state.phase=def.repair??state.phase; state.next_action=`修復品質檢查後重新執行「${PHASE_LABELS[state.phase]??state.phase}」`;
          if(UNITIZED_PHASES.has(state.phase)) resetPhasePlan(project,state.phase); if(UNITIZED_PHASES.has(failedGatePhase)) resetPhasePlan(project,failedGatePhase);
          console.log(`【Gate 暫停】機器檢查未全部通過，本次不消耗 ${routing.model} 審查額度。`); console.log(`【自動修復】退回「${PHASE_LABELS[state.phase]??state.phase}」。`);
          writeJson(statePath,state); gitCheckpoint(project,config,'機器品質 Gate 未通過'); continue;
        }
      }
      if(parallelUnits.length>1) {
        console.log(`【受控併行】本批次同時執行 ${parallelUnits.length} 個唯讀審查單元；不允許寫檔，完成後統一整合審查結果。`);
        for(const unit of parallelUnits) { unit.status='running'; unit.started_at=now(); }
        phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
        // AG：整批 reviewer 必須審查同一份 source；批次前只 capture 一次。
        const gateBatchSourceOptions=def.kind==='gate'?gateSourceOptions(state,config):null;
        const gateBatchSourceFingerprint=gateBatchSourceOptions?computeGateSourceFingerprint(project,gateBatchSourceOptions):null;
        const machineOwnedBefore=snapshotMachineOwned(project);
        const batch=await Promise.all(parallelUnits.map(async (unit,index)=>{
          const unitRouting={...modelRouting(project,state.phase,config),unit,overall_percent:overallProgress(project,state).percent,product_percent:productProgress(project,state),resume_session_id:unit.session_id??null,continuations:unit.continuations??0,parallel_slot:index+1,parallel_total:parallelUnits.length,gate_verification_mode:state.gate_verification_mode,finding_context:activeFindingContext(project,state)}; applyGateRouteEfficiency(project,state.phase,state,unit,unitRouting,config);
          console.log(`【併行啟動】${unit.id}｜${unit.title}｜${unitRouting.model}`);
          const result=await runClaude(project,state.phase,def,config,logPath,unitRouting);
          return {unit,routing:unitRouting,result,combined:result.stdout+'\n'+result.stderr};
        }));
        const quota=batch.find(item=>item.result.code!==0&&quotaError(item.combined));
        if(quota) {
          for(const item of batch) if(item.unit.status==='running') { if(item.result.code===0) try { const saved=deferReleaseFindings(project,parseResult(item.result.stdout),state.phase); if(saved.outcome==='pass'){ item.unit.status='complete'; item.unit.completed_at=now(); item.unit.last_summary=saved.summary; item.unit.evidence=saved.evidence; saveGateCachePass(project,state.phase,item.unit,saved); delete item.unit.session_id; console.log(`【額度暫停前成果保留】${item.unit.id} 已完成且通過，不會因同批其他單元額度不足而重跑。`); } else item.unit.status='pending'; } catch { item.unit.status='pending'; } else item.unit.status='pending'; }
          savePhaseGraph(project,phaseGraph); state.status='quota_paused'; state.resume_after=quotaResumeAt(quota.combined,config.quota_retry_minutes??30,config.quota_retry_delay_minutes??5); state.blocker='偵測到 Claude 使用額度限制'; state.next_action=`系統將於 ${taipeiTime(state.resume_after)}（額度刷新後延遲 ${config.quota_retry_delay_minutes??5} 分鐘）自動重新檢查；額度正常即接續原任務`; writeJson(statePath,state); scheduleQuotaRetry(project,state.resume_after); await notifyTelegram(project,'quota_paused','⏸️ 頁構所 AI：Claude 額度暫停',state,'受控併行批次已安全保存；已通過單元不會重跑，未完成單元會在額度恢復後續行。'); return 75;
        }
        const interrupted=batch.filter(item=>item.result.code!==0&&terminalReason(item.result.stdout).reason==='max_turns');
        for(const item of interrupted) {
          const terminal=terminalReason(item.result.stdout);
          item.unit.status='interrupted';
          item.unit.continuations=(item.unit.continuations??0)+1;
          item.unit.last_terminal_reason='max_turns';
          item.unit.session_id=terminal.session_id??item.unit.session_id??null;
          item.unit.updated_at=now();
          appendHistory(state,{at:now(),phase:state.phase,work_unit:item.unit.id,outcome:'interrupted_max_turns',continuation:item.unit.continuations,parallel_batch:true});
          console.log(`【併行審查續跑】${item.unit.id} 已達本輪 ${item.unit.max_turns} turns；已保存 Session，下一輪將從原審查脈絡接續。`);
        }
        const crashed=batch.find(item=>item.result.code!==0&&terminalReason(item.result.stdout).reason!=='max_turns');
        if(crashed) {
          for(const item of batch) if(item.unit.status==='running') item.unit.status='pending';
          crashed.unit.status='failed'; savePhaseGraph(project,phaseGraph); state.status='failed'; state.blocker=`併行工作單元 ${crashed.unit.id} 的 Claude 程序以錯誤代碼 ${crashed.result.code} 結束`; state.next_action=`請查看日誌 ${logPath}，排除問題後執行 page-autodev resume`; writeJson(statePath,state); timer(project,false); await notifyTelegram(project,'parallel_process_failed','❌ 頁構所 AI：併行工作單元異常停止',state,crashed.unit.id); return 1;
        }
        const parsedBatch=[],malformed=[];
        for(const item of batch.filter(entry=>entry.result.code===0)) try { parsedBatch.push({...item,verdict:def.kind==='gate'?deferReleaseFindings(project,parseResult(item.result.stdout),state.phase):parseResult(item.result.stdout)}); } catch(error) { malformed.push({item,error}); }
        if(malformed.length) {
          let exhausted=null;
          for(const {item,error} of malformed){ item.unit.status='interrupted'; item.unit.format_retries=(item.unit.format_retries??0)+1; item.unit.session_id=terminalReason(item.result.stdout).session_id??item.unit.session_id??null; item.unit.machine_feedback=`${item.unit.machine_feedback??''}\n控制器已保存工作成果，但最終結構化收據無法解析（${error.message}）。不得重做工作；只核對既有成果並回傳一個完整 JSON 物件，至少包含 outcome、summary、evidence、repair_targets。`.trim(); item.unit.updated_at=now(); if(item.unit.format_retries>2) exhausted=item; }
          for(const item of batch) if(item.unit.status==='running') item.unit.status='pending'; savePhaseGraph(project,phaseGraph);
          if(exhausted){ state.status='blocked'; state.blocker=`${exhausted.unit.id} 已連續 3 次未提供可解析的結構化收據`; state.next_action='請查看原始日誌後執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'parallel_result_format_limit','🛑 頁構所 AI：審查結果格式多次無法解析',state,exhausted.unit.id); break; }
          state.status='repairing'; state.blocker=null; state.next_action=`續接 ${malformed.map(entry=>entry.item.unit.id).join('、')}，只補齊結構化執行收據`; writeJson(statePath,state); console.log(`【結構化結果自動補正】${malformed.map(entry=>entry.item.unit.id).join('、')} 的工作成果已保留；將續接原 Session，只要求補回 JSON 收據，不重做審查。`); continue;
        }
        for(const item of parsedBatch) {
          appendHistory(state,{at:now(),phase:state.phase,work_unit:item.unit.id,outcome:item.verdict.outcome,summary:item.verdict.summary,evidence:item.verdict.evidence,parallel_batch:true,model_route:{requested:item.routing.model,effort:item.routing.effort}});
          item.unit.last_summary=item.verdict.summary; item.unit.evidence=item.verdict.evidence; item.unit.updated_at=now();
          // AF：保存 reviewer 的 structured ADR 審查結果，供 Gate Commit 作為唯一 promotion authority。
          if(item.verdict.reviewed_adr_paths!==undefined) item.unit.reviewed_adr_paths=normalizeStringList(item.verdict.reviewed_adr_paths);
          if(item.verdict.finding_results!==undefined) item.unit.finding_results=Array.isArray(item.verdict.finding_results)?item.verdict.finding_results:[];
          console.log(`【併行結果】${item.unit.id}｜${OUTCOME_LABELS[item.verdict.outcome]??item.verdict.outcome}｜${item.verdict.summary}`);
        }
        // AI：reviewer/agent 都不得改動 controller 擁有的證據檔。
        const ownedViolations=detectMachineOwnedViolations(machineOwnedBefore,snapshotMachineOwned(project),{unitId:null});
        if(ownedViolations.length){
          for(const item of batch) { item.unit.status='failed'; item.unit.last_terminal_reason=MACHINE_OWNED_VIOLATION; item.unit.updated_at=now(); }
          savePhaseGraph(project,phaseGraph);
          const reason=machineOwnedViolationReason(ownedViolations);
          appendGateAudit(project,{event:'machine_owned_violation',gate_phase:state.phase,violations:ownedViolations,units:parallelUnits.map(unit=>unit.id)});
          state.status='blocked'; state.blocker=reason; state.next_action='請還原被修改的控制器證據檔後執行 page-autodev resume-once';
          writeJson(statePath,state); console.log(`【證據保護】${reason}`);
          await notifyTelegram(project,'machine_owned_violation','🛑 頁構所 AI：工作單元修改了控制器證據檔',state,ownedViolations.map(item=>item.path).join('、')); break;
        }
        // AG：整批完成後 source 必須仍與批次開始時相同，否則整批作廢（不可只採信其中幾個 reviewer）。
        if(gateBatchSourceFingerprint){
          const verified=verifyGateSourceUnchanged(project,gateBatchSourceFingerprint,gateBatchSourceOptions);
          if(!verified.ok){
            for(const item of batch) if(['running','interrupted'].includes(item.unit.status)||parsedBatch.some(entry=>entry.unit===item.unit)) { item.unit.status='pending'; delete item.unit.session_id; item.unit.updated_at=now(); }
            savePhaseGraph(project,phaseGraph);
            appendGateAudit(project,{event:'gate_batch_discarded',gate_phase:state.phase,code:verified.code,before:verified.before,after:verified.after,units:parsedBatch.map(item=>item.unit.id)});
            state.status='repairing'; state.blocker=null; state.next_action='來源已變動，重新以現行內容執行完整 Gate 審查'; writeJson(statePath,state);
            console.log(`【Gate 來源變動】${verified.reason}；整批 ${parsedBatch.length} 個審查結果作廢，不採信、不寫入 findings、不推進階段。`);
            continue;
          }
        }
        // AC：每個 unit 先做確定性裁定，再依 effective outcome 聚合。
        const gateFacts=def.kind==='gate'?gateDeterministicFacts(project,config):null;
        const adjudicatedBatch=parsedBatch.map(item=>({item,adjudication:gateFacts?adjudicateGateUnit(project,item.unit,item.verdict,gateFacts):{unit_id:item.unit.id,raw_outcome:item.verdict.outcome,effective_outcome:item.verdict.outcome,overridden:false,adjudicated:[],surviving_findings:item.verdict.findings??[],machine_injected:[],contradicted:[],surviving_repair_targets:item.verdict.repair_targets??[]}}));
        for(const {item,adjudication} of adjudicatedBatch){
          if(gateFacts) appendGateAudit(project,{event:'gate_unit_adjudication',gate_phase:state.phase,unit:item.unit.id,raw_outcome:adjudication.raw_outcome,effective_outcome:adjudication.effective_outcome,contradicted:adjudication.contradicted.map(entry=>entry.finding?.title?.slice(0,80)),machine_injected:adjudication.machine_injected.length,source_fingerprint:gateBatchSourceFingerprint});
          if(adjudication.overridden) console.log(`【確定性裁定】${item.unit.id} raw=${adjudication.raw_outcome} → effective=pass；全部 development blocker 已被機器證據推翻。`);
        }
        const aggregate=aggregateGateBatch(adjudicatedBatch.map(entry=>entry.adjudication));
        const blockedEntry=adjudicatedBatch.find(entry=>entry.adjudication.effective_outcome==='blocked');
        if(blockedEntry) { const blocked=blockedEntry.item; for(const {item,adjudication} of adjudicatedBatch) item.unit.status=item===blocked?'blocked':(adjudication.effective_outcome==='pass'?'complete':'pending'); savePhaseGraph(project,phaseGraph); state.status='blocked'; state.blocker=blocked.verdict.blocker||blocked.verdict.summary; state.next_action='補齊阻塞所需資訊後，執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'parallel_operator_input_required','🙋 頁構所 AI：併行審查需要操作者提供資訊',state,blocked.unit.id); break; }
        const failureEntries=adjudicatedBatch.filter(entry=>entry.adjudication.effective_outcome==='failed');
        if(failureEntries.length) {
          const failures=failureEntries.map(entry=>entry.item);
          for(const {item,adjudication} of adjudicatedBatch) item.unit.status=failures.includes(item)?'failed':(adjudication.effective_outcome==='pass'?'complete':'pending'); savePhaseGraph(project,phaseGraph);
          // effective repair targets 只由 surviving findings 重算，被推翻者不留 ghost target。
          const effective=buildEffectiveVerdict(failureEntries.map(entry=>entry.adjudication));
          const combinedVerdict={...effective,summary:failures.map(item=>`${item.unit.id}：${item.verdict.summary}`).join('\n'),evidence:failures.flatMap(item=>item.verdict.evidence??[]),findings:failureEntries.flatMap(entry=>entry.adjudication.surviving_findings.map(finding=>({...finding,gate_unit:entry.item.unit.id})))};
          const failedGatePhase=state.phase,repairPhase=def.repair??state.phase,failedIds=failures.map(item=>item.unit.id).join('、'),repair=prepareTargetedGateRepair(project,state,config,failedGatePhase,repairPhase,failedIds,combinedVerdict);
          if(repair.blocked) { console.log(`【Gate 修復熔斷】${state.blocker}`); await notifyTelegram(project,'gate_repair_circuit_breaker','🛑 頁構所 AI：Gate 自動修復已達安全上限',state,`修復目標：${repair.targets.join('、')}`); break; }
          console.log(`【併行 Gate 定點修復】${failedIds} 未通過；整合全部失敗結果後只重開 ${repair.targets.join('、')}。本 Gate 第 ${repair.guard.total}/${repair.guard.maxTotal} 輪，相同目標第 ${repair.guard.same}/${repair.guard.maxSame} 輪。`); continue;
        }
        for(const item of parsedBatch) { item.unit.status='complete'; item.unit.completed_at=now(); saveGateCachePass(project,state.phase,item.unit,item.verdict); delete item.unit.session_id; }
        if(interrupted.length) {
          const over=interrupted.find(item=>(item.unit.continuations??0)>(config.max_work_unit_continuations??4));
          phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
          if(over) {
            over.unit.status='blocked'; state.status='blocked'; state.blocker=`唯讀審查單元 ${over.unit.id} 已超過自動續跑上限`; state.next_action='請查看該子任務證據與日誌後執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'parallel_review_continuation_limit','🛑 頁構所 AI：審查子任務自動續跑已達安全上限',state,over.unit.id); break;
          }
          state.status='repairing'; state.blocker=null; state.next_action=`從原 Session 自動續跑 ${interrupted.map(item=>item.unit.id).join('、')}`; writeJson(statePath,state);
          console.log(`【自動接續】唯讀併行審查尚未完成；控制器將直接續接原 Session，不會誤判為程序失敗。`);
          continue;
        }
        phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); gitCheckpoint(project,config,`${PHASE_LABELS[state.phase]??state.phase}併行唯讀審查通過`);
        const done=phasePlan.units.filter(unit=>unit.status==='complete').length; state.status='running'; state.blocker=null; state.next_action=done===phasePlan.units.length?`完成「${PHASE_LABELS[state.phase]??state.phase}」工作單元並進入下一階段`:'執行下一批相依條件已滿足的工作單元'; state.updated_at=now(); writeJson(statePath,state);
        console.log(`【併行批次完成】本批 ${parallelUnits.length} 個工作單元均已通過。`); console.log(`【階段進度】${done}/${phasePlan.units.length}（${Math.round(done/phasePlan.units.length*100)}%）`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`); continue;
      }
      const intakeStartFingerprint=state.phase==='input_analysis'?inputFingerprint(project):null;
      const beforeProgress=changedFileSnapshot(project);
      if(workUnit) { workUnit.status='running'; workUnit.started_at=now(); workUnit.before_snapshot=beforeProgress; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); }
      const serialOwnedBefore=snapshotMachineOwned(project);
      const result=await runClaude(project,state.phase,def,config,logPath,routing); const combined=result.stdout+'\n'+result.stderr;
      // AI：序列 agent/reviewer 同樣不得改動 controller 擁有的證據檔。
      const serialOwnedViolations=detectMachineOwnedViolations(serialOwnedBefore,snapshotMachineOwned(project),{unitId:workUnit?.id??routing.task?.id??null});
      if(serialOwnedViolations.length){
        const reason=machineOwnedViolationReason(serialOwnedViolations);
        if(workUnit){ workUnit.status='failed'; workUnit.last_terminal_reason=MACHINE_OWNED_VIOLATION; workUnit.updated_at=now(); savePhaseGraph(project,phaseGraph); }
        appendGateAudit(project,{event:'machine_owned_violation',phase:state.phase,unit:workUnit?.id??routing.task?.id??null,violations:serialOwnedViolations});
        state.status='blocked'; state.blocker=reason; state.next_action='請還原被修改的控制器證據檔後執行 page-autodev resume-once';
        writeJson(statePath,state); console.log(`【證據保護】${reason}`);
        await notifyTelegram(project,'machine_owned_violation','🛑 頁構所 AI：工作單元修改了控制器證據檔',state,serialOwnedViolations.map(item=>item.path).join('、')); break;
      }
      if (result.code!==0) {
        const terminal=terminalReason(result.stdout);
        if(workUnit&&terminal.reason==='max_turns') {
          const afterProgress=changedFileSnapshot(project), progressed=afterProgress!==beforeProgress;
          const acceptance=postInterruptAcceptance(project,state.phase,workUnit,config);
          if(acceptance.accepted){
            completeInterruptedWorkUnit(project,state,statePath,config,phaseGraph,phasePlan,workUnit,acceptance);
            continue;
          }
          if(acceptance.eligible) console.log(`【中斷後驗收未通過】${workUnit.id}｜${acceptance.reason}；只針對未通過項目接續，不會誤標記完成。`);
          workUnit.status='interrupted'; workUnit.continuations=(workUnit.continuations??0)+1; workUnit.no_progress_count=progressed?0:(workUnit.no_progress_count??0)+1; workUnit.after_snapshot=afterProgress; workUnit.last_terminal_reason='max_turns'; workUnit.session_id=terminal.session_id??workUnit.session_id??null; workUnit.updated_at=now();
          appendHistory(state,{at:now(),phase:state.phase,work_unit:workUnit.id,outcome:'interrupted_max_turns',progressed,continuation:workUnit.continuations});
          const circuit=continuationCircuit(workUnit,config);
          if(circuit.blocked) {
            state.status='blocked'; state.blocker=`工作單元 ${workUnit.id} 自動續跑停止：${circuit.reason}`; state.next_action='請操作者查看子任務證據與日誌；調整範圍後執行 page-autodev resume'; workUnit.status='blocked'; workUnit.circuit_reason=circuit.kind; savePhaseGraph(project,phaseGraph); writeJson(statePath,state); gitCheckpoint(project,config,`${workUnit.id} 自動續跑熔斷`); await notifyTelegram(project,'work_unit_circuit_breaker','🛑 頁構所 AI：子任務自動續跑已達安全上限',state,`${workUnit.id}｜${workUnit.title}｜${circuit.reason}`); break;
          }
          state.status='repairing'; state.blocker=null; state.next_action=`自動續跑 ${workUnit.id} 的剩餘工作`; savePhaseGraph(project,phaseGraph); writeJson(statePath,state); gitCheckpoint(project,config,`${workUnit.id} turns 中斷續跑點`); console.log(`【自動續跑】${workUnit.id} 達 turns 上限；${progressed?'已偵測到實質檔案進度並保存 checkpoint':'本次未偵測到 Git 狀態變化'}。將以新的精簡 Context 只完成剩餘工作。`); continue;
        }
        if(routing.task&&terminal.reason==='max_turns') {
          const taskId=routing.task.id, afterProgress=changedFileSnapshot(project), progressed=afterProgress!==beforeProgress; state.task_runtime??={}; const runtime=state.task_runtime[taskId]??={continuations:0,no_progress_count:0}; runtime.continuations+=1; runtime.no_progress_count=progressed?0:runtime.no_progress_count+1; runtime.last_terminal_reason='max_turns'; runtime.session_id=terminal.session_id??runtime.session_id??null; runtime.updated_at=now();
          appendHistory(state,{at:now(),phase:state.phase,task:taskId,outcome:'interrupted_max_turns',progressed,continuation:runtime.continuations});
          const circuit=continuationCircuit(runtime,config);
          if(circuit.blocked) { state.status='blocked'; state.blocker=`實作任務 ${taskId} 自動續跑停止：${circuit.reason}`; state.next_action='請操作者查看任務證據與日誌，調整範圍後執行 page-autodev resume'; runtime.circuit_reason=circuit.kind; writeJson(statePath,state); gitCheckpoint(project,config,`${taskId} 自動續跑熔斷`); await notifyTelegram(project,'implementation_task_circuit_breaker','🛑 頁構所 AI：實作任務續跑已達安全上限',state,`${taskId}｜${routing.task.title}｜${circuit.reason}`); break; }
          state.status='repairing'; state.blocker=null; state.next_action=`自動續跑實作任務 ${taskId} 的剩餘工作`; writeJson(statePath,state); gitCheckpoint(project,config,`${taskId} turns 中斷續跑點`); console.log(`【實作任務自動續跑】${taskId} 達 turns 上限；${progressed?'已保存實質進度':'本次未偵測到 Git 狀態變化'}，將只完成剩餘工作。`); continue;
        }
        if(authenticationError(combined)){ if(workUnit){ workUnit.status='repairing'; workUnit.updated_at=now(); delete workUnit.session_id; savePhaseGraph(project,phaseGraph); } state.status='blocked'; state.blocker='Claude OAuth 登入已過期，且自動刷新失敗'; state.next_action='請在遠端主機重新完成 Claude 登入；登入成功後再由操作者決定是否續行'; state.resume_after=null; appendHistory(state,{at:now(),phase:state.phase,work_unit:workUnit?.id??null,outcome:'authentication_required'}); writeJson(statePath,state); timer(project,false); await notifyTelegram(project,'claude_authentication_required','🔐 頁構所 AI：Claude 登入已過期',state,'工作單元保持可恢復狀態，未計入執行失敗或修復次數。'); return 1; }
        if (quotaError(combined)) { const delay=config.quota_retry_delay_minutes??5; state.status='quota_paused'; state.resume_after=quotaResumeAt(combined,config.quota_retry_minutes??30,delay); state.blocker='偵測到 Claude 使用額度限制'; state.next_action=`系統將於 ${taipeiTime(state.resume_after)}（額度刷新後延遲 ${delay} 分鐘）自動重新檢查；額度正常即接續原任務`; console.log(`【額度暫停】已保存目前狀態，預計於 ${taipeiTime(state.resume_after)}（刷新後 ${delay} 分鐘）再次嘗試。`); appendHistory(state,{at:now(),phase:state.phase,outcome:'quota_paused',resume_after:state.resume_after,retry_delay_minutes:delay}); writeJson(statePath,state); scheduleQuotaRetry(project,state.resume_after); await notifyTelegram(project,'quota_paused','⏸️ 頁構所 AI：Claude 額度暫停',state,`狀態已保存，將在額度刷新後延遲 ${delay} 分鐘自動檢查；額度正常即接續原任務。`); return 75; }
        if (transientServiceError(combined)) {
          const terminal=terminalReason(result.stdout),afterProgress=changedFileSnapshot(project),progressed=afterProgress!==beforeProgress;
          state.service_retry_attempts=Number(state.service_retry_attempts??0)+1; const retry=transientResumeAt(state.service_retry_attempts,config.service_retry_minutes??2,config.service_retry_max_minutes??15);
          if(workUnit){ workUnit.status='interrupted'; workUnit.session_id=terminal.session_id??workUnit.session_id??null; workUnit.after_snapshot=afterProgress; workUnit.last_terminal_reason='service_unavailable'; workUnit.updated_at=now(); savePhaseGraph(project,phaseGraph); }
          if(routing.task){ state.task_runtime??={}; const runtime=state.task_runtime[routing.task.id]??={continuations:0,no_progress_count:0}; runtime.session_id=terminal.session_id??runtime.session_id??null; runtime.last_terminal_reason='service_unavailable'; runtime.updated_at=now(); }
          state.status='service_paused'; state.resume_after=retry.resume_after; state.blocker=`Claude 服務暫時無法使用（HTTP ${terminal.api_error_status??'5xx'}），不是專案執行失敗`; state.next_action=`系統將於 ${taipeiTime(state.resume_after)} 自動接續原 Session`; appendHistory(state,{at:now(),phase:state.phase,work_unit:workUnit?.id,task:routing.task?.id,outcome:'service_paused',progressed,resume_after:state.resume_after,retry_attempt:state.service_retry_attempts}); writeJson(statePath,state);
          if(progressed) gitCheckpoint(project,config,`${workUnit?.id??routing.task?.id??state.phase} 服務過載前安全續跑點`);
          scheduleServiceRetry(project,state.resume_after); await notifyTelegram(project,'claude_service_paused','⏳ 頁構所 AI：Claude 服務暫時過載',state,`已保存 Session 與目前成果；${retry.delay_minutes} 分鐘後自動接續，不消耗修復輪次。`); return 75;
        }
        state.status='failed'; state.blocker=`Claude 程序以錯誤代碼 ${result.code} 結束`; state.next_action=`請查看日誌 ${logPath}，排除問題後執行 page-autodev resume`; console.error(`【執行失敗】${state.blocker}。請查看 ${logPath}`); appendHistory(state,{at:now(),phase:state.phase,outcome:'failed'}); writeJson(statePath,state); timer(project,false); await notifyTelegram(project,'claude_process_failed','❌ 頁構所 AI：執行程序異常停止',state); return 1;
      }
      state.service_retry_attempts=0;
      let verdict; try { verdict=normalizeStrategyReceipt(parseResult(result.stdout)); if(def.kind==='gate') verdict=deferReleaseFindings(project,verdict,state.phase); } catch (error) {
        if(workUnit){ workUnit.status='interrupted'; workUnit.format_retries=(workUnit.format_retries??0)+1; workUnit.session_id=terminalReason(result.stdout).session_id??workUnit.session_id??null; workUnit.machine_feedback=`${workUnit.machine_feedback??''}\n控制器已保存工作成果，但最終結構化收據無法解析（${error.message}）。不得重做工作；只核對既有成果並回傳一個完整 JSON 物件，至少包含 outcome、summary、evidence、repair_targets。`.trim(); workUnit.updated_at=now(); savePhaseGraph(project,phaseGraph);
          if(workUnit.format_retries<=2){ state.status='repairing'; state.blocker=null; state.next_action=`續接 ${workUnit.id}，只補齊結構化執行收據`; writeJson(statePath,state); gitCheckpoint(project,config,`${workUnit.id} 結構化收據補正點`); console.log(`【結構化結果自動補正】${workUnit.id} 的檔案成果已保留；將續接原 Session，只要求補回 JSON 收據，不重做工作。`); continue; }
          state.status='blocked'; state.blocker=`${workUnit.id} 已連續 3 次未提供可解析的結構化收據：${error.message}`; state.next_action='請查看原始日誌後執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'result_format_limit','🛑 頁構所 AI：執行結果格式多次無法解析',state,workUnit.id); break;
        }
        state.status='failed'; state.blocker=`無法解析 Claude 的結構化結果：${error.message}；請查看 ${logPath}`; state.next_action='請檢查詳細日誌，排除問題後執行 page-autodev resume'; writeJson(statePath,state); timer(project,false); console.error(`【解析失敗】${state.blocker}`); await notifyTelegram(project,'result_parse_failed','❌ 頁構所 AI：執行結果解析失敗',state); return 1;
      }
      if(state.phase==='implementation'&&routing.task&&verdict.outcome==='blocked'){
        const resolved=resolveContradictedImplementationBlock(project,routing.task,verdict);
        verdict=resolved.verdict;
        if(resolved.contradiction){
          console.log(`【實作任務過期阻塞自動駁回】${resolved.contradiction}`);
          console.log(resolved.verified.ok?`【確定性驗證通過】${routing.task.id} 不再要求人工處理已修復的舊前提。`:`【確定性驗證發現真實失敗】${resolved.verified.reason}`);
        }
      }
      if(workUnit?.reflection_required&&verdict.outcome==='pass') {
        const store=loadFindings(project),finding=store.findings.find(item=>(workUnit.finding_ids??[]).includes(item.id)),previous=finding?.strategies?.at(-1),reflectionCheck=validateReflection(verdict.strategy_reflection,previous);
        if(!reflectionCheck.ok) {
          workUnit.reflection_retries=(workUnit.reflection_retries??0)+1;
          workUnit.session_id=terminalReason(result.stdout).session_id??workUnit.session_id??null;
          workUnit.updated_at=now();
          if(workUnit.reflection_retries<=2){
            workUnit.status='interrupted';
            workUnit.machine_feedback=`${workUnit.machine_feedback??''}\n控制器已保留本輪檔案成果與 checkpoint；目前只缺策略反思收據（${reflectionCheck.reason}）。不得重做或擴張修復內容；請只補回完整收據，且 root_cause、new_strategy、difference_from_previous、files_to_change、verification 五欄都必須放在 strategy_reflection 物件內，並保留原 outcome、summary、evidence。`.trim();
            savePhaseGraph(project,phaseGraph); state.status='repairing'; state.blocker=null; state.next_action=`續接 ${workUnit.id}，只補齊策略反思收據`; writeJson(statePath,state); gitCheckpoint(project,config,`${workUnit.id} 策略反思收據補正點`); console.log(`【策略反思自動補正】${workUnit.id} 的實質成果已保留；將續接原 Session，只補齊缺漏欄位（${workUnit.reflection_retries}/2）。`); continue;
          }
          workUnit.status='blocked'; savePhaseGraph(project,phaseGraph); state.status='blocked'; state.blocker=`${workUnit.id} 已連續 3 次無法提供有效策略反思：${reflectionCheck.reason}`; state.next_action='請檢查前次策略與新策略差異後執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'repair_strategy_invalid','🛑 頁構所 AI：重複缺陷缺少有效的新修復策略',state,workUnit.id); break;
        }
        verdict.strategy_reflection=reflectionCheck.reflection;
        workUnit.reflection_retries=0;
      }
      console.log(`【步驟結果】${OUTCOME_LABELS[verdict.outcome]??verdict.outcome}`);
      console.log(`【結果摘要】${verdict.summary}`);
      console.log(`【實際模型紀錄】${verdict.models_used.length?verdict.models_used.join('、'):'Claude 未回傳模型明細'}`);
      let complexityMetric=null;
      if(state.phase==='implementation'&&routing.task&&verdict.outcome==='pass') {
        complexityMetric=recordComplexityMetric(project,routing.task,routing.complexity_policy,verdict);
        if(complexityMetric) console.log(`【Ponytail 收據】${complexityMetric.mode}／${complexityMetric.rollout}｜新增 ${complexityMetric.added_lines} 行｜變更 ${complexityMetric.files_changed} 檔｜${complexityMetric.receipt.receipt_missing?'未收到收據但不中斷本輪':'收據已保存'}`);
      }
      appendHistory(state,{at:now(),phase:state.phase,work_unit:workUnit?.id??null,task:routing.task?.id??null,outcome:verdict.outcome,summary:verdict.summary,evidence:verdict.evidence,model_route:{requested:routing.model,effort:routing.effort,fallback:routing.fallback,reason:routing.reason},models_used:verdict.models_used,complexity:complexityMetric});
      gitCheckpoint(project,config,`${workUnit?`${workUnit.id}｜${workUnit.title}`:PHASE_LABELS[state.phase]??state.phase}結果：${OUTCOME_LABELS[verdict.outcome]??verdict.outcome}`);
      if (verdict.outcome==='blocked') {
        const contradiction=contradictedBlockedClaim(project,verdict);
        if(contradiction&&workUnit&&(workUnit.stale_blocker_retries??0)<2){ workUnit.status='repairing'; workUnit.stale_blocker_retries=(workUnit.stale_blocker_retries??0)+1; workUnit.continuations=0; workUnit.no_progress_count=0; workUnit.machine_feedback=`控制器已駁回過期阻塞（第 ${workUnit.stale_blocker_retries}/2 次）：${contradiction}\n請重新讀取目前檔案並只完成尚未通過的 verification；不得再次引用 node:20-alpine 舊狀態。`; delete workUnit.session_id; workUnit.updated_at=now(); phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); state.status='repairing'; state.blocker=null; state.next_action=`${workUnit.id} 的過期阻塞已駁回，將以目前 repository 事實重新驗證`; writeJson(statePath,state); console.log(`【過期阻塞自動駁回】${contradiction}`); continue; }
        if(contradiction&&workUnit){
          console.log(`【過期阻塞確定性驗證】Agent 已重複引用被 repository 證偽的前提；控制器改執行 ${workUnit.id} 宣告的 verification。`);
          const verified=runDeclaredVerification(project,workUnit);
          if(verified.ok){
            workUnit.status='complete'; workUnit.completed_at=now(); workUnit.last_summary=`控制器駁回重複的過期阻塞並完成確定性驗證：${contradiction}`; workUnit.evidence=[...(workUnit.evidence??[]),...verified.evidence]; workUnit.after_snapshot=changedFileSnapshot(project); workUnit.stale_blocker_retries=0; delete workUnit.session_id; delete workUnit.machine_feedback; delete workUnit.blocked_reason; workUnit.updated_at=now(); phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
            state.status='running'; state.blocker=null; state.next_action='執行下一個工作單元'; state.updated_at=now(); writeJson(statePath,state); gitCheckpoint(project,config,`${workUnit.id} 過期阻塞確定性驗證通過`); console.log(`【確定性驗證通過】${workUnit.id} 的所有宣告 verification 均通過；不再要求人工處理過期阻塞。`); continue;
          }
          workUnit.status='blocked'; workUnit.last_summary=verified.reason; workUnit.updated_at=now(); savePhaseGraph(project,phaseGraph); state.status='blocked'; state.blocker=`${workUnit.id} 的過期阻塞已被駁回，但確定性驗證發現真實失敗：${verified.reason}`; state.next_action='修復確定性驗證的第一個真實失敗後，再執行 page-autodev resume'; writeJson(statePath,state); console.log(`【確定性驗證失敗】${verified.reason}`); await notifyTelegram(project,'deterministic_verification_failed','🛑 頁構所 AI：確定性驗證發現真實阻塞',state,contradiction); break;
        }
        const visualDiagnostic=[verdict.summary,verdict.blocker,...(verdict.evidence??[])].filter(Boolean).join('\n');
        const routed=workUnit&&/(visual-check|viewport|overflow|readability|containment|版面|溢位)/i.test(visualDiagnostic)&&routeDiagramVerifyRepair(state,phasePlan,workUnit,visualDiagnostic);
        if(routed?.routed){ savePhaseGraph(project,phaseGraph); writeJson(statePath,state); console.log(`【圖表驗證自動退回】${workUnit.id} 的 visual-check 缺陷已定點退回 ${routed.specId}（第 ${routed.attempt}/2 輪）；修訂後將重新執行語意凍結、產生與驗證，不要求人工補充。`); continue; }
        state.status='blocked'; state.blocker=verdict.blocker||verdict.summary; state.next_action='補齊阻塞所需資訊後，執行 page-autodev resume'; if(workUnit) { workUnit.status='blocked'; workUnit.last_summary=verdict.summary; workUnit.updated_at=now(); savePhaseGraph(project,phaseGraph); } console.log(`【需要操作者處理】${state.blocker}`); console.log('【之後請執行】page-autodev resume'); await notifyTelegram(project,'operator_input_required','🙋 頁構所 AI：需要操作者提供資訊',state); break;
      }
      if (verdict.outcome==='failed') {
        if(workUnit) {
          if(workUnit.id==='ARCH-SPEC-FREEZE'){
            const allowed=new Set(['ARCH-SYSTEM-SPEC','ARCH-WORKFLOW-SPEC','ARCH-LIFECYCLE-SPEC','ARCH-DATAFLOW-SPEC']),targets=[...new Set(verdict.repair_targets??[])].filter(id=>allowed.has(id));
            const guard=targets.length?registerSemanticFreezeFailure(project,state,targets,config):null;
            if(!targets.length||guard.blocked){ workUnit.status='blocked'; savePhaseGraph(project,phaseGraph); state.status='blocked'; state.blocker=!targets.length?'圖表語意凍結未提供有效的明確修復目標':`圖表語意凍結停止：${guard.reason}`; state.next_action='請檢查語意凍結證據後執行 page-autodev resume'; writeJson(statePath,state); await notifyTelegram(project,'semantic_freeze_blocked','🛑 頁構所 AI：圖表語意凍結需要人工介入',state,verdict.summary); break; }
            for(const unit of phasePlan.units.filter(item=>targets.includes(item.id))){ unit.status='repairing'; unit.machine_feedback=verdict.summary; unit.updated_at=now(); }
            resetSemanticFreezeReviewer(workUnit,'上游結構化圖表將重新檢查或修訂，禁止沿用修訂前的審查 session'); workUnit.last_summary=verdict.summary; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph); state.status='repairing'; state.blocker=null; state.next_action=`只修復語意凍結指定的 ${targets.join('、')}`; writeJson(statePath,state); console.log(`【語意凍結定點退回】第 ${guard.total}/${guard.maxTotal} 輪；${guard.progressed?'已確認規格內容或修復範圍有進展':'規格內容尚無進展'}；相同內容失敗 ${guard.same}/${guard.maxSame} 次。只重開 ${targets.join('、')}；下次凍結將由新 session 重新讀取現行 JSON。`); continue;
          }
          if(def.kind==='gate') {
            const failedGatePhase=state.phase, repairPhase=def.repair??state.phase; workUnit.status='failed'; workUnit.last_summary=verdict.summary; workUnit.evidence=verdict.evidence; savePhaseGraph(project,phaseGraph);
            const repair=prepareTargetedGateRepair(project,state,config,failedGatePhase,repairPhase,workUnit.id,verdict);
            if(repair.blocked) { console.log(`【Gate 修復熔斷】${state.blocker}`); await notifyTelegram(project,'gate_repair_circuit_breaker','🛑 頁構所 AI：Gate 自動修復已達安全上限',state,`修復目標：${repair.targets.join('、')}`); break; }
            console.log(`【Gate 定點修復】${workUnit.id} 未通過；只重開 ${repair.targets.join('、')}。本 Gate 第 ${repair.guard.total}/${repair.guard.maxTotal} 輪，相同目標第 ${repair.guard.same}/${repair.guard.maxSame} 輪。`); continue;
          }
          workUnit.attempt=(workUnit.attempt??0)+1; workUnit.status='repairing'; workUnit.last_summary=verdict.summary; workUnit.updated_at=now();
          if(workUnit.attempt>(config.work_units?.max_repair_attempts_per_unit??2)) { state.status='blocked'; state.blocker=`工作單元 ${workUnit.id} 已超過自動修復次數上限：${verdict.summary}`; state.next_action='請操作者檢查子任務證據，處理後執行 page-autodev resume'; workUnit.status='blocked'; savePhaseGraph(project,phaseGraph); await notifyTelegram(project,'work_unit_repair_limit','🛑 頁構所 AI：工作單元修復已達上限',state,`${workUnit.id}｜${workUnit.title}`); break; }
          state.status='repairing'; state.blocker=null; state.next_action=`自動修復工作單元 ${workUnit.id}`; savePhaseGraph(project,phaseGraph); writeJson(statePath,state); console.log(`【子任務自動修復】${workUnit.id} 第 ${workUnit.attempt} 次修復；只處理未通過項目。`); continue;
        }
        state.attempt=(state.attempt??0)+1;
        if (state.attempt > (config.max_repair_attempts??3)) { state.status='blocked'; state.blocker=`「${PHASE_LABELS[state.phase]??state.phase}」已超過自動修復次數上限：${verdict.summary}`; state.next_action='請操作者檢查失敗原因，處理後執行 page-autodev resume'; console.log(`【停止自動修復】${state.blocker}`); await notifyTelegram(project,'ai_repair_limit','🛑 頁構所 AI：自動修復已達上限',state); break; }
        state.phase=def.repair ?? state.phase; state.status='repairing'; state.blocker=verdict.summary; if(UNITIZED_PHASES.has(state.phase)) resetPhasePlan(project,state.phase); writeJson(statePath,state); continue;
      }
      if(workUnit) {
        if(verdict.strategy_reflection&&workUnit.finding_ids?.length){ const store=loadFindings(project); for(const finding of store.findings.filter(item=>workUnit.finding_ids.includes(item.id))) finding.strategies.push({...verdict.strategy_reflection,work_unit:workUnit.id,at:now()}); saveFindings(project,store); }
        workUnit.status='complete'; workUnit.completed_at=now(); workUnit.last_summary=verdict.summary; workUnit.evidence=verdict.evidence; workUnit.after_snapshot=changedFileSnapshot(project); if(def.kind==='gate') saveGateCachePass(project,state.phase,workUnit,verdict); delete workUnit.session_id; delete workUnit.machine_feedback; delete workUnit.repair_source; delete workUnit.format_retries; if(workUnit.id==='ARCH-SPEC-FREEZE'){
          // Hard invariant：Requirements Approval 為 null 時不得建立 authoritative Semantic Freeze。
          const upstream=requirementsApprovalGate(project,state.input_revision??0);
          if(!upstream.ok){
            workUnit.status='pending'; delete workUnit.completed_at; delete workUnit.session_id; phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
            state.status='blocked'; state.blocker=`${upstream.code}：${upstream.reason}`; state.next_action='請完成 read-only Requirements compatibility verification 並建立 approval receipt 後執行 page-autodev resume-once';
            writeJson(statePath,state); console.log(`【語意凍結阻擋】${upstream.reason}`);
            await notifyTelegram(project,'requirements_approval_required','🛑 頁構所 AI：缺少 Requirements 核准，無法凍結語意',state,upstream.code); break;
          }
          const freezeReceipt=writeSemanticFreeze(project,{inputRevision:state.input_revision??0,requirementsApprovalFingerprint:upstream.fingerprint,reviewSourceFingerprint:computeGateSourceFingerprint(project,gateSourceOptions(state,config))});
          state.architecture_spec_frozen_at=now(); state.semantic_freeze_fingerprint=freezeReceipt.semantic_fingerprint; state.architecture_generation_key=freezeReceipt.architecture_generation_key;
          state.semantic_freeze_attempts=0; delete state.semantic_freeze_guard;
          console.log(`【圖表語意已凍結】semantic_fingerprint=${freezeReceipt.semantic_fingerprint.slice(0,16)}…；generation_key=${freezeReceipt.architecture_generation_key.slice(0,16)}…；upstream requirements approval ${upstream.fingerprint.slice(0,16)}…`);
        } phasePlan.updated_at=now(); savePhaseGraph(project,phaseGraph);
        const done=phasePlan.units.filter(unit=>unit.status==='complete').length; state.status='running'; state.blocker=null; state.next_action=done===phasePlan.units.length?`完成「${PHASE_LABELS[state.phase]??state.phase}」工作單元並進入 Gate`:`執行下一個工作單元`; state.updated_at=now(); writeJson(statePath,state);
        console.log(`【子任務完成】${workUnit.id}｜${workUnit.title}`); console.log(`【階段進度】${done}/${phasePlan.units.length}（${Math.round(done/phasePlan.units.length*100)}%）`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`); continue;
      }
      if (state.phase==='implementation' && !taskGraphDone(project)) { state.attempt=0; state.next_action='開發下一個相依條件已完成的任務'; console.log('【下一步】仍有未完成的開發任務，將選取下一個相依條件已滿足的任務。'); writeJson(statePath,state); continue; }
      if (def.kind==='gate') { state.gates ??= {}; state.gates[state.phase]={status:'passed',at:now(),evidence:verdict.evidence}; }
      if (state.phase==='input_analysis') { state.input_fingerprint=intakeStartFingerprint; state.input_fingerprint_updated_at=now(); }
      state.phase=def.next; state.attempt=0; state.blocker=null; state.next_action=state.phase==='complete'?'全自動流程已完成':`執行「${PHASE_LABELS[state.phase]??state.phase}」`; state.updated_at=now(); console.log(`【下一步】${state.next_action}`); writeJson(statePath,state);
    }
    if (state.phase==='complete') { state.status='complete'; state.next_action='等待操作者明確核准正式部署'; state.updated_at=now(); appendHistory(state,{at:now(),phase:'complete',outcome:'pass'}); console.log('【全部完成】需求、架構、規格、排程、開發、審查與 QA 均已通過。正式部署仍需操作者明確核准。'); await notifyTelegram(project,'workflow_complete','✅ 頁構所 AI：全自動開發流程完成',state,'需求、架構、規格、排程、開發、審查與 QA 均已通過；正式部署仍需人工核准。'); }
    writeJson(statePath,state);
    if (['blocked','failed','complete'].includes(state.status)) timer(project,false);
    console.log(`\n【最終狀態】${STATUS_LABELS[state.status]??state.status}`); console.log(`【停留階段】${PHASE_LABELS[state.phase]??state.phase}`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`); if(state.blocker) console.log(`【阻塞原因】${state.blocker}`); console.log(`【下一個動作】${state.next_action}`); return state.status==='blocked'?2:0;
  } finally { release(); }
}

function status(project) {
  project=assertProject(project); const state=readJson(path.join(project,'.ai','PROJECT_STATE.json')),config=readJson(path.join(project,'.ai','AUTODEV_CONFIG.json')),phasePlan=loadPhaseGraph(project).phases[state.phase],runtime=runtimeStatus(project);
  const implementationTasks=state.phase==='implementation'?readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks.filter(item=>!String(item.id).startsWith('REQ-')):null;
  const activeImplementationTask=implementationTasks?.find(item=>['running','repairing'].includes(String(item.status).toLowerCase()))??(state.phase==='implementation'?nextReadyTask(project):null);
  const plan=implementationTasks?{units:implementationTasks}:phasePlan;
  const unit=implementationTasks?activeImplementationTask:(plan?currentWorkUnit(plan):null),done=plan?.units.filter(item=>implementationTasks?taskComplete(item):item.status==='complete').length??0,parallel=config.parallel_execution?.enabled!==false;
  const stopping=fs.existsSync(path.join(project,'.ai','AUTODEV_STOP'))&&runtime.running,effective=stopping?'正在停止':runtime.running?(STATUS_LABELS[state.status]??state.status):state.status==='running'?'狀態待同步（目前無執行程序）':(STATUS_LABELS[state.status]??state.status);
  const next=runtime.running?`正在執行「${PHASE_LABELS[state.phase]??state.phase}」${unit?`／${unit.id} ${unit.title}`:''}，完成後將解析結果並決定下一階段`:displayText(state.next_action)||'尚未設定';
  const baseService=runtime.units.find(item=>item.unit===`page-autodev@${path.basename(project)}.service`),baseTimer=runtime.units.find(item=>item.unit===`page-autodev@${path.basename(project)}.timer`),quota=runtime.units.filter(item=>item.unit.startsWith(quotaUnitPrefix(project))&&item.running),quotaGroups=[...new Set(quota.map(item=>item.unit.replace(/\.(service|timer)$/,'')))];
  const settings=config.parallel_execution??{};
  console.log(`【專案】${path.basename(project)}\n【狀態】${effective}\n【產品完成度】${productProgress(project,state)}%\n【流程進度】${overallProgress(project,state).percent}%\n【階段】${PHASE_LABELS[state.phase]??state.phase}${plan?`\n【子任務進度】${done}/${plan.units.length}（${Math.round(done/plan.units.length*100)}%）\n【目前子任務】${unit?`${unit.id}｜${unit.title}`:'全部完成'}`:''}\n【受控併行】${parallel?`已啟用，唯讀最多 ${parallelConcurrency(settings,'read')}、寫入最多 ${parallelConcurrency(settings,'write')}`:'未啟用'}\n【主控制器】${runtime.ownerAlive?`執行中（PID ${runtime.owner.pid}）`:'未執行'}\n【一般服務】${baseService?.active??'inactive'}／${baseService?.sub??'dead'}\n【一般計時器】${baseTimer?.active??'inactive'}／${baseTimer?.sub??'dead'}\n【額度喚醒器】${quotaGroups.length?`${quotaGroups.length} 組執行中：${quotaGroups.join('、')}`:'無執行中項目'}\n【執行鎖】${runtime.ownerAlive?'有效':'無有效鎖定'}\n【下一個動作】${next}\n【阻塞原因】${displayText(state.blocker)||'無'}\n【自動執行】${config.enabled?'已啟用':'未啟用'}`);
}
function parallelDiagnostics(project){
  project=assertProject(project); const config=readJson(path.join(project,'.ai','AUTODEV_CONFIG.json')),graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')),done=new Set(graph.tasks.filter(taskComplete).map(task=>task.id)),selected=[];
  console.log(`【併行資格診斷】${path.basename(project)}｜唯讀上限 ${parallelConcurrency(config.parallel_execution??{},'read')}｜寫入上限 ${parallelConcurrency(config.parallel_execution??{},'write')}`);
  for(const task of graph.tasks){ if(taskComplete(task)||String(task.id).startsWith('REQ-')) continue; const reasons=explainParallelEligibility(task,done,selected); if(!reasons.length&&selected.length<parallelConcurrency(config.parallel_execution??{},'write')){ selected.push(task); console.log(`✅ ${task.id}｜可加入下一個寫入併行批次`); } else console.log(`⏸️ ${task.id}｜${reasons.length?reasons.join('；'):'已達本批併行上限'}`); }
  if(selected.length<2) console.log('【本輪結果】不足兩個安全候選，將採序列執行。'); else console.log(`【本輪結果】可併行 ${selected.length} 個：${selected.map(task=>task.id).join('、')}`);
}
function routingStatus(project) { project=assertProject(project); const config=readJson(path.join(project,'.ai','AUTODEV_CONFIG.json')); console.log(`【專案模型路由】${path.basename(project)}`); for(const phase of Object.keys(DEFAULT_MODEL_ROUTING)) { const r=modelRouting(project,phase,config); console.log(`- ${PHASE_LABELS[phase]}：${r.model}／${r.effort}${phase==='implementation'&&r.task?`｜目前任務 ${r.task.id}｜${r.reason}`:''}`); } console.log(`【備援模型】${config.fallback_model??'sonnet'}`); }
function showWorkPlan(project) {
  project=assertProject(project); const state=readJson(path.join(project,'.ai','PROJECT_STATE.json'));
  if(UNITIZED_PHASES.has(state.phase)) ensurePhasePlan(project,state.phase,state);
  const graph=loadPhaseGraph(project); console.log(`【工作單元計畫】${path.basename(project)}`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
  for(const [phase,plan] of Object.entries(graph.phases)) { const done=plan.units.filter(unit=>unit.status==='complete').length; console.log(`\n【${PHASE_LABELS[phase]??phase}】${done}/${plan.units.length}`); for(const unit of plan.units) console.log(`- ${unit.status==='complete'?'✅':unit.status==='running'?'▶️':unit.status==='blocked'?'🛑':'⏳'} ${unit.id}｜${unit.title}｜${unit.max_turns} turns｜續跑 ${unit.continuations??0}${unit.parallel_safe?'｜可安全併行':''}`); }
}
function showParallelStatus(project){
  project=assertProject(project); const run=currentParallelStatus(project);
  console.log(`【寫入型併行狀態】${path.basename(project)}`);
  if(!run){ console.log('【目前批次】尚無併行開發紀錄。'); return; }
  console.log(`【批次】${run.run_id}`); console.log(`【狀態】${run.status}`); console.log(`【基準版本】${String(run.base_commit??'未知').slice(0,8)}`);
  for(const worker of run.workers) console.log(`- ${worker.status==='complete'?'✅':worker.status==='running'?'▶️':worker.status==='candidate_ready'?'📦':worker.status==='blocked'?'🛑':worker.status==='failed'?'❌':'⏳'} ${worker.task_id}｜${worker.title}｜${worker.status}${worker.commit?`｜候選 ${worker.commit.slice(0,8)}`:''}`);
  if(run.integration) console.log(`【整合狀態】${run.integration.status}｜${run.integration.receipts?.length??0} 組驗證收據`);
}
function verifyArchitectureArtifacts(project){
  project=assertProject(project); const statePath=path.join(project,'.ai','PROJECT_STATE.json'),state=readJson(statePath),config=readJson(path.join(project,'.ai','AUTODEV_CONFIG.json'));
  if(state.phase!=='architecture') { console.log('【確定性驗證略過】目前不在架構階段。'); return; }
  const {graph,plan}=ensurePhasePlan(project,'architecture',state); let completed=0,progress=true,repairUnit=null;
  while(progress){ progress=false; const complete=new Set(plan.units.filter(unit=>unit.status==='complete').map(unit=>unit.id));
    for(const unit of plan.units){
      if(unit.status==='complete'||!(unit.depends_on??[]).every(id=>complete.has(id))) continue;
      const result=machineHandleDiagramUnit(project,unit,config); if(!result) continue;
      if(!result.ok){
        console.log(`【確定性檢查未通過】${unit.id}｜${result.reason}`);
        const specId=unit.id.replace(/-(BUILD|VERIFY)$/,'-SPEC'),specUnit=plan.units.find(item=>item.id===specId);
        if(specUnit){ specUnit.status='repairing'; specUnit.machine_feedback=result.reason; specUnit.updated_at=now(); if(unit!==specUnit) unit.status='pending'; repairUnit=specUnit; }
        progress=false; break;
      }
      unit.status='complete'; unit.completed_at=now(); unit.last_summary='控制器確定性完成 Archify 規格辨識、產生或驗證；需求語意留待 Architecture Gate。'; unit.evidence=result.evidence; unit.continuations=0; unit.no_progress_count=0; delete unit.session_id; completed++; progress=true; complete.add(unit.id); console.log(`【免 AI 完成】${unit.id}`);
    }
  }
  if(completed||repairUnit){ plan.updated_at=now(); savePhaseGraph(project,graph); state.status=repairUnit?'ready':state.status; state.blocker=null; const current=currentWorkUnit(plan); state.next_action=repairUnit?`依確定性診斷修復 ${repairUnit.id}`:(current?`執行 ${current.id}｜${current.title}`:'進入架構審查關卡'); state.updated_at=now(); writeJson(statePath,state); gitCheckpoint(project,config,repairUnit?`記錄 ${repairUnit.id} 的 Archify 精確修復診斷`:`控制器完成 ${completed} 個 Archify 確定性驗證單元`); }
  console.log(`【驗證摘要】本次免用 Claude 完成 ${completed} 個單元。`); console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
}
async function watchProgress(project) {
  const name=path.basename(assertProject(project));
  const state=readJson(path.join(project,'.ai','PROJECT_STATE.json'));
  console.log(`【即時進度】正在追蹤專案「${name}」的背景執行訊息。`);
  console.log(`【目前狀態】${STATUS_LABELS[state.status]??state.status}｜${PHASE_LABELS[state.phase]??state.phase}`);
  console.log(`【產品完成度】${productProgress(project,state)}%`); console.log(`【流程進度】${overallProgress(project,state).percent}%`);
  console.log('【離開方式】按 Ctrl+C 只會停止觀看，不會停止自動開發流程。');
  console.log('【歷史分隔】以下先顯示最近 20 筆背景紀錄；出現新時間即為後續即時訊息。');
  const runtime=runtimeStatus(project),quotaGroups=new Set(runtime.activeUnits.filter(item=>item.unit.startsWith(quotaUnitPrefix(project))).map(item=>item.unit.replace(/\.(service|timer)$/,'')));
  console.log(`【執行程序】${runtime.running?'仍在執行':'目前沒有執行中的控制器或工作單元'}；【額度喚醒器】${quotaGroups.size} 組。`);
  const journalUnits=runtime.units.filter(item=>item.unit.endsWith('.service')).map(item=>item.unit),args=['--user','--follow','--lines','20','--output','short-iso'];
  journalUnits.forEach((unit,index)=>{ if(index) args.push('+'); args.push(`_SYSTEMD_USER_UNIT=${unit}`); });
  if(runtime.ownerAlive){ if(journalUnits.length) args.push('+'); args.push(`_PID=${runtime.owner.pid}`); }
  await new Promise((resolve,reject)=>{ const child=spawn('journalctl',args,{stdio:'inherit'}); child.on('error',reject); child.on('close',code=>code===0||code===130?resolve():reject(new Error(`無法讀取背景進度，journalctl 結束代碼：${code}`))); });
}
function enable(project, value) { project=assertProject(project); const p=path.join(project,'.ai','AUTODEV_CONFIG.json'), c=readJson(p); c.enabled=value; writeJson(p,c); if(value) fs.rmSync(path.join(project,'.ai','AUTODEV_STOP'),{force:true}); }
function clearHold(project) {
  project=assertProject(project); const p=path.join(project,'.ai','PROJECT_STATE.json'),s=readJson(p);
  if(!['blocked','failed','stopped'].includes(s.status)) return;
  let graph=loadPhaseGraph(project),plan=graph.phases[s.phase];
  if(s.phase==='implementation'&&(!plan||!(plan.units??[]).length)) {
    const ensured=ensurePhasePlan(project,s.phase,s); graph=ensured.graph; plan=ensured.plan;
  }
  const unit=plan?currentWorkUnit(plan):null;
  if(s.phase==='architecture'&&unit&&/^ARCH-(?:SYSTEM|WORKFLOW|LIFECYCLE|DATAFLOW)-VERIFY$/.test(unit.id)&&String(s.blocker??'')==='未提供摘要'&&unit.machine_feedback){
    const routed=routeDiagramVerifyRepair(s,plan,unit,`${unit.last_summary??''}\n${unit.machine_feedback}`.trim());
    if(routed.routed){ savePhaseGraph(project,graph); writeJson(p,s); console.log(`【不完整阻塞收據自動復原】已從 ${unit.id} 的確定性診斷找回實際 visual-check 缺陷，並退回 ${routed.specId}；不需要人工補充。`); return; }
  }
  if(s.phase==='architecture'&&unit?.id==='ARCH-SPEC-FREEZE'&&String(s.blocker??'').startsWith('圖表語意凍結停止')&&s.semantic_freeze_guard?.last_targets?.length){
    const targets=s.semantic_freeze_guard.last_targets.filter(id=>SEMANTIC_SPEC_FILES[id]);
    for(const target of plan.units.filter(item=>targets.includes(item.id))){ target.status='repairing'; target.machine_feedback=`來源：ARCH-SPEC-FREEZE。${unit.last_summary??s.blocker} 請逐項對照核准需求、ARCHITECTURE.md 與 ADR，實際修改結構化 JSON；僅通過格式 validate 不代表完成。`; target.continuations=0; target.no_progress_count=0; delete target.session_id; delete target.completed_at; target.updated_at=now(); }
    resetSemanticFreezeReviewer(unit,'人工解除語意凍結後必須以新 session 重新讀取現行 JSON');
    const fingerprint=s.semantic_freeze_guard.last_artifact_fingerprint; s.semantic_freeze_guard={total:1,best_target_count:targets.length,consecutive_no_progress:0,artifact_failures:fingerprint?{[fingerprint]:1}:{},last_artifact_fingerprint:fingerprint,last_targets:targets,updated_at:now(),recovered_from_false_acceptance:true}; s.semantic_freeze_attempts=1; s.status='repairing'; s.blocker=null; s.next_action=`續接並實際修復 ${targets.join('、')}，完成後再執行語意凍結`; s.resume_after=null; s.updated_at=now(); savePhaseGraph(project,graph); writeJson(p,s); console.log(`【語意修復狀態復原】偵測到舊版格式驗證誤判；已重開 ${targets.join('、')} 並重建熔斷計數，不重做其他已通過成果。`); return;
  }
  if(/repair_targets|修復目標|governance_rules|write_scope/.test(String(s.blocker??''))&&plan){
    const recoverable=['open','reopened','repairing'],store=loadFindings(project),gatePhase=[...new Set(store.findings.filter(item=>recoverable.includes(item.status)&&item.blocking_stage!=='release'&&PHASES[item.gate_phase]?.repair===s.phase).map(item=>item.gate_phase))].at(-1),open=store.findings.filter(item=>item.gate_phase===gatePhase&&item.blocking_stage!=='release'&&recoverable.includes(item.status));
    for(const finding of open){
      const existing=preferDedicatedRepairOwner(plan,finding.repair_targets);
      const inferred=existing.length?existing:preferDedicatedRepairOwner(plan,inferFindingRepairTargets(plan,{...finding,repair_targets:[]}).mapped);
      finding.repair_targets=inferred.length?inferred:finding.repair_targets??[];
    }
    let recoveryConfig={}; try{ recoveryConfig=readJson(path.join(project,'.ai','AUTODEV_CONFIG.json')); }catch{}
    const normalized=normalizeRepairSuggestions(plan,open.flatMap(item=>item.repair_targets??[])),scope=resolveRepairTargets({suggested:normalized.mapped,plan,maxFraction:resolveRepairSafetyPolicy(recoveryConfig).maxFraction});
    if(!scope.empty&&!scope.over_scope){
      const ids=open.filter(item=>(item.repair_targets??[]).some(target=>scope.targets.includes(target))).map(item=>item.id); beginRepair(store,ids); saveFindings(project,store);
      const repairFeedbackByTarget=new Map();
      for(const target of plan.units.filter(item=>scope.targets.includes(item.id))){ const relevant=open.filter(item=>(item.repair_targets??[]).includes(target.id)),feedback=`來源：${gatePhase}。控制器從檔案、修復步驟與驗收條件推導至 ${target.id}。\n${relevant.slice(0,12).map(item=>`${item.id}｜${item.title}\n${(item.repair_plan??[]).slice(0,4).join('\n')}`).join('\n')}`; target.status='repairing'; target.machine_feedback=feedback; target.finding_ids=relevant.map(item=>item.id); target.continuations=0; target.no_progress_count=0; delete target.session_id; delete target.completed_at; target.updated_at=now(); repairFeedbackByTarget.set(target.id,{feedback,finding_ids:target.finding_ids}); }
      if(s.phase==='implementation') { const taskPath=path.join(project,'.ai','TASK_GRAPH.json'),taskGraph=readJson(taskPath); for(const task of taskGraph.tasks??[]) { const repair=repairFeedbackByTarget.get(task.id); if(!repair) continue; task.status='repairing'; task.machine_feedback=repair.feedback; task.finding_ids=repair.finding_ids; task.continuations=0; task.no_progress_count=0; task.updated_at=now(); delete task.session_id; delete task.completed_at; delete task.blocked_reason; } writeJson(taskPath,taskGraph); }
      if(gatePhase) delete graph.phases[gatePhase]; plan.status='in_progress'; plan.updated_at=now(); graph.revision=(graph.revision??0)+1; s.status='repairing'; s.blocker=null; s.active_findings=ids; s.gate_verification_mode='repairing'; s.next_action=`定點修復 ${scope.targets.join('、')}`; s.resume_after=null; s.updated_at=now(); savePhaseGraph(project,graph); writeJson(p,s); console.log(`【Gate 修復目標自動復原】已從 findings 證據推導並重開 ${scope.targets.join('、')}；不重新執行已完成的 ${gatePhase}。`); return;
    }
  }
  s.status='ready'; s.blocker=null; s.resume_after=null; s.updated_at=now(); writeJson(p,s); if(unit?.status==='blocked') { const oldContinuations=unit.continuations??0; unit.status=unit.session_id?'interrupted':'pending'; unit.lifetime_continuations=(unit.lifetime_continuations??0)+oldContinuations; unit.continuations=0; unit.no_progress_count=0; unit.recovered_from_continuation_limit=oldContinuations>0; delete unit.circuit_reason; unit.updated_at=now(); savePhaseGraph(project,graph); if(oldContinuations>0) console.log(`【續跑計數復原】${unit.id} 已開始新的安全續跑輪次；保留既有成果與 Session，不沿用前輪 ${oldContinuations} 次計數。`); }
}
function timer(project, value) {
  if(value&&!backgroundWakeAllowed()){ console.log('【single-shot】保持一般計時器停用；recovery 完成並確認後才由操作者恢復背景續跑。'); return; }
  const name=path.basename(assertProject(project));
  const args=value?['--user','enable','--now',`page-autodev@${name}.timer`]:['--user','disable','--now',`page-autodev@${name}.timer`];
  const r=spawnSync('systemctl',args,{encoding:'utf8'});
  if (r.status!==0) throw new Error(`無法${value?'啟用':'停用'}背景續跑計時器：${r.stderr||r.stdout}`);
}

function normalizedVerificationCommand(command=[]){
  if(command[0]==='docker'&&command[1]==='compose'&&command[2]==='up'&&!command.includes('--force-recreate')) return [...command,'--force-recreate'];
  return command;
}

function runDeclaredVerification(project,workUnit={}){
  const commands=(workUnit.verification??[]).filter(item=>Array.isArray(item)&&item.length&&item.every(value=>typeof value==='string'&&value.length));
  if(!commands.length) return {ok:false,reason:'工作單元沒有可執行的結構化 verification 指令',evidence:[]};
  const evidence=[];
  let composeStarted=false;
  try {
    for(const declaredCommand of commands){
      const command=normalizedVerificationCommand(declaredCommand);
      const [executable,...args]=command;
      if(executable==='docker'&&args[0]==='compose'&&args[1]==='up') composeStarted=true;
      const result=spawnSync(executable,args,{cwd:project,encoding:'utf8',timeout:20*60*1000,maxBuffer:16*1024*1024,env:process.env});
      const label=command.join(' '),output=`${result.stdout??''}\n${result.stderr??''}`.trim();
      if(result.error||result.status!==0){
        const tail=output.split('\n').slice(-40).join('\n');
        return {ok:false,reason:`${label} 失敗（exit ${result.status??'unknown'}）：${result.error?.message??(tail||'無輸出')}`,evidence:[...evidence,`${label}：失敗`],failed_command:command};
      }
      evidence.push(`${label}：通過`);
    }
    return {ok:true,evidence};
  } finally {
    if(composeStarted) spawnSync('docker',['compose','down'],{cwd:project,encoding:'utf8',timeout:5*60*1000,maxBuffer:4*1024*1024,env:process.env});
  }
}

function contradictedBlockedClaim(project,verdict={}){
  const text=[verdict.summary,verdict.blocker,...normalizeStringList(verdict.evidence)].filter(Boolean).join('\n');
  if(!/backend\/Dockerfile[\s\S]*frontend\/Dockerfile[\s\S]*node:20-alpine/i.test(text)||!/(python3|node-gyp)[\s\S]*(make|g\+\+)/i.test(text)) return null;
  const files=['backend/Dockerfile','frontend/Dockerfile'].map(relative=>path.join(project,relative));
  if(!files.every(file=>fs.existsSync(file))) return null;
  const contents=files.map(file=>fs.readFileSync(file,'utf8'));
  const glibc=contents.every(content=>/FROM\s+node:20-(?:bookworm|bullseye)-slim/i.test(content));
  const toolchain=contents.every(content=>/apt-get\s+install[\s\S]*python3[\s\S]*make[\s\S]*g\+\+/i.test(content));
  return glibc&&toolchain?'兩份 Dockerfile 現行內容皆使用 glibc slim 基底，且 build stage 已安裝 python3／make／g++；blocked 收據引用的是過期的 node:20-alpine 前提。':null;
}

function resolveContradictedImplementationBlock(project,task,verdict={}){
  if(!task||verdict.outcome!=='blocked') return {verdict,contradiction:null,verified:null};
  const contradiction=contradictedBlockedClaim(project,verdict);
  if(!contradiction) return {verdict,contradiction:null,verified:null};
  const verified=runDeclaredVerification(project,task);
  if(!verified.ok){
    return {verdict:{...verdict,blocker:`過期阻塞已被 repository 現況駁回，但任務驗證發現真實失敗：${verified.reason}`,evidence:[...normalizeStringList(verdict.evidence),...verified.evidence]},contradiction,verified};
  }
  return {verdict:{...verdict,outcome:'pass',blocker:null,summary:`控制器駁回過期阻塞並完成確定性驗證：${contradiction}`,evidence:[...normalizeStringList(verdict.evidence),...verified.evidence]},contradiction,verified};
}

function workflowSelfTest(){
  const assert=(condition,message)=>{ if(!condition) throw new Error(`工作流自我測試失敗：${message}`); };
  assert(diagramQualityProfile({})==='showcase','未明確設定圖表品質時必須維持 showcase');
  assert(diagramQualityProfile({workflow_efficiency:{architecture_quality_profile:'standard'}})==='standard','專案明確設定時必須允許 standard 密集技術圖');
  assert(diagramQualityProfile({workflow_efficiency:{architecture_quality_profile:'invalid'}})==='showcase','未知品質設定不得降低驗收基準');
  assert(archifyJson({stdout:'{"ok":true}'})?.ok===true&&archifyJson({stderr:'visual-check failed:\n{"ok":false}\n'})?.ok===false&&archifyJson({stdout:'not-json'})===null,'Archify JSON 收據必須從 stdout 或 stderr 安全解析，容許診斷前綴，無效輸出不得誤判');
  const parallelTemp=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-parallel-test-')),dependencyTarget=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-integration-test-'));
  try {
    fs.mkdirSync(path.join(parallelTemp,'.ai'),{recursive:true});
    const liveIdentity=leaseIdentity({project:parallelTemp,inputRevision:1,phase:'implementation',unitId:'LIVE',attempt:0}),liveLease=acquireWorkUnitLease(parallelTemp,liveIdentity,{ttlMs:60000}); let liveBlocked=false; try { acquireWorkUnitLease(parallelTemp,liveIdentity,{ttlMs:60000}); } catch(error){ liveBlocked=error.code===CONCURRENCY_CODES.lease&&String(error.message).includes('存活'); } assert(liveBlocked,'存活 controller 持有租約時必須 fail-closed 阻擋第二寫入者'); liveLease.release();
    const deadPid=2147483000,staleIdentity=leaseIdentity({project:parallelTemp,inputRevision:1,phase:'implementation',unitId:'STALE',attempt:0}); acquireWorkUnitLease(parallelTemp,staleIdentity,{ttlMs:2*60*60*1000,controllerPid:deadPid}); const reclaimed=acquireWorkUnitLease(parallelTemp,staleIdentity,{ttlMs:60000}); assert(reclaimed.metadata.controller_pid===process.pid,'controller 與 worker 都死亡時必須立即回收未過期殘留租約'); reclaimed.release();
    const workerIdentity=leaseIdentity({project:parallelTemp,inputRevision:1,phase:'implementation',unitId:'ORPHAN-WORKER',attempt:0}),workerLease=acquireWorkUnitLease(parallelTemp,workerIdentity,{ttlMs:60000,controllerPid:deadPid}); workerLease.setWorker(process.pid); let workerBlocked=false; try { acquireWorkUnitLease(parallelTemp,workerIdentity,{ttlMs:60000}); } catch(error){ workerBlocked=error.code===CONCURRENCY_CODES.lease&&String(error.message).includes('worker PID'); } assert(workerBlocked,'controller 已死但 worker 仍存活時必須阻擋租約回收，避免真正的多寫入者'); workerLease.release();
    fs.mkdirSync(path.join(parallelTemp,'node_modules')); fs.mkdirSync(path.join(parallelTemp,'backend','node_modules'),{recursive:true}); const links=linkProjectDependencies(parallelTemp,dependencyTarget); assert(links.includes('node_modules')&&links.includes('backend/node_modules')&&fs.statSync(path.join(dependencyTarget,'backend','node_modules')).isDirectory(),'整合 worktree 必須共用主專案與 workspace 已鎖定的 node_modules，避免尚未啟動測試即失敗'); for(const args of [['init'],['config','user.email','autodev-self-test@example.invalid'],['config','user.name','Autodev Self Test'],['commit','--allow-empty','-m','fixture']]) { const result=spawnSync('git',args,{cwd:parallelTemp,encoding:'utf8'}); assert(result.status===0,`Git 測試夾具初始化失敗：${result.stderr||result.stdout}`); } fs.mkdirSync(path.join(parallelTemp,'.ai'),{recursive:true}); fs.writeFileSync(path.join(parallelTemp,'.ai','PROJECT_STATE.json'),'{"status":"running"}\n'); assert(meaningfulProjectChanges(parallelTemp).length===0,'整合快轉前必須忽略控制器自身 runtime 狀態檔，不可誤判為使用者程式碼變更'); fs.writeFileSync(path.join(parallelTemp,'unexpected.ts'),'change\n'); assert(meaningfulProjectChanges(parallelTemp)[0]==='unexpected.ts','整合快轉前仍必須阻擋真正的未提交專案變更');
    fs.mkdirSync(path.join(parallelTemp,'frontend'),{recursive:true}); for(const relative of ['backend/Dockerfile','frontend/Dockerfile']) fs.writeFileSync(path.join(parallelTemp,relative),'FROM node:20-bookworm-slim AS build\nRUN apt-get update && apt-get install -y python3 make g++\n'); const staleDockerVerdict={outcome:'blocked',summary:'backend/Dockerfile 與 frontend/Dockerfile 以 node:20-alpine 執行 npm ci，argon2 需 node-gyp 就地編譯而基底缺 python3／make／g++'}; assert(Boolean(contradictedBlockedClaim(parallelTemp,staleDockerVerdict)),'目前 Dockerfile 已具 glibc 與 node-gyp 工具鏈時，控制器必須駁回 node:20-alpine 過期阻塞'); fs.writeFileSync(path.join(parallelTemp,'frontend/Dockerfile'),'FROM node:20-alpine\n'); assert(contradictedBlockedClaim(parallelTemp,staleDockerVerdict)===null,'任一 Dockerfile 仍為 alpine 時不得誤判阻塞已解決');
    const deterministicPass=runDeclaredVerification(parallelTemp,{verification:[[process.execPath,'-e','process.exit(0)']]}); assert(deterministicPass.ok&&deterministicPass.evidence.length===1,'重複矛盾阻塞的結構化 verification 全通過時必須可由控制器確定性收斂'); const deterministicFail=runDeclaredVerification(parallelTemp,{verification:[[process.execPath,'-e','process.stderr.write("REAL_FAILURE\\n");process.exit(7)']]}); assert(!deterministicFail.ok&&deterministicFail.reason.includes('REAL_FAILURE')&&deterministicFail.reason.includes('exit 7'),'確定性 verification 失敗時必須回報第一個真實命令錯誤，不得沿用被證偽的 Agent 阻塞'); assert(normalizedVerificationCommand(['docker','compose','up','-d','--wait']).includes('--force-recreate'),'確定性 Compose 驗證必須重建服務，避免新 migration 與舊 API 容器造成啟動順序假失敗'); assert(normalizedVerificationCommand(['docker','compose','config']).length===3,'非啟動型 Compose 驗證不得被改寫');
    fs.writeFileSync(path.join(parallelTemp,'frontend/Dockerfile'),'FROM node:20-bookworm-slim AS build\nRUN apt-get update && apt-get install -y python3 make g++\n'); const serialStaleResolved=resolveContradictedImplementationBlock(parallelTemp,{id:'INT-E2E-001',verification:[[process.execPath,'-e','process.exit(0)']]},staleDockerVerdict); assert(serialStaleResolved.verdict.outcome==='pass'&&serialStaleResolved.verified.ok&&serialStaleResolved.verdict.blocker===null,'串行 implementation 任務遇到已被修復的舊阻塞時，必須以宣告驗證自動收斂，不可再次要求操作者'); const parallelStaleFailed=resolveContradictedImplementationBlock(parallelTemp,{id:'INT-E2E-FAIL',verification:[[process.execPath,'-e','process.stderr.write("ACTUAL_IMPLEMENTATION_FAILURE\\n");process.exit(8)']]},staleDockerVerdict); assert(parallelStaleFailed.verdict.outcome==='blocked'&&!parallelStaleFailed.verified.ok&&parallelStaleFailed.verdict.blocker.includes('ACTUAL_IMPLEMENTATION_FAILURE'),'併行 implementation 任務的舊阻塞被駁回後，真實驗證失敗仍必須 fail-closed 並回報實際原因');
    assert(parallelConcurrency({},'read')===4&&parallelConcurrency({},'write')===3,'全域預設必須為唯讀 4、寫入 3'); assert(parallelConcurrency({read_only_max_concurrency:99,write_max_concurrency:99},'read')===6&&parallelConcurrency({read_only_max_concurrency:99,write_max_concurrency:99},'write')===4,'異常大的專案設定仍須受全域安全上限保護'); assert(parallelConcurrency({max_concurrency:2},'read')===4&&parallelConcurrency({max_concurrency:2},'write')===3,'舊版自動產生的 max_concurrency=2 必須自動遷移為新全域預設'); assert(parallelConcurrency({max_concurrency:2,preserve_legacy_max_concurrency:true},'read')===2,'明確要求保留舊上限的專案仍須受到尊重');
    const doneIds=new Set(['BASE']); const safeTask={id:'FE-A',status:'ready',risk:'low',parallel_policy:'isolated',depends_on:['BASE'],write_scope:['frontend/src/a.ts'],verification:[['npm','run','test']]}; assert(explainParallelEligibility(safeTask,doneIds,[]).length===0,'低風險、範圍隔離且驗證安全的任務必須可併行'); assert(explainParallelEligibility({...safeTask,id:'SEC-A',risk:'high'},doneIds,[]).some(reason=>reason.includes('序列')),'高風險任務必須保留序列品質邊界'); assert(explainParallelEligibility({...safeTask,id:'INFRA-A',write_scope:['docker-compose.yml']},doneIds,[]).some(reason=>reason.includes('受保護')),'共用基礎設施檔案不得寫入併行'); assert(explainParallelEligibility({...safeTask,id:'FE-B',write_scope:['frontend/src/a.ts']},doneIds,[safeTask]).some(reason=>reason.includes('重疊')),'write_scope 衝突必須在派發前被診斷');
    const uniqueCommands=deduplicateVerification([{verification:[['npm','run','test'],['npm','run','build']]},{verification:[['npm','run','test'],['npm','run','lint']]}]); assert(uniqueCommands.length===3&&JSON.stringify(uniqueCommands[0])===JSON.stringify(['npm','run','test']),'整合驗證必須去除跨 Worker 重複命令，同時保留所有不同檢查');
    const verifyFixture=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-batch-verify-')); try { fs.writeFileSync(path.join(verifyFixture,'package.json'),JSON.stringify({scripts:{test:'node -e "process.exit(0)"',build:'node -e "process.exit(0)"',lint:'node -e "process.stderr.write(\'EXPECTED_DEATH_TEST\\n\');process.exit(9)"'}})); const passReceipt=verifyIntegrationBatch(verifyFixture,[{verification:[['npm','run','test']]},{verification:[['npm','run','test'],['npm','run','build']]}]); assert(passReceipt.ok&&passReceipt.receipts.length===2,'整批驗證正常路徑必須去重後成功執行'); const failReceipt=verifyIntegrationBatch(verifyFixture,[{verification:[['npm','run','test'],['npm','run','lint']]}]); assert(!failReceipt.ok&&failReceipt.receipts.at(-1).output.includes('EXPECTED_DEATH_TEST'),'整批驗證死亡測試必須 fail-closed 並保留真實失敗輸出'); } finally { fs.rmSync(verifyFixture,{recursive:true,force:true}); }
  } finally { fs.rmSync(parallelTemp,{recursive:true,force:true}); fs.rmSync(dependencyTarget,{recursive:true,force:true}); }
  const repairOwnerPlan={units:[{id:'INFRA-001',write_scope:['docker-compose.yml']},{id:'BE-WIRE-001',write_scope:['backend/src/app.module.ts']},{id:'IMPL-GATE-REPAIR-001',write_scope:['ops/smoke-test.sh']}]};
  assert(JSON.stringify(preferDedicatedRepairOwner(repairOwnerPlan,['INFRA-001','IMPL-GATE-REPAIR-001','BE-WIRE-001']))===JSON.stringify(['IMPL-GATE-REPAIR-001']),'已有專用 Gate repair task 時，不得重新開啟原始已完成任務');
  assert(JSON.stringify(preferDedicatedRepairOwner(repairOwnerPlan,['INFRA-001']))===JSON.stringify(['IMPL-GATE-REPAIR-001'])&&repairOwnerPlan.units.at(-1).write_scope.includes('docker-compose.yml'),'專用 Gate repair task 必須承接原始修復所有者的明確 write_scope，不可重開原始任務');
  const noRepairOwnerPlan={units:[{id:'INFRA-001',write_scope:['docker-compose.yml']}]}; assert(JSON.stringify(preferDedicatedRepairOwner(noRepairOwnerPlan,['INFRA-001']))===JSON.stringify(['INFRA-001']),'沒有專用 Gate repair task 時，必須保留原始修復所有者');
  assert(JSON.stringify(normalizeStringList('單一驗收條件'))===JSON.stringify(['單一驗收條件']),'Gate 單一字串 acceptance_check 必須正規化為陣列');
  assert(JSON.stringify(normalizeStringList(['條件一',['條件二'],null]))===JSON.stringify(['條件一','條件二']),'Gate 巢狀或空白驗收條件必須安全正規化');
  const ids=STATIC_WORK_UNITS.architecture.map(unit=>unit.id),freezeAt=ids.indexOf('ARCH-SPEC-FREEZE'),specs=ids.filter(id=>id.endsWith('-SPEC')),builds=ids.filter(id=>id.endsWith('-BUILD'));
  const architectureRepairPlan={units:STATIC_WORK_UNITS.architecture.map(unit=>({id:unit.id}))},collapsedDiagramTargets=normalizeRepairSuggestions(architectureRepairPlan,['ARCH-FOUNDATION','ARCH-SYSTEM-SPEC','ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY','ARCH-DATAFLOW-SPEC','ARCH-DATAFLOW-BUILD','ARCH-DATAFLOW-VERIFY']);
  assert(JSON.stringify(collapsedDiagramTargets.mapped)===JSON.stringify(['ARCH-FOUNDATION','ARCH-SYSTEM-SPEC','ARCH-DATAFLOW-SPEC']),'圖表 SPEC 被修復時，BUILD／VERIFY 必須視為衍生單元，不可重複占用 Gate 修復安全額度');
  const crossFindingTargets=normalizeRepairSuggestions(architectureRepairPlan,['ARCH-LIFECYCLE-SPEC','ARCH-FOUNDATION','ARCH-SYSTEM-SPEC','ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY','ARCH-SYSTEM-VERIFY','ARCH-LIFECYCLE-VERIFY','ARCH-LIFECYCLE-BUILD','ARCH-SYSTEM-BUILD']);
  assert(JSON.stringify(crossFindingTargets.mapped)===JSON.stringify(['ARCH-LIFECYCLE-SPEC','ARCH-FOUNDATION','ARCH-SYSTEM-SPEC','ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY']),'跨 finding 最終聚合後仍須折疊 SPEC 的衍生單元，未含 SPEC 的 WORKFLOW BUILD／VERIFY 必須保留');
  assert(freezeAt>Math.max(...specs.map(id=>ids.indexOf(id))),'語意凍結必須位於全部圖表 SPEC 之後'); assert(freezeAt<Math.min(...builds.map(id=>ids.indexOf(id))),'語意凍結必須位於全部 BUILD 之前');
  assert(!ids.includes('ARCH-CONTEXT'),'架構 Context 不可在 Gate 前同步'); assert(STATIC_WORK_UNITS.specification[0]?.id==='SPEC-ARCH-CONTEXT','架構 Context 必須在 Architecture Gate 後同步'); assert(STATIC_WORK_UNITS.planning[0]?.id==='PLAN-SPEC-CONTEXT','規格 Context 必須在 Specification Gate 後同步');
  assert(PHASES.qa.next==='release_gate'&&PHASES.release_gate.next==='complete','Release Gate 必須位於 QA 後、完成前'); assert(Object.values(PROGRESS_WEIGHTS).reduce((sum,value)=>sum+value,0)===100,'進度權重總和必須為 100'); assert(DEFAULT_MODEL_ROUTING.architecture.model==='sonnet'&&DEFAULT_MODEL_ROUTING.architecture_gate.model==='opus','模型路由必須為 Sonnet 生產、Opus 架構 Gate');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-self-test-'));
  try{
    fs.mkdirSync(path.join(temp,'.ai')); fs.writeFileSync(path.join(temp,'README.md'),'smoke\n'); fs.writeFileSync(path.join(temp,'.ai','PROJECT_STATE.json'),'{}\n'); spawnSync('git',['init','-q'],{cwd:temp}); spawnSync('git',['config','user.name','Self Test'],{cwd:temp}); spawnSync('git',['config','user.email','self-test@example.invalid'],{cwd:temp}); spawnSync('git',['add','-A'],{cwd:temp}); spawnSync('git',['commit','-qm','initial'],{cwd:temp});
    const count=()=>Number(spawnSync('git',['rev-list','--count','HEAD'],{cwd:temp,encoding:'utf8'}).stdout.trim()); const before=count(); fs.writeFileSync(path.join(temp,'.ai','PROJECT_STATE.json'),'{"status":"running"}\n'); gitCheckpoint(temp,{auto_checkpoint_commits:true},'只有狀態'); assert(count()===before,'僅 runtime state 不可建立 commit'); fs.writeFileSync(path.join(temp,'README.md'),'smoke changed\n'); gitCheckpoint(temp,{auto_checkpoint_commits:true},'實質內容'); assert(count()===before+1,'實質內容必須建立 checkpoint');
    const decisions=path.join(temp,'docs','decisions'); fs.mkdirSync(decisions,{recursive:true}); fs.writeFileSync(path.join(decisions,'0001-draft.md'),'# ADR\n\n**Status:** draft\n**Gate-Eligible:** true\n**Approval-Scope:** technical\n**ADR-Admission:** security\n'); fs.writeFileSync(path.join(decisions,'0002-unreviewed.md'),'# ADR\n\n**Status:** draft\n**Gate-Eligible:** true\n**Approval-Scope:** technical\n'); fs.writeFileSync(path.join(decisions,'0003-proposed.md'),'# ADR\n\n**Status:** proposed\n'); assert(promoteDraftAdrs(temp,{evidence:['docs/decisions/0001-draft.md 已審查']})===0,'AF：free-text evidence 不再具 ADR promotion authority，即使提及檔名也不得核准'); assert(fs.readFileSync(path.join(decisions,'0001-draft.md'),'utf8').includes('draft'),'AF：未經 structured reviewed_adr_paths 點名者必須維持 draft'); assert(promoteDraftAdrs(temp,{},['0001-draft.md'])===1,'AF：structured reviewed_adr_paths 是唯一 promotion authority'); assert(fs.readFileSync(path.join(decisions,'0001-draft.md'),'utf8').includes('accepted'),'被 structured 點名且通過准入的 draft ADR 應轉 accepted'); assert(fs.readFileSync(path.join(decisions,'0002-unreviewed.md'),'utf8').includes('draft'),'未具准入分類或未點名的 draft ADR 必須受保護'); assert(fs.readFileSync(path.join(decisions,'0003-proposed.md'),'utf8').includes('proposed'),'proposed 商業決策不得自動核准');
    const releaseVerdict=deferReleaseFindings(temp,{outcome:'failed',gate_decision:'fail',summary:'部署參數待補',blocker:null,evidence:[],findings:[{severity:'medium',blocking_stage:'release',category:'backup_destination',title:'異地目的地',summary:'尚未指定',repair_targets:[],acceptance_check:['提供目的地']}]},'architecture_gate'); assert(releaseVerdict.outcome==='pass','白名單 Release risk 不得阻塞開發'); assert(readJson(path.join(temp,'.ai','RELEASE_RISKS.json')).risks.length===1,'Release risk 必須被保存');
    const unsafe=deferReleaseFindings(temp,{outcome:'failed',gate_decision:'fail',summary:'權限缺口',blocker:null,evidence:[],findings:[{severity:'medium',blocking_stage:'release',category:'deployment_capacity',title:'管理員權限繞過',summary:'RBAC 未限制',repair_targets:['ARCH-FOUNDATION'],acceptance_check:['驗證權限']}]},'architecture_gate'); assert(unsafe.findings[0].blocking_stage==='development'&&unsafe.outcome==='failed','安全／權限問題必須強制阻塞開發');
    const architecture=path.join(temp,'docs','architecture'); fs.mkdirSync(architecture,{recursive:true}); fs.writeFileSync(path.join(architecture,'ARCHITECTURE.md'),'# Architecture\n\n修訂沿革：回合紀錄\n\n## Context and constraints\n\n有效正文\n'); const preview=slimMarkdownDocuments(temp); assert(preview[0]?.removed_bytes>0&&!fs.existsSync(path.join(temp,'.ai','archive')),'預覽不可修改或建立封存'); slimMarkdownDocuments(temp,{apply:true}); assert(!fs.readFileSync(path.join(architecture,'ARCHITECTURE.md'),'utf8').includes('修訂沿革'),'套用後應移除回合歷程'); assert(fs.existsSync(path.join(temp,'.ai','archive','document-slim')),'移除內容必須可回復封存');
    const diagrams=path.join(architecture,'diagrams'); fs.mkdirSync(diagrams,{recursive:true}); const dataflow=path.join(diagrams,'data-trust-boundary.dataflow.json'),workflow=path.join(diagrams,'work-order-flow.workflow.json'); fs.writeFileSync(dataflow,'{"revision":1}\n'); fs.writeFileSync(workflow,'{"revision":1}\n'); const freezeState={}; const freezeConfig={semantic_freeze:{max_total_attempts:6,max_same_artifact_failures:2,max_consecutive_no_progress:2}}; const first=registerSemanticFreezeFailure(temp,freezeState,['ARCH-DATAFLOW-SPEC','ARCH-WORKFLOW-SPEC'],freezeConfig); assert(!first.blocked&&first.progressed,'首次凍結失敗應允許定點修復'); fs.writeFileSync(dataflow,'{"revision":2}\n'); const improved=registerSemanticFreezeFailure(temp,freezeState,['ARCH-DATAFLOW-SPEC','ARCH-WORKFLOW-SPEC'],freezeConfig); assert(!improved.blocked&&improved.progressed&&improved.artifactChanged,'規格內容變更應視為進展，不可因固定兩輪提早熔斷'); const unchanged=registerSemanticFreezeFailure(temp,freezeState,['ARCH-DATAFLOW-SPEC','ARCH-WORKFLOW-SPEC'],freezeConfig); assert(unchanged.blocked&&!unchanged.progressed&&unchanged.same===2,'相同規格內容再次失敗才應熔斷');
    const staleFreezeUnit={status:'failed',session_id:'stale-review-session',continuations:2,no_progress_count:1,completed_at:now()}; resetSemanticFreezeReviewer(staleFreezeUnit,'上游規格已修訂'); assert(staleFreezeUnit.status==='pending'&&!staleFreezeUnit.session_id&&staleFreezeUnit.continuations===0&&staleFreezeUnit.lifetime_continuations===2,'上游圖表修訂後必須丟棄舊語意審查 session，避免沿用過期證據');
    const aliasedBlocked=parseResult(JSON.stringify({result:'```json\n{"outcome":"blocked","rootCause":{"summary":"視窗溢位"},"blockedReason":"需退回圖表規格","checksPerformed":[{"check":"visual-check","result":"fail"}]}\n```'})); assert(aliasedBlocked.summary==='視窗溢位'&&aliasedBlocked.blocker==='需退回圖表規格'&&aliasedBlocked.evidence[0].includes('visual-check'),'非標準但可辨識的完整 blocked 收據不得退化為「未提供摘要」');
    const verifyPlan={status:'complete',units:['ARCH-WORKFLOW-SPEC','ARCH-SPEC-FREEZE','ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY'].map(id=>({id,status:'complete',session_id:`session-${id}`,continuations:1,completed_at:now()}))},verifyState={status:'blocked',architecture_spec_frozen_at:now()}; const verifyUnit=verifyPlan.units.at(-1),routedVisual=routeDiagramVerifyRepair(verifyState,verifyPlan,verifyUnit,'1440x900 viewer/viewport-overflow'); assert(routedVisual.routed&&verifyPlan.units[0].status==='repairing'&&verifyPlan.units[1].status==='pending'&&!verifyPlan.units[1].session_id&&verifyPlan.units[2].status==='pending'&&verifyUnit.status==='pending'&&!verifyState.architecture_spec_frozen_at,'圖表 VERIFY 的可修復 visual-check 缺陷必須自動退回 SPEC，並重新執行語意凍結與產生流程');
    const schema=JSON.parse(RESULT_SCHEMA),findingSchema=schema.properties.findings.items; assert(findingSchema.required.includes('repair_plan')&&findingSchema.properties.repair_plan.minItems===1,'Gate finding 必須強制提供非空 repair_plan'); assert(schema.properties.summary.maxLength===1200&&schema.properties.evidence.maxItems===8,'結構化輸出必須限制摘要與證據數量，原始 stdout 仍由日誌保存'); const aliasReceipt=parseResult(JSON.stringify({result:'```json\n{"outcome":"blocked","blocking_reason":"需要最小布局重排","root_cause":"目前走廊封閉"}\n```'})); assert(aliasReceipt.summary==='目前走廊封閉'&&aliasReceipt.blocker==='需要最小布局重排','blocking_reason/root_cause 別名必須正規化，不可顯示「未提供摘要」或誤報缺少產品資訊'); const normalizedReflection=validateReflection({root_cause:'局部修補未同步跨文件引用',new_strategy:'改採權威規則至測試案例的端到端同步',difference_from_previous:'新增反向搜尋舊矛盾字串歸零的驗證步驟',files_to_change:'docs/specs/DATA_API.md',verification:'grep 舊矛盾字串應為零筆'},null); assert(normalizedReflection.ok&&Array.isArray(normalizedReflection.reflection.verification)&&Array.isArray(normalizedReflection.reflection.files_to_change),'策略反思的單一文字驗證證據與檔案必須安全正規化為陣列，不可誤判為欄位缺漏'); const misplaced=normalizeStrategyReceipt({strategy_reflection:{root_cause:'原因',new_strategy:'新策略',difference_from_previous:'差異'},files_to_change:['docs/specs/SECURITY_TEST.md'],verification:['驗證命令']}); const misplacedCheck=validateReflection(misplaced.strategy_reflection,null); assert(misplacedCheck.ok&&misplacedCheck.reflection.verification.length===1,'誤置於最外層的策略反思陣列必須自動歸位，不可要求人工介入');
    const planningTargets=normalizeRepairSuggestions({units:STATIC_WORK_UNITS.planning},['.ai/TASK_GRAPH.json（SEC-EDGE-001.verification）','docs/IMPLEMENTATION_PLAN.md 第 6 節']); assert(planningTargets.mapped.length===1&&planningTargets.mapped[0]==='PLAN-TASKS','計畫 Gate 的檔案與開發任務 ID 必須映射回 PLAN-TASKS，不可誤判為無修復目標');
    const atomicSpecPlan={units:STATIC_WORK_UNITS.specification.map(unit=>({id:unit.id}))},baseAtomic=resolveRepairTargets({suggested:['SPEC-DATA-API','SPEC-SECURITY-TEST','SPEC-BEHAVIOR'],plan:atomicSpecPlan,maxFraction:0.4}),allowedAtomic=atomicRepairScope(atomicSpecPlan,[{id:'GF-ATOMIC',repair_targets:['SPEC-DATA-API','SPEC-SECURITY-TEST','SPEC-BEHAVIOR']}],baseAtomic,3),unownedAtomic=atomicRepairScope(atomicSpecPlan,[{id:'GF-SPLIT-A',repair_targets:['SPEC-DATA-API','SPEC-SECURITY-TEST']},{id:'GF-SPLIT-B',repair_targets:['SPEC-BEHAVIOR']}],baseAtomic,3); assert(baseAtomic.over_scope&&allowedAtomic.atomic_group&&!allowedAtomic.over_scope&&allowedAtomic.base_limit===2,'單一跨文件 finding 明確涵蓋三個規格單元時，必須以最多三個的原子群組受控放行'); assert(unownedAtomic.over_scope&&!unownedAtomic.atomic_group,'多個無關 findings 合併超限時不可冒充原子群組放寬安全範圍');
    const requirementPlan={units:STATIC_WORK_UNITS.requirements.map(unit=>({id:unit.id}))},requirementTargets=inferFindingRepairTargets(requirementPlan,{repair_targets:[],repair_plan:['更新 docs/requirements/REQUIREMENTS.md 的 Scope 與 Open question 11','修改 docs/PRD.md 的角色資料範圍並標記 ADR 來源'],summary:'需求與 PRD 權限規則不一致'}); assert(requirementTargets.mapped.includes('REQ-ANALYZE')&&requirementTargets.mapped.includes('REQ-PRD'),'需求 Gate 未提供 repair_targets 時，必須由 repair_plan 的 REQUIREMENTS.md 與 PRD.md 推導工作單元');
    const contextOnly=inferFindingRepairTargets(requirementPlan,{repair_targets:[],repair_plan:['更新 docs/context/PROJECT_CONTEXT.md 的需求摘要']}); assert(contextOnly.mapped.length===0,'需求 Gate 不得把 Gate 通過後才同步的衍生 Context 映射為需求修復工作單元');
    const ownershipMatrix=[
      [STATIC_WORK_UNITS.requirements,'新增需求檔 docs/requirements/REQUIREMENTS.md','REQ-ANALYZE'],
      [STATIC_WORK_UNITS.architecture,'修改 docs/decisions/0099-new-boundary.md','ARCH-ADR'],
      [STATIC_WORK_UNITS.specification,'修正 docs/specs/SECURITY_TEST.md','SPEC-SECURITY-TEST'],
      [STATIC_WORK_UNITS.planning,'更新 .ai/TASK_GRAPH.json','PLAN-TASKS']
    ]; for(const [units,suggestion,expected] of ownershipMatrix){ const result=normalizeRepairSuggestions({units},[suggestion]); assert(result.mapped.includes(expected),`工作單元宣告的檔案所有權必須自動映射至 ${expected}`); }
    const dynamicOwner=normalizeRepairSuggestions({units:[{id:'BE-ONLY',write_scope:['backend/src/new-module.ts']},{id:'FE-OTHER',write_scope:['frontend/src/app.tsx']}]},['backend/src/new-module.ts:42']); assert(dynamicOwner.mapped.length===1&&dynamicOwner.mapped[0]==='BE-ONLY','實作工作單元必須依 write_scope 自動歸屬新檔案');
    const singleOwner=normalizeRepairSuggestions({units:[{id:'ONLY-REPAIR',repair_keywords:[]}]},['全新且尚未建規則的 artifact 類型']); assert(singleOwner.mapped[0]==='ONLY-REPAIR','只有一個安全候選時應自動歸屬，不要求人工修改 repair_targets');
    const ambiguous=normalizeRepairSuggestions({units:[{id:'ONE'},{id:'TWO'}]},['全新且多義的 artifact 類型']); assert(ambiguous.mapped.length===0,'多個候選且無所有權證據時仍須停止，不可猜測修復目標');
    const smallPhaseScope=resolveRepairTargets({suggested:['REQ-ANALYZE','REQ-PRD'],plan:{units:STATIC_WORK_UNITS.requirements},maxFraction:0.4}); assert(smallPhaseScope.limit===2&&!smallPhaseScope.over_scope,'只有兩個緊密耦合權威文件的需求階段，必須允許兩個工作單元共同修復');
    const boundedSpecScope=resolveRepairTargets({suggested:['SPEC-BEHAVIOR','SPEC-DATA-API','SPEC-SECURITY-TEST'],plan:{units:STATIC_WORK_UNITS.specification},maxFraction:0.4}); assert(boundedSpecScope.limit===2&&boundedSpecScope.over_scope,'小型階段最低允許兩個目標，但三個以上仍須受安全上限阻擋');
    fs.writeFileSync(path.join(temp,'.ai','TASK_GRAPH.json'),JSON.stringify({tasks:[{id:'BE-001',status:'done',title:'後端',write_scope:['backend/src/app.ts']},{id:'FE-001',status:'ready',title:'前端',write_scope:['frontend/src/main.tsx'],depends_on:['BE-001']},{id:'QA-001',status:'blocked',title:'整合',write_scope:['ops/smoke-test.sh'],depends_on:['FE-001']}]})); assert(productProgress(temp,{phase:'implementation',status:'running'})===27,'產品完成度必須依實際交付任務計算，不可因前置流程完成而虛增'); assert(nextReadyTask(temp)?.id==='FE-001','done 必須視為已完成相依，且不可再次派發已完成任務'); const implementationUnits=buildWorkUnits(temp,'implementation'); assert(implementationUnits.length===3&&normalizeRepairSuggestions({units:implementationUnits},['frontend/src/main.tsx']).mapped[0]==='FE-001','Implementation Gate 修復必須以 TASK_GRAPH write_scope 建立可映射候選，不可產生空計畫');
    const composeFixture={services:{db:{environment:{POSTGRES_USER:'migration_owner',RUNTIME_DB_USER:'app_runtime',BACKUP_DB_USER:'app_backup'}},migrate:{environment:{MIGRATION_DATABASE_URL:'postgresql://migration_owner:x@db:5432/app'}},api:{environment:{RUNTIME_DATABASE_URL:'postgresql://app_runtime:x@db:5432/app'}},backupjob:{environment:{BACKUP_DATABASE_URL:'postgresql://app_backup:x@db:5432/app'}}}}; assert(validateComposeDatabaseBoundary(composeFixture).ok,'部署預檢必須接受容器內 db:5432 與一致角色'); const drift=structuredClone(composeFixture); drift.services.migrate.environment.MIGRATION_DATABASE_URL='postgresql://wrong:x@127.0.0.1:55432/app'; const driftResult=validateComposeDatabaseBoundary(drift); assert(!driftResult.ok&&driftResult.issues.some(issue=>issue.includes('db:5432'))&&driftResult.issues.some(issue=>issue.includes('不一致')),'部署預檢必須在啟動 Agent 前同時攔截 host 位址與角色漂移'); assert(deploymentPreflightNeeded({id:'INT-E2E-001',verification:[['docker','compose','up']]}),'端對端 Compose 任務必須自動啟用部署預檢'); assert(!deploymentPreflightNeeded({id:'FE-BUTTON-001',write_scope:['frontend/src/button.tsx']}),'一般功能任務不得執行昂貴的部署預檢');
    fs.writeFileSync(path.join(temp,'.ai','TASK_GRAPH.json'),JSON.stringify({tasks:[{id:'BE-001',status:'completed'},{id:'FE-001',status:'passed'}]})); assert(taskGraphDone(temp),'complete、completed、done、passed 必須統一視為完成狀態');
    const ponytailConfig={complexity_control:{enabled:true,rollout:'shadow',default_mode:'full',high_risk_mode:'lite',allow_ultra:false,review:{strategy:'conditional',file_threshold:5,added_lines_threshold:150}}};
    const ordinaryPolicy=selectComplexityPolicy({id:'FE-002',title:'新增原生日期欄位',risk:'low',write_scope:['src/date.tsx']},ponytailConfig); assert(ordinaryPolicy.mode==='full'&&ordinaryPolicy.rollout==='shadow','一般開發任務必須採 full shadow，不可影響 Gate');
    const protectedPolicy=selectComplexityPolicy({id:'BE-SEC-001',title:'RBAC 權限與稽核',risk:'high',write_scope:['src/auth.ts']},ponytailConfig); assert(protectedPolicy.mode==='lite'&&protectedPolicy.protected_complexity.some(item=>item.includes('資料完整性')),'高風險任務必須降為 lite 並保護必要複雜度');
    const noUltra=selectComplexityPolicy({id:'FE-003',title:'正式產品元件',risk:'low',complexity_policy:'ultra'},ponytailConfig); assert(noUltra.mode==='full','未明確允許時 production 任務不得自動啟用 ultra');
    const shadowReceipt=normalizeComplexityReceipt({review_performed:true,applied:true,simplifications:['刪除多餘 wrapper']},ordinaryPolicy,{triggers:['實際新增 180 行']}); assert(shadowReceipt.applied===false&&shadowReceipt.simplifications.length===1,'shadow pilot 只能記錄建議，不得宣稱已自動套用');
    assert(ordinaryPolicy.max_review_rounds===1&&complexityInstruction(ordinaryPolicy).includes('shadow pilot'),'Ponytail shadow pilot 必須只記錄一次審查，不得形成新的 Token 循環');
    const budget=adaptiveTurnBudget(temp,'architecture',{unit:{max_turns:10,machine_feedback:'修復診斷'},continuations:1},{turn_budget:{continuation_increment:4,maximum:32}}); assert(budget.turns===18,'動態 turns 必須同時納入修復複雜度與續跑次數');
    const gateUnit={id:'ARCH-GATE-TRACE',prompt:'唯讀一致性審查'}; saveGateCachePass(temp,'architecture_gate',gateUnit,{summary:'通過',evidence:['docs/architecture/ARCHITECTURE.md']}); assert(gateCacheProbe(temp,'architecture_gate',gateUnit).hit,'來源、規則與 Prompt 均未變更時 Gate hash 必須快速通過'); fs.appendFileSync(path.join(architecture,'ARCHITECTURE.md'),'\n新增架構決策\n'); const cacheMiss=gateCacheProbe(temp,'architecture_gate',gateUnit); assert(!cacheMiss.hit&&cacheMiss.changed.includes('docs/architecture/ARCHITECTURE.md'),'權威來源改變時 Gate cache 必須失效並提供差異檔案');
    const cheapRoute=applyGateRouteEfficiency(temp,'architecture_gate',{gate_verification_mode:'targeted'},gateUnit,{model:'opus',finding_context:'GF-TEST｜一般映射修正'},{gate_efficiency:{targeted_review_model:'sonnet'}}); assert(cheapRoute.model==='sonnet','低風險定點複驗應使用 Sonnet'); const safeRoute=applyGateRouteEfficiency(temp,'architecture_gate',{gate_verification_mode:'targeted'},gateUnit,{model:'opus',finding_context:'GF-SEC｜權限安全缺陷'},{gate_efficiency:{targeted_review_model:'sonnet'}}); assert(safeRoute.model==='opus','安全與權限 finding 的定點複驗仍須使用 Opus');
    const planned=upsertGateFindings(temp,{gatePhase:'architecture_gate',unitId:'ARCH-GATE-TRACE',inputRevision:1,verdict:{summary:'映射錯誤',repair_targets:['ARCH-FOUNDATION'],findings:[{severity:'major',blocking_stage:'development',title:'需求映射錯誤',summary:'架構引用錯誤驗收條件',repair_targets:['ARCH-FOUNDATION'],repair_plan:['核對 REQUIREMENTS.md 與 ARCHITECTURE.md 的節點映射並修正錯誤引用'],acceptance_check:['兩份文件的驗收條件編號一致']}]}}); assert(planned.touched[0].repair_plan.length===1,'修復計畫必須寫入 Gate finding 並可傳遞至下一輪');
    const oldFinding={...planned.touched[0],id:'GF-OLD-REVISION',fingerprint:'old-revision',input_revision:0,status:'open'}; planned.store.findings.push(oldFinding); const settled=finalizeGateFindings(planned.store,{gatePhase:'architecture_gate',inputRevision:1}); assert(settled.closed===1&&settled.stale===1,'最終 Gate 必須結案同 revision findings 並使舊 revision findings 失效');
    const semanticUnit={id:'ARCH-DATAFLOW-SPEC',machine_feedback:'語意缺陷'}; const premature=postInterruptAcceptance(temp,'architecture',semanticUnit,{work_units:{post_interrupt_acceptance:true}}); assert(premature.eligible===false&&premature.reason.includes('語意修復診斷'),'帶語意診斷的 SPEC 不得被格式驗證提前判定完成');
    const continuationConfig={work_units:{max_no_progress_attempts:2,max_total_continuations_per_cycle:8}}; assert(!continuationCircuit({continuations:4,no_progress_count:0},continuationConfig).blocked,'持續有進展的第 4 次續跑不可被舊固定上限誤擋'); assert(continuationCircuit({continuations:5,no_progress_count:2},continuationConfig).kind==='no_progress','連續無進展必須優先熔斷'); assert(continuationCircuit({continuations:8,no_progress_count:0},continuationConfig).kind==='total_limit','即使持續有進展仍須保留每輪絕對安全上限');
    const quotaSample=JSON.stringify({terminal_reason:'api_error',api_error_status:429,result:"You've hit your session limit · resets 1:30am (Asia/Taipei)"}),resetAt=quotaResumeAt(quotaSample,30,0),delayedAt=quotaResumeAt(quotaSample,30,5); assert(quotaError(quotaSample),'Claude API 429 session limit 必須辨識為額度暫停，不可誤報程序故障'); assert(new Date(resetAt).getTime()>Date.now(),'額度重置時間必須解析為未來時間'); assert(new Date(delayedAt).getTime()-new Date(resetAt).getTime()===5*60000,'自動重試必須在 Claude 額度刷新時間後再延遲 5 分鐘'); const quotaSchedule=quotaRetrySchedule(temp,delayedAt); assert(quotaSchedule.onCalendar.endsWith(' UTC')&&quotaSchedule.args.some(value=>value===`--on-calendar=${quotaSchedule.onCalendar}`)&&quotaSchedule.args.includes('--property=KillMode=control-group')&&quotaSchedule.args.includes('--property=TimeoutStopSec=30s')&&quotaSchedule.args.at(-2)==='run'&&quotaSchedule.args.at(-1)===path.basename(temp),'額度暫停必須建立可整組停止的精準一次性喚醒，並由 run 自動檢查後續接原任務'); assert(quotaUnitPrefix(temp).startsWith(`page-autodev-quota-${path.basename(temp)}-`),'額度服務必須具專案專屬前綴，供 stop 完整枚舉清理');
    const overloadSample=JSON.stringify({terminal_reason:'api_error',api_error_status:529,result:'API Error: 529 Overloaded. This is a server-side issue'}),retry1=transientResumeAt(1,2,15),retry5=transientResumeAt(5,2,15); assert(transientServiceError(overloadSample)&&!quotaError(overloadSample),'Claude API 529 必須辨識為暫時性服務過載，而非額度或永久失敗'); assert(retry1.delay_minutes===2&&retry5.delay_minutes===15,'服務過載重試必須採 2 分鐘起、15 分鐘封頂的指數退避');
    const authSample=JSON.stringify({terminal_reason:'api_error',result:'Failed to authenticate: OAuth session expired and could not be refreshed'}); assert(authenticationError(authSample)&&!quotaError(authSample)&&!transientServiceError(authSample),'OAuth 過期必須分類為需要重新登入，不可誤報額度、服務過載或一般程序失敗');
    const taipeiSample=taipeiTime('2026-09-03T08:45:30.000Z'); assert(taipeiSample==='2026/09/03 16:45:30（台北）','使用者可見時間必須轉換為 Asia/Taipei 並明確標示台北'); assert(displayText('預計 2026-09-03T08:45:30.000Z 執行').includes(taipeiSample)&&!displayText('預計 2026-09-03T08:45:30.000Z 執行').includes('T08:45'),'一般提示文字內嵌的 ISO UTC 時間也必須自動轉為台北時間');
    const inputRoot=path.join(temp,'docs','input'); fs.mkdirSync(inputRoot,{recursive:true}); fs.writeFileSync(path.join(inputRoot,'new-guidance.md'),'stable input\n'); const fingerprintState={}; assert(captureCompletedInputFingerprint(fingerprintState,temp,'input_analysis'),'工作單元化輸入階段完成時必須保存輸入指紋'); assert(fingerprintState.input_fingerprint===inputFingerprint(temp),'保存的輸入指紋必須等於目前 docs/input 真值'); assert(!routeChangedInput(fingerprintState,temp),'輸入內容未變時不得重新進入 input_analysis 或使既有 Gate 失效'); assert(!captureCompletedInputFingerprint({},temp,'requirements'),'非輸入分析階段不得覆寫輸入指紋');
    const repairState={input_revision:1},repairConfig={repair_loops:{max_hard_total_per_gate:20,max_same_target:2,max_consecutive_no_progress:3}}; for(const [index,target] of ['ARCH-FOUNDATION','ARCH-ADR','ARCH-REQ-CONTEXT','ARCH-SYSTEM-SPEC'].entries()) assert(!registerRepairCycle(repairState,'architecture_gate',[target],repairConfig,`GF-${index}`,5-index).blocked,'未結案數持續下降時，第 4 輪不得被固定總上限誤擋'); assert(!registerRepairCycle(repairState,'architecture_gate',['ARCH-FOUNDATION'],repairConfig,'GF-NEW',1).blocked,'相同目標但不同 finding 不可誤判為同一失敗'); registerRepairCycle(repairState,'architecture_gate',['ARCH-FOUNDATION'],repairConfig,'GF-SAME'); registerRepairCycle(repairState,'architecture_gate',['ARCH-FOUNDATION'],repairConfig,'GF-SAME'); assert(registerRepairCycle(repairState,'architecture_gate',['ARCH-FOUNDATION'],repairConfig,'GF-SAME').blocked,'相同修復目標且相同 finding 第 3 次仍須熔斷，避免無限消耗'); const stagnant={input_revision:1}; registerRepairCycle(stagnant,'architecture_gate',['ARCH-ADR'],repairConfig,'GF-A',2); registerRepairCycle(stagnant,'architecture_gate',['ARCH-FOUNDATION'],repairConfig,'GF-B',2); registerRepairCycle(stagnant,'architecture_gate',['ARCH-REQ-CONTEXT'],repairConfig,'GF-C',2); assert(registerRepairCycle(stagnant,'architecture_gate',['ARCH-SYSTEM-SPEC'],repairConfig,'GF-D',2).blocked,'即使 finding ID 漂移，未結案數連續 3 輪未下降仍須熔斷');
    const mappingPlan={units:STATIC_WORK_UNITS.architecture.map(unit=>({id:unit.id}))},mapping=normalizeRepairSuggestions(mappingPlan,['docs/architecture/ARCHITECTURE.md:299-320','docs/decisions/0014-database-role-separation.md','docs/context/PROJECT_CONTEXT.md:253','docs/architecture/diagrams/data-trust-boundary.html 與 data-trust-boundary.visual-check.json','docs/specs/ 後續處理']); assert(['ARCH-FOUNDATION','ARCH-ADR','ARCH-DATAFLOW-BUILD','ARCH-DATAFLOW-VERIFY'].every(id=>mapping.mapped.includes(id)),'Gate 檔案路徑必須映射至最小可執行權威工作單元'); assert(!mapping.mapped.includes('ARCH-REQ-CONTEXT'),'衍生 PROJECT_CONTEXT 不得成為 Architecture Gate 修復目標'); assert(mapping.ignored.includes('docs/specs/ 後續處理'),'非目前修復階段建議應延後，不得阻塞本階段');
    const specPlan={units:STATIC_WORK_UNITS.specification.map(unit=>({id:unit.id}))},inferred=inferFindingRepairTargets(specPlan,{title:'CSRF 與 Idempotency-Key 規格衝突',summary:'BEHAVIOR.md 也提到相關行為，但本輪不需修改',repair_targets:[],repair_plan:['修改 docs/specs/DATA_API.md 的驗證順序與回應快取','同步修正 docs/specs/SECURITY_TEST.md 的 SEC-CSRF-06 與 NFR-IDEMP-05'],acceptance_check:['兩份文件定義一致']}); assert(inferred.mapped.includes('SPEC-DATA-API')&&inferred.mapped.includes('SPEC-SECURITY-TEST'),'repair_targets 空白時，控制器必須從 repair_plan、檔案與驗收條件推導最小規格工作單元'); assert(!inferred.mapped.includes('SPEC-BEHAVIOR'),'摘要僅提及但修復步驟未要求修改的規格，不得被擴張為 repair target');
    const recovered=inferFindingRepairTargets(specPlan,{repair_targets:[],repair_plan:['修改 DATA_API.md 與 SECURITY_TEST.md'],summary:'舊版曾誤推導 BEHAVIOR.md'}); assert(recovered.mapped.length===2&&!recovered.mapped.includes('SPEC-BEHAVIOR'),'既有阻塞狀態恢復時必須由可執行步驟重新推導，不得沿用舊版誤目標');
    const legacyFindingsFile=path.join(temp,'.ai','GATE_FINDINGS.json'),legacyStore=readJson(legacyFindingsFile); legacyStore.findings[0].status='resolved'; legacyStore.findings.push({...legacyStore.findings[0],id:'GF-LEGACY-DEFERRED',fingerprint:'legacy-deferred',status:'deferred'}); writeJson(legacyFindingsFile,legacyStore); const migratedStore=loadFindings(temp); assert(migratedStore.findings[0].status==='closed'&&migratedStore.findings[1].status==='closed','舊版 resolved／deferred finding 必須自動遷移為狀態機的 closed，不得使控制器崩潰');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
  architectureDeathTests(assert);
  console.log('WORKFLOW_EFFICIENCY_SELF_TEST_OK');
}

const [cmd='status', arg] = process.argv.slice(2); const project=resolveProject(arg);
try {
  if (cmd==='run') process.exitCode=await run(project);
  else if (cmd==='start'||cmd==='resume'||cmd==='resume-once') {
    if(cmd==='resume-once') process.env.PAGE_AUTODEV_NO_BACKGROUND='1';
    enable(project,true); clearHold(project); timer(project,true); process.exitCode=await run(project);
    if(cmd==='resume-once') console.log('【single-shot 完成】一般計時器維持停用；確認 recovery 正常後才由操作者恢復背景續跑。');
  }
  else if (cmd==='stop') { const result=stopProject(project); if(result.complete) console.log('【已完全停止】新任務派發、一般計時器、額度喚醒器、主控制器與 Claude 工作單元均已停止。'); else { console.error(`【停止逾時】已禁止派發新任務，但仍有程序或服務尚未結束：${result.after.activeUnits.map(item=>item.unit).join('、')||`PID ${result.after.owner?.pid??'未知'}`}。請執行 page-autodev status 查看狀態。`); process.exitCode=3; } }
  else if (cmd==='status') status(project);
  else if (cmd==='routing') routingStatus(project);
  else if (cmd==='plan') showWorkPlan(project);
  else if (cmd==='parallel'||cmd==='workers') showParallelStatus(project);
  else if (cmd==='parallel-diagnostics') parallelDiagnostics(project);
  else if (cmd==='verify-artifacts') verifyArchitectureArtifacts(project);
  else if (cmd==='migrate-workflow') migrateProjectWorkflow(project);
  else if (cmd==='slim-docs') slimMarkdownDocuments(assertProject(project));
  else if (cmd==='slim-docs-apply') { const checked=assertProject(project); const report=slimMarkdownDocuments(checked,{apply:true}); if(report.length) gitCheckpoint(checked,readJson(path.join(checked,'.ai','AUTODEV_CONFIG.json')),'安全瘦身：封存回合歷程並保留現行 Source of Truth'); }
  else if (cmd==='self-test') workflowSelfTest();
  else if (cmd==='deployment-preflight') { const checked=assertProject(project), task=nextReadyTask(checked), receipt=deploymentPreflight(checked,{id:task?.id??'MANUAL-PREFLIGHT',verification:[['docker','compose','config']]}); console.log(JSON.stringify({task:task?.id??null,...receipt},null,2)); process.exitCode=receipt.ok?0:2; }
  else if (cmd==='watch') await watchProgress(project);
  else if (cmd==='test-notification') { const checked=assertProject(project), state=readJson(path.join(checked,'.ai','PROJECT_STATE.json')); const sent=await notifyTelegram(checked,`manual_test_${Date.now()}`,'🧪 頁構所 AI：通知功能測試',state,'這是人工觸發的測試通知，不會啟動或修改自動開發流程。'); process.exitCode=sent?0:1; }
  else throw new Error('使用方式：page-autodev start|run|resume|stop|status|routing|plan|parallel|workers|parallel-diagnostics|verify-artifacts|deployment-preflight|migrate-workflow|slim-docs|slim-docs-apply|self-test|watch|test-notification [專案名稱]');
} catch (e) {
  const duplicate=String(e.message).includes('另一個自動化程序正在執行');
  if(duplicate&&cmd==='run') { console.log('【正常略過】此專案已有自動化程序執行中；背景計時器不會重複啟動 Claude，稍後會再次檢查。'); process.exitCode=75; }
  else if(duplicate&&['start','resume'].includes(cmd)) { console.log('【已在執行】此專案的自動化程序仍在運作，續跑設定已生效；不會重複啟動 Claude，也不需要再次執行 resume。若剛執行 stop，請等待目前工作單元到達安全 checkpoint 後再查看狀態。'); process.exitCode=0; }
  else { console.error(`【控制器錯誤】${e.message}`); process.exitCode=1; }
  if(['run','start','resume'].includes(cmd)&&!duplicate) {
    try {
      const checked=assertProject(project), statePath=path.join(checked,'.ai','PROJECT_STATE.json'), state=readJson(statePath);
      state.status='failed'; state.blocker=`控制器發生未預期錯誤：${e.message}`; state.next_action='請檢查服務日誌，排除問題後執行 page-autodev resume'; state.updated_at=now(); writeJson(statePath,state);
      await notifyTelegram(checked,'controller_error','❌ 頁構所 AI：控制器發生未預期錯誤',state);
    } catch(notificationError) { console.error(`【錯誤通知未完成】${notificationError.message}`); }
  }
}
