import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  canonicalizeRepairOwnership, collapseDiagramRepairTargets, deriveDiagramInvalidations,
  invalidateDerivedWorkUnit, executionModeFor, isMachineUnit, EXECUTION_MODES,
  SEMANTIC_FREEZE_UNIT, EVIDENCE_SYNC_UNIT
} from './architecture-model.mjs';
import { evaluateVisualAcceptance, EFFECTIVE_STATUS, sha256 } from './visual-policy.mjs';
import { writeDurable, canonicalJson, beginTransaction, advanceTransaction, pendingTransactions, reconcilePendingTransactions } from './transactions.mjs';
import { resolveRepairTargets } from './gate-findings.mjs';
import { adjudicateFinding, adjudicateFindings, machineInjectedFindings, effectiveOutcome, isAllowedRuleId, DISPOSITIONS, RULE_IDS } from './finding-adjudication.mjs';
import * as PROV from './architecture-provenance.mjs';

const ARCH_UNITS=['ARCH-REQ-CONTEXT','ARCH-FOUNDATION','ARCH-ADR','ARCH-SYSTEM-SPEC','ARCH-WORKFLOW-SPEC','ARCH-LIFECYCLE-SPEC','ARCH-DATAFLOW-SPEC','ARCH-SPEC-FREEZE','ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY','ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY','ARCH-LIFECYCLE-BUILD','ARCH-LIFECYCLE-VERIFY','ARCH-DATAFLOW-BUILD','ARCH-DATAFLOW-VERIFY','ARCH-EVIDENCE-SYNC'];
const archPlan=()=>({units:ARCH_UNITS.map(id=>({id}))});

function baseReceipt({sha,bytes,overflowY=true,overflowX=false,status='fail'}){
  return {
    schemaVersion:'1',ok:status==='pass',status,
    artifact:{sha256:sha,bytes},
    diagnostics:status==='pass'?[]:[{code:'viewer/viewport-overflow',evidence:{overflowX,overflowY}}],
    containment:{status:status==='pass'?'pass':'fail',viewports:[{width:1440,height:900,theme:'light',overflowX,overflowY,ok:status==='pass',readabilityOk:true,viewerChromeOk:true,viewerChromeStageOk:true,legendDockIntersectionArea:0,dockStageIntersectionArea:0,minimumProjectedNodeTextPx:6.5,minimumRequiredNodeTextPx:6}]},
    readability:{status:'pass'}
  };
}

