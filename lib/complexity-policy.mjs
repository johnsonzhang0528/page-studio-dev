import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HIGH_RISK_PATTERN=/(security|auth|oauth|permission|rbac|payment|migration|encryption|backup|restore|recovery|transaction|idempot|concurren|lock|audit|deploy|安全|認證|授權|權限|付款|遷移|加密|備份|復原|交易|冪等|併行|鎖定|稽核|部署)/i;
const ABSTRACTION_PATTERN=/(interface|factory|wrapper|adapter|repository|provider|registry|framework|plugin|抽象|工廠|包裝|介面層)/i;
const DEFAULT_PROTECTED=[
  '已核准需求與驗收條件','已核准 ADR 與公開契約','信任邊界輸入驗證','認證、授權與最小權限',
  '資料完整性、交易與冪等','避免資料遺失的錯誤處理','Migration、備份與復原','必要的可觀測性與稽核',
  '併行控制、重試上限與故障隔離','必要測試與 accessibility'
];

const text=value=>String(value??'');
const unique=values=>[...new Set(values.filter(Boolean).map(value=>text(value).trim()).filter(Boolean))];

export function selectComplexityPolicy(task,config={}) {
  const settings=config.complexity_control??{};
  if(settings.enabled===false||!task) return {enabled:false,mode:'off',rollout:'off',review_required:false,triggers:[],protected_complexity:[]};
  const risk=text(task.risk).toLowerCase(),body=`${text(task.id)} ${text(task.title)} ${text(task.description)} ${(task.write_scope??[]).join(' ')}`;
  const highRisk=['critical','high','重大','高'].includes(risk)||HIGH_RISK_PATTERN.test(body);
  const requested=text(task.complexity_policy||'').toLowerCase();
  let mode=requested||settings.default_mode||'full';
  if(highRisk) mode=settings.high_risk_mode||'lite';
  if(mode==='ultra'&&settings.allow_ultra!==true) mode='full';
  if(!['off','lite','full','ultra'].includes(mode)) mode='full';
  const review=settings.review??{},scope=Array.isArray(task.write_scope)?task.write_scope:[],triggers=[];
  if(scope.length>=Number(review.file_threshold??5)) triggers.push(`write_scope ${scope.length} 個檔案`);
  if(scope.some(item=>/(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml)$/i.test(item))) triggers.push('可能新增或變更依賴');
  if(ABSTRACTION_PATTERN.test(body)) triggers.push('任務涉及抽象層或包裝層');
  if(highRisk) triggers.push('高風險任務採 lite，保護必要控制');
  const strategy=review.strategy||'conditional',reviewRequired=strategy==='required'||strategy==='conditional'&&triggers.length>0;
  return {
    enabled:mode!=='off',mode,rollout:settings.rollout||'shadow',review_required:reviewRequired,
    review_strategy:strategy,max_review_rounds:1,triggers,
    added_lines_threshold:Number(review.added_lines_threshold??150),file_threshold:Number(review.file_threshold??5),
    protected_complexity:unique([...(settings.protected_complexity??[]),...DEFAULT_PROTECTED]),
    source:settings.source||'Ponytail complexity discipline'
  };
}

