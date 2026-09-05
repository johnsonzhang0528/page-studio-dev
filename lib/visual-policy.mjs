import crypto from 'node:crypto';

export const VISUAL_ACCEPTANCE_POLICY_VERSION='1.0.0';
export const EFFECTIVE_STATUS=Object.freeze({pass:'PASS',accepted:'ACCEPTED_WITH_LIMITATIONS',fail:'FAIL'});
// standard profile 唯一允許的兩種 diagnostic；其餘一律 FAIL。
const WAIVABLE_CODES=new Set(['viewer/viewport-overflow','viewer/projected-text-readability']);

const isVerticalOnlyOverflow=item=>item?.code==='viewer/viewport-overflow'&&item?.evidence?.overflowX===false&&item?.evidence?.overflowY===true;

// 診斷碼本身不足以證明可讀性；必須有 machine-readable evidence 證明未低於門檻。
function readabilityAcceptable(receipt){
  const status=receipt?.readability?.status;
  if(status==='fail') return false;
  const viewports=Array.isArray(receipt?.containment?.viewports)?receipt.containment.viewports:[];
  if(viewports.some(v=>v?.readabilityOk===false)) return false;
  return viewports.every(v=>{
    const actual=Number(v?.minimumProjectedNodeTextPx),required=Number(v?.minimumRequiredNodeTextPx);
    if(!Number.isFinite(actual)||!Number.isFinite(required)) return true;
    return actual>=required;
  });
}

// containment 不能只看 status：唯一原因是垂直捲動時可接受，真正的裁切/水平遺失必須 FAIL。
function containmentBlockingReasons(receipt){
  const reasons=[];
  const viewports=Array.isArray(receipt?.containment?.viewports)?receipt.containment.viewports:[];
  for(const viewport of viewports){
    const label=`${viewport.width}x${viewport.height}/${viewport.theme??'?'}`;
    if(viewport.overflowX===true) reasons.push(`${label} 水平溢出（overflowX=true）`);
    if(viewport.viewerChromeOk===false) reasons.push(`${label} viewer chrome 失敗`);
    if(viewport.viewerChromeStageOk===false) reasons.push(`${label} viewer chrome stage 失敗`);
    if(viewport.readabilityOk===false) reasons.push(`${label} 投影文字可讀性未達門檻`);
    if(Number(viewport.legendDockIntersectionArea)>0) reasons.push(`${label} legend 與 dock 重疊`);
    if(Number(viewport.dockStageIntersectionArea)>0) reasons.push(`${label} dock 與 stage 重疊`);
  }
  return reasons;
}

/**
 * Raw tool result 與 policy-effective acceptance 的唯一權威分界。
 * 絕不改寫 raw receipt；raw_status 原封保留，只在其上疊加 policy 判定。
 */
