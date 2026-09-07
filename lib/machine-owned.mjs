import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './visual-policy.mjs';

/**
 * Controller 專屬的 provenance artifacts。Agent 不得透過修改這些檔案來「修好」自己的 Gate。
 * 每個 pattern 對應唯一可寫入的 machine unit（null = 只有 controller 流程可寫）。
 */
export const MACHINE_OWNED_PATTERNS=Object.freeze([
  {pattern:/^\.ai\/(PROJECT_STATE|TASK_GRAPH|PHASE_TASK_GRAPH)\.json$/,owner:null,label:'controller state'},
  {pattern:/^\.ai\/runtime\//,owner:null,label:'runtime lease and process state'},
  {pattern:/^\.ai\/telemetry\//,owner:null,label:'controller usage and timing ledger'},
  {pattern:/^\.ai\/approvals\//,owner:null,label:'approval receipts'},
  {pattern:/^\.ai\/transactions\//,owner:null,label:'transaction journal'},
  {pattern:/^\.ai\/architecture\//,owner:null,label:'semantic freeze receipt'},
  {pattern:/^\.ai\/GATE_CACHE\.json$/,owner:null,label:'gate cache'},
  {pattern:/^\.ai\/GATE_AUDIT/,owner:null,label:'gate audit'},
  {pattern:/^docs\/architecture\/ARCHIFY_EVIDENCE\.json$/,owner:'ARCH-EVIDENCE-SYNC',label:'archify evidence'},
  {pattern:/^docs\/architecture\/diagrams\/.+\.build-receipt\.json$/,owner:/^ARCH-[A-Z]+-BUILD$/,label:'build receipt'},
  {pattern:/^docs\/architecture\/diagrams\/.+\.visual-acceptance\.json$/,owner:/^ARCH-[A-Z]+-VERIFY$/,label:'visual acceptance receipt'}
]);

const toRelative=(project,file)=>path.relative(project,file).split(path.sep).join('/');
export function machineOwnedRule(relative){ return MACHINE_OWNED_PATTERNS.find(rule=>rule.pattern.test(relative))??null; }
export function isMachineOwnedPath(relative){ return Boolean(machineOwnedRule(relative)); }

/** 對應 machine unit 才可寫入其 ownership 範圍。 */
export function mayWriteMachineOwned(unitId,relative){
  const rule=machineOwnedRule(relative);
  if(!rule) return true;
  if(!rule.owner) return false;
  const id=String(unitId??'');
  return rule.owner instanceof RegExp?rule.owner.test(id):rule.owner===id;
}

/**
 * 所有受保護路徑必須 realpath 落在專案根目錄內；
 * 拒絕 ../ 與指向專案外的 symlink（machine receipt 尤其不可被導向外部）。
 */
export function resolveInsideProject(project,relative){
  const root=fs.realpathSync(project);
  const target=path.resolve(project,relative);
  let real;
  try{ real=fs.realpathSync(target); }
  catch{
    // 檔案尚未存在時，檢查其父目錄，避免用不存在的路徑繞過邊界檢查。
    try{ real=path.join(fs.realpathSync(path.dirname(target)),path.basename(target)); }
    catch{ return {ok:false,reason:`無法解析路徑：${relative}`}; }
  }
  return real===root||real.startsWith(root+path.sep)
    ? {ok:true,real}
    : {ok:false,reason:`路徑逃出專案根目錄（symlink 或 ../）：${relative}`};
}

function walk(dir,project,out){
  let entries=[]; try{ entries=fs.readdirSync(dir,{withFileTypes:true}); }catch{ return out; }
  for(const entry of entries){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){ walk(full,project,out); continue; }
    if(!entry.isFile()&&!entry.isSymbolicLink()) continue;
    const relative=toRelative(project,full);
    if(!isMachineOwnedPath(relative)) continue;
    let digest=null;
    try{ digest=sha256(fs.readFileSync(full)); }catch{ digest='<unreadable>'; }
    out[relative]=digest;
  }
  return out;
}

/** 執行 agent/reviewer 單元前後各取一次，用於偵測未授權改動。 */
export function snapshotMachineOwned(project){
  const snapshot={};
  walk(path.join(project,'.ai'),project,snapshot);
  walk(path.join(project,'docs','architecture'),project,snapshot);
  return snapshot;
}

export function detectMachineOwnedViolations(before={},after={},{unitId=null}={}){
  const violations=[];
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(before[key]===after[key]) continue;
    if(mayWriteMachineOwned(unitId,key)) continue;
    const kind=before[key]===undefined?'新增':after[key]===undefined?'刪除':'修改';
    violations.push({path:key,kind,label:machineOwnedRule(key)?.label??'machine-owned artifact'});
  }
  return violations;
}

export const MACHINE_OWNED_VIOLATION='MACHINE_OWNED_FILE_VIOLATION';
export function machineOwnedViolationReason(violations=[]){
  return `${MACHINE_OWNED_VIOLATION}：工作單元不得修改控制器擁有的證據檔（${violations.map(item=>`${item.path}（${item.kind}）`).join('、')}）`;
}