export function complexityInstruction(policy) {
  if(!policy?.enabled||policy.mode==='off') return '';
  const shadow=policy.rollout==='shadow';
  const modeRule=policy.mode==='lite'
    ? '只提出更精簡的替代方案；不得為了縮短程式而自行刪減已核准設計。'
    : policy.mode==='ultra'
      ? '僅限明確標示的原型或一次性工作；優先刪除與原生能力，但仍不得縮減明確需求。'
      : '依序判斷：是否需要新增、能否重用既有程式、標準函式庫或平台原生能力、既有依賴是否足夠，最後才寫最小正確實作。';
  const rolloutRule=shadow
    ? '目前為 shadow pilot：照原核准規格實作；完成驗證後只記錄可再簡化項目，不因本政策額外改寫本輪成果。'
    : '完成原驗證後，只允許一次 diff 範圍的複雜度自審；若能在不改變行為下安全縮減才套用，套用後必須重新執行原驗證。不得形成第二輪自動簡化。';
  return `\nPonytail 選擇性複雜度政策（${policy.mode}／${policy.rollout}）：${modeRule}${rolloutRule}
此政策只約束解法複雜度，不可覆蓋需求、ADR、write_scope、verification、governance_rules 或 Gate。不得移除：${policy.protected_complexity.join('、')}。
若實際變更達 ${policy.added_lines_threshold} 行、${policy.file_threshold} 個檔案、新增依賴或抽象層，完成前做一次 diff-only 複雜度檢視；correctness、安全與效能仍由原驗證及獨立 Gate 負責。
最終 JSON 請加入 complexity_receipt：mode、rollout、review_performed、applied、triggers、reuse_decision、native_or_stdlib_option、new_dependency_justification、protected_complexity、simplifications、deferred_debt。即使無可簡化項目也必須回傳空陣列；不得因補收據重做程式。`;
}

function git(project,args){ return spawnSync('git',args,{cwd:project,encoding:'utf8'}); }
export function diffComplexitySnapshot(project,task,policy) {
  const numstat=git(project,['diff','--numstat','HEAD']).stdout??'',files=new Set(),signals=[...(policy?.triggers??[])]; let added=0,deleted=0;
  for(const line of numstat.trim().split(/\r?\n/).filter(Boolean)) { const [a,d,file]=line.split('\t'); files.add(file); if(/^\d+$/.test(a)) added+=Number(a); if(/^\d+$/.test(d)) deleted+=Number(d); }
  const status=git(project,['status','--porcelain']).stdout??'';
  for(const line of status.split(/\r?\n/).filter(Boolean)) files.add(line.slice(3).trim().split(' -> ').at(-1));
  if(added>=Number(policy?.added_lines_threshold??150)) signals.push(`實際新增 ${added} 行`);
  if(files.size>=Number(policy?.file_threshold??5)) signals.push(`實際變更 ${files.size} 個檔案`);
  if([...files].some(file=>/(?:^|\/)(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml)$/i.test(file))) signals.push('實際變更依賴清單');
  return {task_id:task?.id??null,mode:policy?.mode??'off',rollout:policy?.rollout??'off',added_lines:added,deleted_lines:deleted,files_changed:files.size,triggers:unique(signals)};
}

export function normalizeComplexityReceipt(receipt,policy,snapshot) {
  const value=receipt&&typeof receipt==='object'?receipt:{};
  const arr=name=>unique(Array.isArray(value[name])?value[name]:value[name]?[value[name]]:[]);
  return {
    mode:policy?.mode??'off',rollout:policy?.rollout??'off',review_performed:Boolean(value.review_performed),
    applied:policy?.rollout==='shadow'?false:Boolean(value.applied),triggers:unique([...(snapshot?.triggers??[]),...arr('triggers')]),
    reuse_decision:text(value.reuse_decision).slice(0,500),native_or_stdlib_option:text(value.native_or_stdlib_option).slice(0,500),
    new_dependency_justification:value.new_dependency_justification==null?null:text(value.new_dependency_justification).slice(0,500),
    protected_complexity:arr('protected_complexity'),simplifications:arr('simplifications'),deferred_debt:arr('deferred_debt'),
    receipt_missing:!receipt||typeof receipt!=='object'
  };
}

export function recordComplexityMetric(project,task,policy,verdict) {
  if(!policy?.enabled||!task) return null;
  const snapshot=diffComplexitySnapshot(project,task,policy),receipt=normalizeComplexityReceipt(verdict?.complexity_receipt,policy,snapshot);
  const relative='.ai/COMPLEXITY_METRICS.json',file=path.join(project,relative),store=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema_version:1,source:policy.source,entries:[]};
  const entry={at:new Date().toISOString(),...snapshot,receipt}; store.entries.push(entry); if(store.entries.length>200) store.entries=store.entries.slice(-200);
  fs.writeFileSync(file,JSON.stringify(store,null,2)+'\n'); return entry;
}