export function architectureDeathTests(assert){
  // ---- REPAIR：semantic / deterministic / derived 三分法 ----
  const plan=archPlan(),valid=ARCH_UNITS;
  const a1=canonicalizeRepairOwnership(['ARCH-SYSTEM-SPEC','ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY'],{valid});
  assert(JSON.stringify(a1.semantic_repair_targets)===JSON.stringify(['ARCH-SYSTEM-SPEC']),'REPAIR-01 SPEC+BUILD+VERIFY 必須只留一個 semantic owner');
  assert(['ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY',SEMANTIC_FREEZE_UNIT,EVIDENCE_SYNC_UNIT].every(id=>a1.derived_invalidations.includes(id)),'REPAIR-01 derived invalidations 必須涵蓋同族 BUILD／VERIFY 與 FREEZE／EVIDENCE-SYNC');

  const a2=resolveRepairTargets({suggested:['ARCH-SYSTEM-SPEC','ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY'],plan,maxFraction:0.4});
  assert(a2.targets.length===1&&!a2.over_scope,'REPAIR-02 derived 單元不得占用 semantic 安全額度');

  const a3=canonicalizeRepairOwnership(['ARCH-EVIDENCE-SYNC'],{valid});
  assert(a3.semantic_repair_targets.length===0&&a3.deterministic_repair_actions.includes('ARCH-EVIDENCE-SYNC'),'REPAIR-03 deterministic action 不得消耗 semantic quota');

  const a4=resolveRepairTargets({suggested:['ARCH-SYSTEM-SPEC','ARCH-WORKFLOW-SPEC','ARCH-LIFECYCLE-SPEC','ARCH-FOUNDATION','ARCH-SYSTEM-BUILD','ARCH-SYSTEM-VERIFY','ARCH-WORKFLOW-BUILD','ARCH-WORKFLOW-VERIFY','ARCH-LIFECYCLE-BUILD','ARCH-LIFECYCLE-VERIFY'],plan,maxFraction:0.4});
  assert(a4.targets.length===4&&!a4.over_scope,'REPAIR-04 三個 diagram family 加 FOUNDATION 不得因衍生單元被誤判 over_scope');
  assert(a4.derived_invalidations.includes(SEMANTIC_FREEZE_UNIT),'REPAIR-05 semantic 修復必須連帶使 Semantic Freeze 失效');

  // 舊行為回歸：collapse 後再 expand 會產生 10 個以上目標，必須確定不再發生。
  const reExpanded=collapseDiagramRepairTargets(['ARCH-SYSTEM-SPEC'],{valid}).concat(deriveDiagramInvalidations(['ARCH-SYSTEM-SPEC'],{valid}));
  assert(!collapseDiagramRepairTargets(reExpanded,{valid}).includes('ARCH-SYSTEM-BUILD'),'REPAIR 回歸：collapse 之後不得再把 BUILD/VERIFY 展開回 semantic 目標');

  // ---- 執行模式 ----
  assert(executionModeFor('ARCH-SYSTEM-BUILD')===EXECUTION_MODES.machine&&isMachineUnit('ARCH-EVIDENCE-SYNC'),'machine unit 必須標示為機器執行，不啟動 Claude');
  assert(executionModeFor('ARCH-GATE-TRACE')===EXECUTION_MODES.reviewerReadonly&&executionModeFor('ARCH-FOUNDATION')===EXECUTION_MODES.agentWrite,'reviewer 與 agent-write 模式必須分離');

  // ---- 整代 stale evidence 清除 ----
  const derivedUnit={id:'ARCH-SYSTEM-VERIFY',status:'complete',session_id:'s-1',completed_at:'2026-01-01T00:00:00Z',last_summary:'舊摘要',evidence:['舊 SHA'],after_snapshot:{},before_snapshot:{},files_changed:['a'],last_terminal_reason:'x',machine_feedback:'舊 feedback',repair_source:'ARCH-GATE-DIAGRAM',finding_ids:['GF-OLD'],started_at:'2026-01-01T00:00:00Z',cache_hit:true,attempt:2,continuations:3,no_progress_count:2,created_at:'2025-12-01T00:00:00Z',lifetime_continuations:4};
  invalidateDerivedWorkUnit(derivedUnit,{reason:'上游 SPEC 重修'});
  for(const field of ['session_id','completed_at','last_summary','evidence','after_snapshot','before_snapshot','files_changed','last_terminal_reason','machine_feedback','repair_source','finding_ids','started_at','cache_hit'])
    assert(!(field in derivedUnit),`STALE-01 invalidation 後不得殘留上一代欄位：${field}`);
  assert(derivedUnit.status==='pending'&&derivedUnit.continuations===0&&derivedUnit.no_progress_count===0,'STALE-02 invalidation 後必須回到乾淨的 pending 狀態');
  assert(derivedUnit.created_at==='2025-12-01T00:00:00Z'&&derivedUnit.lifetime_continuations===7&&derivedUnit.lifetime_attempts===2,'STALE-03 累積型 audit/safety counter 必須保留且累加，不得被 invalidation 歸零繞過');

  // ---- VISUAL：raw 與 effective 分層 ----
  const html=Buffer.from('<html>dense diagram</html>'),sha=sha256(html),bytes=html.length;
  const vertical=baseReceipt({sha,bytes});
  const b1=evaluateVisualAcceptance({receipt:vertical,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes});
  assert(b1.raw_pass===false&&b1.policy_accepted&&b1.effective_status===EFFECTIVE_STATUS.accepted,'VIS-01 standard 純垂直捲動必須 ACCEPTED_WITH_LIMITATIONS');
  assert(b1.raw_status==='fail','VIS-01 raw receipt 事實不得被改寫成 pass');
  assert(evaluateVisualAcceptance({receipt:vertical,visualQualityProfile:'showcase',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-02 showcase 不得套用 standard 豁免');
  assert(evaluateVisualAcceptance({receipt:vertical,visualQualityProfile:'standard',htmlSha:'deadbeef',htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-03 artifact SHA 不符永不 waiver');
  assert(evaluateVisualAcceptance({receipt:vertical,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes+1}).effective_status===EFFECTIVE_STATUS.fail,'VIS-04 artifact bytes 不符永不 waiver');
  assert(evaluateVisualAcceptance({receipt:baseReceipt({sha,bytes,overflowX:true}),visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-05 水平溢出永不 waiver');
  const unknown=baseReceipt({sha,bytes}); unknown.diagnostics.push({code:'viewer/mystery-defect'});
  assert(evaluateVisualAcceptance({receipt:unknown,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-06 未知診斷必須 fail-closed');
  const unreadable=baseReceipt({sha,bytes}); unreadable.diagnostics.push({code:'viewer/projected-text-readability'}); unreadable.readability={status:'fail'};
  assert(evaluateVisualAcceptance({receipt:unreadable,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-07 真實不可讀不得被診斷碼白名單掩蓋');
  const belowThreshold=baseReceipt({sha,bytes}); belowThreshold.diagnostics.push({code:'viewer/projected-text-readability'}); belowThreshold.containment.viewports[0].minimumProjectedNodeTextPx=3;
  assert(evaluateVisualAcceptance({receipt:belowThreshold,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-07b 投影文字低於門檻必須 FAIL');
  const clipped=baseReceipt({sha,bytes}); clipped.containment.viewports[0].viewerChromeOk=false;
  assert(evaluateVisualAcceptance({receipt:clipped,visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.fail,'VIS-09 真實 containment 失敗必須 FAIL');
  assert(evaluateVisualAcceptance({receipt:null,visualQualityProfile:'standard'}).effective_status===EFFECTIVE_STATUS.fail,'VIS-11 沒有可讀收據必須 FAIL');
  assert(evaluateVisualAcceptance({receipt:baseReceipt({sha,bytes,status:'pass'}),visualQualityProfile:'showcase',htmlSha:sha,htmlBytes:bytes}).effective_status===EFFECTIVE_STATUS.pass,'VIS-12 真正通過必須是 PASS 而非 ACCEPTED_WITH_LIMITATIONS');

  // ---- TRANSACTION：durable writer 與 startup reconciliation ----
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-txn-'));
  try{
    const file=path.join(temp,'nested','receipt.json');
    const result=writeDurable(file,canonicalJson({b:1,a:2}));
    assert(fs.existsSync(file)&&fs.readFileSync(file,'utf8')==='{\n  "a": 2,\n  "b": 1\n}\n','TX-07 durable writer 必須 atomic 落地且輸出 canonical 排序 JSON');
    assert(!fs.readdirSync(path.dirname(file)).some(name=>name.endsWith('.tmp')),'TX-07 durable writer 不得留下暫存檔');
    assert(canonicalJson({b:1,a:2})===canonicalJson({a:2,b:1}),'TX-07 canonical JSON 必須與鍵順序無關，確保 idempotent evidence');

    const txn=beginTransaction(temp,{type:'ARCH_REPAIR',phase:'architecture',gatePhase:'architecture_gate',inputRevision:1,sourceManifestFingerprint:'FP-1',semanticTargets:['ARCH-SYSTEM-SPEC'],derivedInvalidations:['ARCH-SYSTEM-BUILD']});
    assert(txn.state==='PREPARED'&&fs.existsSync(path.join(temp,'.ai','transactions',`${txn.transaction_id}.json`)),'TX-01 PREPARED 必須在 mutation 前先 durable 落地');
    assert(pendingTransactions(temp).length===1,'TX-02 未結束的 transaction 必須可被 startup 偵測');

    const stale=reconcilePendingTransactions(temp,{currentSourceFingerprint:'FP-CHANGED'});
    assert(stale[0].disposition==='ABORTED_STALE_SOURCE'&&pendingTransactions(temp).length===0,'TX-04 source 已改變時必須 ABORT 過期計畫，不得盲目 roll forward');

    const txn2=beginTransaction(temp,{type:'GATE_COMMIT',inputRevision:1,sourceManifestFingerprint:'FP-2'});
    const applied=advanceTransaction(temp,advanceTransaction(temp,txn2,'APPLYING'),'APPLIED');
    const rolled=reconcilePendingTransactions(temp,{currentSourceFingerprint:'FP-2',rollForward:record=>({disposition:record.state==='APPLIED'?'ROLLED_FORWARD':'DEFERRED'})});
    assert(rolled[0].disposition==='ROLLED_FORWARD','TX-05 source 未變的 APPLIED transaction 必須可 idempotent roll-forward');
    advanceTransaction(temp,applied,'COMMITTED');
    assert(pendingTransactions(temp).length===0,'TX-06 已 COMMITTED 的 transaction 不得重複執行');
    let rejected=false; try{ advanceTransaction(temp,{...applied,state:'COMMITTED'},'APPLYING'); }catch{ rejected=true; }
    assert(rejected,'TX-06 terminal transaction 不得再回到中間狀態');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }

  // ---- ADJUDICATION：raw verdict 與 effective verdict 分層 ----
  const canonicalLifecycle={available:true,dueToValidation:true,validationToBlocked:true,directDueToBlocked:false,canonicalComplete:true};
  const acceptedVisual={'work-order-lifecycle':evaluateVisualAcceptance({receipt:baseReceipt({sha,bytes}),visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes})};
  const adjFacts={visual:acceptedVisual,lifecycle:canonicalLifecycle};

  const dueFp=adjudicateFinding({title:'生命週期圖狀態序列已補齊，但缺少字面要求之 due→due_blocked 直接轉移',summary:'要求補上 due→due_blocked 直接邊'},adjFacts);
  assert(dueFp.disposition===DISPOSITIONS.contradicted&&dueFp.rule_id===RULE_IDS.lifecycleDueBlockedPath,'INV-03 canonical path 完整時 DUE direct-edge 要求必須被機器推翻');

  const dueReal=adjudicateFinding({title:'生命週期圖缺少 due→due_blocked，且主線狀態仍合併於 release_validation 未持久化',summary:'狀態未拆分'},adjFacts);
  assert(dueReal.disposition===DISPOSITIONS.survives,'ADJ-04 同時主張真實語意缺口時不得被 DUE 規則吞掉');

  const visualFp=adjudicateFinding({title:'work-order-lifecycle visual-check 收據 status=fail',summary:'viewport 溢出導致視覺驗證未通過'},adjFacts);
  assert(visualFp.disposition===DISPOSITIONS.contradicted&&visualFp.rule_id===RULE_IDS.visualEffectiveAcceptance,'INV-02 effective 已接受時純視覺 finding 必須被推翻');

  const shaReal=adjudicateFinding({title:'Archify evidence 表 SHA-256 與工作區實際檔案不符',summary:'雜湊不一致'},adjFacts);
  assert(shaReal.disposition===DISPOSITIONS.survives,'ADJ-04 真實 SHA/evidence 不符絕不可被 adjudicator suppress');

  const semanticReal=adjudicateFinding({title:'生命週期圖將回滾完成導向 Published 終態，失敗發布會被記為成功',summary:'狀態機語意錯誤'},adjFacts);
  assert(semanticReal.disposition===DISPOSITIONS.survives,'ADJ-04 未知/無機器證據的 semantic finding 必須 PASS_THROUGH');

  assert(isAllowedRuleId(RULE_IDS.buildProvenanceStale)&&!isAllowedRuleId('ARCH_MADE_UP_RULE'),'ADJ rule_id 必須通過 controlled vocabulary allowlist');

  const failedVisual={'system-architecture':evaluateVisualAcceptance({receipt:baseReceipt({sha,bytes,overflowX:true}),visualQualityProfile:'standard',htmlSha:sha,htmlBytes:bytes})};
  const injected=machineInjectedFindings({visual:failedVisual});
  assert(injected.length===1&&injected[0].blocking_stage==='development','INV-01 machine 必須能在 LLM 漏報時主動建立真缺陷');
  assert(effectiveOutcome('pass',[],injected).effective_outcome==='failed','ADJ-05 machine 注入的真缺陷即使 raw pass 也必須阻擋');

  const allContradicted=adjudicateFindings([{title:'work-order-lifecycle visual-check 未通過',summary:'viewport 溢出'}],adjFacts);
  assert(effectiveOutcome('failed',allContradicted,[]).effective_outcome==='pass','ADJ-01 全部 development blocker 被推翻時 effective 可為 pass');
  assert(effectiveOutcome('failed',[{disposition:DISPOSITIONS.survives,finding:{blocking_stage:'development'}}],[]).effective_outcome==='failed','ADJ-02 仍有 surviving development blocker 時必須 effective fail');

  // ---- FREEZE / BUILD / EVIDENCE / APPROVAL provenance ----
  const provTemp=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-prov-'));
  try{
    const archDir=path.join(provTemp,'docs','architecture'),dgDir=path.join(archDir,'diagrams'),adrDir=path.join(provTemp,'docs','decisions'),reqDir=path.join(provTemp,'docs','requirements');
    for(const dir of [dgDir,adrDir,reqDir]) fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(archDir,'ARCHITECTURE.md'),'# Architecture\n語意正文\n');
    fs.writeFileSync(path.join(reqDir,'REQUIREMENTS.md'),'# Requirements\n');
    fs.writeFileSync(path.join(provTemp,'docs','PRD.md'),'# PRD\n');
    fs.writeFileSync(path.join(adrDir,'0001-decision.md'),'# ADR\n**Status:** draft\n**Gate-Eligible:** true\n決策內容\n');
    for(const key of Object.keys(PROV.DIAGRAMS)){
      const paths=PROV.diagramPaths(provTemp,key);
      fs.writeFileSync(paths.spec,JSON.stringify({diagram:key,states:[]}));
      fs.writeFileSync(paths.html,`<html>${key}</html>`);
      const htmlBuffer=fs.readFileSync(paths.html);
      fs.writeFileSync(paths.receipt,JSON.stringify(baseReceipt({sha:sha256(htmlBuffer),bytes:htmlBuffer.length})));
    }

    // APPROVE-01/02：Requirements approval 綁定 exact version
    const reqApproval=PROV.mintRequirementsApproval(provTemp,{inputRevision:1,inputFingerprint:'IF-1'});
    assert(PROV.requirementsApprovalStatus(provTemp,1).current,'APPROVE-01 Requirements Gate PASS 必須 mint 對應 exact version 的 approval');
    fs.appendFileSync(path.join(provTemp,'docs','PRD.md'),'新增未核准需求\n');
    assert(!PROV.requirementsApprovalStatus(provTemp,1).current,'APPROVE-02 核准後 PRD 被改動時 Architecture 不得繼續使用');
    fs.writeFileSync(path.join(provTemp,'docs','PRD.md'),'# PRD\n');

    // FREEZE-01..05：content-addressed semantic freeze
    const freeze=PROV.writeSemanticFreeze(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint});
    assert(PROV.semanticFreezeStatus(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint}).current,'FREEZE 基準：剛建立的 freeze 必須為 current');
    const sysPaths=PROV.diagramPaths(provTemp,'system');
    fs.writeFileSync(sysPaths.spec,JSON.stringify({diagram:'system',states:['changed']}));
    assert(!PROV.semanticFreezeStatus(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint}).current,'FREEZE-01/06 SPEC 改變（含 out-of-band 編輯）必須使 Freeze 失效');
    fs.writeFileSync(sysPaths.spec,JSON.stringify({diagram:'system',states:[]}));
    fs.appendFileSync(path.join(archDir,'ARCHITECTURE.md'),'新增語意段落\n');
    assert(!PROV.semanticFreezeStatus(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint}).current,'FREEZE-02 ARCHITECTURE.md 語意改變必須使 Freeze 失效');
    fs.writeFileSync(path.join(archDir,'ARCHITECTURE.md'),'# Architecture\n語意正文\n');
    fs.writeFileSync(path.join(adrDir,'0001-decision.md'),'# ADR\n**Status:** accepted\n**Gate-Eligible:** true\n決策內容\n');
    assert(PROV.semanticFreezeStatus(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint}).current,'FREEZE-04 ADR Status draft→accepted 不得破壞 pre-Gate semantic Freeze');
    fs.writeFileSync(path.join(adrDir,'0001-decision.md'),'# ADR\n**Status:** accepted\n**Gate-Eligible:** true\n決策內容已改寫\n');
    assert(!PROV.semanticFreezeStatus(provTemp,{inputRevision:1,requirementsApprovalFingerprint:reqApproval.requirements_approval_fingerprint}).current,'FREEZE-03 ADR 決策內容改變必須使 Freeze 失效');
    fs.writeFileSync(path.join(adrDir,'0001-decision.md'),'# ADR\n**Status:** accepted\n**Gate-Eligible:** true\n決策內容\n');

    // BUILD-01..03：provenance 綁定 SPEC + Freeze + HTML
    assert(!PROV.buildProvenanceStatus(provTemp,'system',{}).current,'BUILD legacy：沒有 build receipt 的舊 HTML 不得視為已證明');
    const current=PROV.readSemanticFreeze(provTemp);
    PROV.writeBuildReceipt(provTemp,'system',{architectureGenerationKey:current.architecture_generation_key,semanticFreezeFingerprint:current.semantic_fingerprint,structuralValidationQuality:'showcase'});
    assert(PROV.buildProvenanceStatus(provTemp,'system',{semanticFreezeFingerprint:current.semantic_fingerprint}).current,'BUILD 基準：build receipt 必須證明 current SPEC + Freeze + HTML');
    fs.writeFileSync(sysPaths.html,'<html>tampered</html>');
    assert(!PROV.buildProvenanceStatus(provTemp,'system',{semanticFreezeFingerprint:current.semantic_fingerprint}).current,'BUILD-02 HTML 與 build receipt 不符必須判 STALE_BUILD');
    fs.writeFileSync(sysPaths.html,'<html>system</html>');
    assert(!PROV.buildProvenanceStatus(provTemp,'system',{semanticFreezeFingerprint:'OTHER-FREEZE'}).current,'BUILD-03 Freeze fingerprint 不符必須判 STALE_BUILD');

    // EVID-02/03：Evidence Sync idempotent 且反映現行 artifact
    const sync1=PROV.syncArchifyEvidence(provTemp,{visualQualityProfile:'standard'});
    assert(sync1.ok&&PROV.evidenceSyncStatus(provTemp,{visualQualityProfile:'standard'}).current,'EVID-02 Evidence Sync 必須產生與現行 artifact 一致的 evidence');
    const firstBytes=fs.readFileSync(PROV.archifyEvidencePath(provTemp),'utf8');
    PROV.syncArchifyEvidence(provTemp,{visualQualityProfile:'standard'});
    assert(fs.readFileSync(PROV.archifyEvidencePath(provTemp),'utf8')===firstBytes,'EVID-03 相同輸入連跑兩次必須 byte-identical');
    assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(firstBytes),'EVID/AJ tracked machine receipt 不得包含 volatile timestamp');
    fs.writeFileSync(sysPaths.html,'<html>system-rebuilt</html>');
    assert(!PROV.evidenceSyncStatus(provTemp,{visualQualityProfile:'standard'}).current,'EVID-01 HTML 改變後舊 evidence 必須被判 stale');
    fs.writeFileSync(sysPaths.html,'<html>system</html>');

    // Dataflow NOT_REQUIRED 必須明確記錄，而不是缺檔
    const partial=PROV.buildArchifyEvidence(provTemp,{visualQualityProfile:'standard',requiredDiagrams:['system','workflow','lifecycle']});
    assert(partial.diagrams.dataflow.status==='NOT_REQUIRED'&&partial.diagrams.dataflow.reason,'EVID 不需要的圖必須明確記為 NOT_REQUIRED 並附理由');

    // INV-01：machine gate 可在 LLM 未發現時主動阻擋
    const invariantOptions={visualQualityProfile:'standard',requiredDiagrams:['system']};
    PROV.syncArchifyEvidence(provTemp,invariantOptions);
    const invariants=PROV.evaluateArchitectureInvariants(provTemp,{inputRevision:1,...invariantOptions});
    assert(invariants.ok,'INV 基準：provenance 齊備時 invariant gate 必須通過');
    fs.writeFileSync(sysPaths.html,'<html>out-of-band</html>');
    const broken=PROV.evaluateArchitectureInvariants(provTemp,{inputRevision:1,...invariantOptions});
    assert(!broken.ok&&broken.violations.some(item=>item.rule_id==='ARCH_BUILD_PROVENANCE_STALE'),'INV-01 HTML 與 build receipt 不符時，即使 LLM 未發現也必須阻擋');

    // APPROVE-06/07：legacy cache 不得未經驗證即 mint approval
    assert(!PROV.legacyGateCacheCompatibility({outcome:'pass',fingerprint:'x',manifest:{},summary:'',evidence:[]}).eligible,'APPROVE-06 舊 schema Gate cache 不得直接 mint approval');
    assert(PROV.legacyGateCacheCompatibility({source_manifest_fingerprint:'a',policy_bundle_fingerprint:'b',effective_outcome:'pass',structured_receipts:{}}).eligible,'APPROVE-07 僅在具備完整 structured evidence 時才可 mint compatibility approval');
  } finally { fs.rmSync(provTemp,{recursive:true,force:true}); }

  console.log('ARCHITECTURE_DEATH_TESTS_OK');
}
