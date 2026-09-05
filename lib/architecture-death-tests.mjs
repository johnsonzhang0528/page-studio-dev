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

  console.log('ARCHITECTURE_DEATH_TESTS_OK');
}