export function evaluateVisualAcceptance({receipt,visualQualityProfile,htmlSha=null,htmlBytes=null,rawReceiptSha=null}={}){
  const base={
    schema_version:1,
    visual_policy_version:VISUAL_ACCEPTANCE_POLICY_VERSION,
    visual_quality_profile:visualQualityProfile??null,
    raw_status:receipt?.status??null,
    raw_pass:receipt?.ok===true&&receipt?.status==='pass',
    source_html_sha:htmlSha,source_raw_receipt_sha:rawReceiptSha,
    waived_diagnostics:[],acceptance_reason:null,blocking_reasons:[]
  };
  if(!receipt||typeof receipt!=='object') return {...base,policy_accepted:false,effective_status:EFFECTIVE_STATUS.fail,blocking_reasons:['visual-check 收據不存在或無法解析']};

  const blocking=[];
  // Artifact 完整性永不 waiver。
  const artifact=receipt.artifact??{};
  if(htmlSha&&artifact.sha256&&artifact.sha256!==htmlSha) blocking.push(`收據 SHA-256 ${artifact.sha256} 與現行 HTML ${htmlSha} 不符`);
  if(htmlSha&&!artifact.sha256) blocking.push('收據缺少 artifact.sha256，無法證明對應現行 HTML');
  if(htmlBytes!=null&&artifact.bytes!=null&&Number(artifact.bytes)!==Number(htmlBytes)) blocking.push(`收據 bytes ${artifact.bytes} 與現行 HTML ${htmlBytes} 不符`);

  const diagnostics=Array.isArray(receipt.diagnostics)?receipt.diagnostics:[];
  if(base.raw_pass&&diagnostics.length===0&&!blocking.length){
    return {...base,policy_accepted:true,effective_status:EFFECTIVE_STATUS.pass,acceptance_reason:'raw visual-check 通過且無診斷'};
  }

  const unknown=diagnostics.filter(item=>!WAIVABLE_CODES.has(item?.code));
  for(const item of unknown) blocking.push(`非白名單診斷：${item?.code??'unknown'}`);

  const overflow=diagnostics.filter(item=>item?.code==='viewer/viewport-overflow');
  for(const item of overflow) if(!isVerticalOnlyOverflow(item)) blocking.push(`viewport-overflow 非純垂直捲動（overflowX=${item?.evidence?.overflowX}）`);

  if(diagnostics.some(item=>item?.code==='viewer/projected-text-readability')&&!readabilityAcceptable(receipt)) blocking.push('投影文字實際可讀性低於安全門檻');

  blocking.push(...containmentBlockingReasons(receipt));

  if(visualQualityProfile!=='standard'&&diagnostics.length) blocking.push(`visual_acceptance_quality=${visualQualityProfile??'unset'} 不套用 standard 密集技術圖豁免`);

  if(blocking.length) return {...base,policy_accepted:false,effective_status:EFFECTIVE_STATUS.fail,blocking_reasons:[...new Set(blocking)]};

  const codes=[...new Set(diagnostics.map(item=>item.code))];
  return {...base,policy_accepted:true,effective_status:EFFECTIVE_STATUS.accepted,waived_diagnostics:codes,
    acceptance_reason:`standard profile 接受密集技術圖之已知檢視限制（${codes.join('、')}）；無水平遺失、裁切、viewer chrome 或 artifact 完整性問題`};
}

// Evidence 必須如實分層陳述，不得宣稱 raw pass。
export function visualAcceptanceEvidence(name,acceptance){
  return [
    `${name} Raw visual-check：${acceptance.raw_status??'無收據'}`,
    `${name} Effective policy：${acceptance.effective_status}（policy v${acceptance.visual_policy_version}, profile=${acceptance.visual_quality_profile}）`,
    acceptance.waived_diagnostics.length?`${name} 已豁免診斷：${acceptance.waived_diagnostics.join('、')}`:`${name} 無豁免診斷`,
    acceptance.source_html_sha?`${name} HTML SHA-256 ${acceptance.source_html_sha} 已驗證`:`${name} 未提供 HTML SHA`,
    ...(acceptance.blocking_reasons.length?[`${name} 阻斷原因：${acceptance.blocking_reasons.join('；')}`]:[])
  ];
}

export const visualAcceptanceReceipt=(acceptance,{architectureGenerationKey=null,semanticFreezeFingerprint=null}={})=>({
  schema_version:1,
  architecture_generation_key:architectureGenerationKey,
  semantic_freeze_fingerprint:semanticFreezeFingerprint,
  source_html_sha:acceptance.source_html_sha,
  source_raw_receipt_sha:acceptance.source_raw_receipt_sha,
  visual_policy_version:acceptance.visual_policy_version,
  visual_quality_profile:acceptance.visual_quality_profile,
  raw_status:acceptance.raw_status,
  effective_status:acceptance.effective_status,
  waived_diagnostics:acceptance.waived_diagnostics,
  acceptance_reason:acceptance.acceptance_reason
});
export const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
