import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateControllerJson } from './schema-registry.mjs';
import { loadQualityContract, qualityContractCommands } from './quality-contract.mjs';

const testEnv=()=>{ const out={CI:'1'}; for(const key of ['HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TERM','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME']) if(process.env[key]!==undefined) out[key]=process.env[key]; return out; };
const run=(cmd,args,cwd,timeout=900000)=>spawnSync(cmd,args,{cwd,encoding:'utf8',timeout,env:testEnv()});
const result=(name,ok,detail)=>({name,ok,detail:String(detail??'').trim().slice(-4000)});
const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const TASK_COMPLETE_STATUSES=new Set(['complete','completed','done','passed']);
const taskComplete=task=>TASK_COMPLETE_STATUSES.has(String(task?.status??'').toLowerCase());
export const documentHasPlaceholder=text=>String(text).split(/\r?\n/).some(line=>/^\s*(?:[-*]\s*)?(?:[^:：\n]{0,80}[:：]\s*)?(?:TBD|尚未開始|待補充)\s*[。.]?\s*$/i.test(line));

function taskGraphCheck(project) {
  try {
    const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')), tasks=graph.tasks;
    if(!Array.isArray(tasks)||!tasks.length) return result('任務圖結構',false,'tasks 必須是非空陣列');
    const ids=new Set(); for(const t of tasks){ if(!t.id||!t.title||!t.status) return result('任務圖結構',false,`任務缺少 id、title 或 status：${JSON.stringify(t)}`); if(ids.has(t.id)) return result('任務圖結構',false,`任務 ID 重複：${t.id}`); ids.add(t.id); }
    for(const t of tasks) for(const dep of (t.depends_on??[])) if(!ids.has(dep)) return result('任務圖相依',false,`${t.id} 參照不存在的相依任務 ${dep}`);
    const visiting=new Set(),done=new Set(),map=new Map(tasks.map(t=>[t.id,t]));
    const visit=id=>{ if(visiting.has(id)) throw new Error(`偵測到循環相依：${id}`); if(done.has(id)) return; visiting.add(id); for(const dep of(map.get(id).depends_on??[])) visit(dep); visiting.delete(id); done.add(id); };
    for(const id of ids) visit(id); return result('任務圖結構與相依',true,`${tasks.length} 個任務，無重複、遺失相依或循環相依`);
  } catch(e){ return result('任務圖結構與相依',false,e.message); }
}

function parallelTaskCheck(project) {
  try {
    const tasks=readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks.filter(task=>!String(task.id).startsWith('REQ-')), errors=[];
    const normalize=value=>String(value).replaceAll('\\','/').replace(/^\.\//,'').replace(/\/\*\*.*$/,'').replace(/\*.*$/,'').replace(/\/$/,'');
    const overlap=(a,b)=>{ const x=normalize(a),y=normalize(b); return x===y||x.startsWith(`${y}/`)||y.startsWith(`${x}/`); };
    const isolated=tasks.filter(task=>task.parallel_policy==='isolated');
    for(const task of isolated){ if(!Array.isArray(task.write_scope)||!task.write_scope.length) errors.push(`${task.id} 缺少 write_scope`); if(!Array.isArray(task.verification)||!task.verification.length) errors.push(`${task.id} 缺少 verification`); if(!task.risk) errors.push(`${task.id} 缺少 risk`); }
    for(let i=0;i<isolated.length;i++) for(let j=i+1;j<isolated.length;j++) if(!(isolated[i].depends_on??[]).includes(isolated[j].id)&&!(isolated[j].depends_on??[]).includes(isolated[i].id)&&(isolated[i].write_scope??[]).some(a=>(isolated[j].write_scope??[]).some(b=>overlap(a,b)))) errors.push(`${isolated[i].id} 與 ${isolated[j].id} 的 write_scope 重疊`);
    return result('併行任務安全欄位',errors.length===0,errors.length?errors.join('；'):`${isolated.length} 個 isolated 任務均具備範圍、風險與驗證定義`);
  } catch(e){ return result('併行任務安全欄位',false,e.message); }
}

function documentCheck(project,phase) {
  const rules={requirements_gate:['docs/requirements/REQUIREMENTS.md','docs/PRD.md'],architecture_gate:['docs/architecture/ARCHITECTURE.md'],specification_gate:['docs/specs'],planning_gate:['docs/IMPLEMENTATION_PLAN.md']};
  const targets=rules[phase]??[], checks=[];
  for(const rel of targets){ const p=path.join(project,rel); if(!fs.existsSync(p)) { checks.push(result(`必要文件 ${rel}`,false,'檔案或目錄不存在')); continue; } const stat=fs.statSync(p); if(stat.isDirectory()){ const files=fs.readdirSync(p).filter(f=>f.endsWith('.md')&&f!=='README.md'); checks.push(result(`規格文件 ${rel}`,files.length>0,files.length?`${files.length} 份規格`:'沒有 README.md 以外的規格文件')); } else { const text=fs.readFileSync(p,'utf8'), incomplete=documentHasPlaceholder(text); checks.push(result(`文件完整性 ${rel}`,text.trim().length>150&&!incomplete,incomplete?'仍含未填寫的 placeholder 行':`內容長度 ${text.trim().length}`)); } }
  return checks;
}

function projectCommands(project,phase) {
  if(!['implementation_gate','qa'].includes(phase)) return [];
  const packagePath=path.join(project,'package.json'); if(!fs.existsSync(packagePath)) return [];
  const pkg=readJson(packagePath), scripts=pkg.scripts??{}, manager=fs.existsSync(path.join(project,'pnpm-lock.yaml'))?'pnpm':fs.existsSync(path.join(project,'yarn.lock'))?'yarn':'npm';
  const names=['lint','typecheck','test','build'].filter(n=>scripts[n]);
  const commands=names.map(name=>({name:`${manager} ${name}`,cmd:manager,args:manager==='npm'?['run',name]:[name],cwd:project}));
  const workspacePatterns=Array.isArray(pkg.workspaces)?pkg.workspaces:Array.isArray(pkg.workspaces?.packages)?pkg.workspaces.packages:[];
  for(const pattern of workspacePatterns){
    if(/[*!?{}[\]]/.test(pattern)) continue;
    const cwd=path.join(project,pattern),workspacePackage=path.join(cwd,'package.json'); if(!fs.existsSync(workspacePackage)) continue;
    const workspaceScripts=readJson(workspacePackage).scripts??{};
    for(const name of ['lint','typecheck','test','build'].filter(item=>workspaceScripts[item])) commands.push({name:`${manager} ${pattern} ${name}`,cmd:manager,args:manager==='npm'?['run',name]:[name],cwd});
  }
  return commands;
}

export function runQualityGate(project,phase) {
  const checks=[];
  for(const rel of ['.ai/PROJECT_STATE.json','.ai/TASK_GRAPH.json','.ai/AUTODEV_CONFIG.json','.ai/INPUT_INDEX.json']) { try { const value=readJson(path.join(project,rel)),error=validateControllerJson(rel,value); checks.push(result(`JSON ${rel}`,!error,error??'格式與必要結構有效')); } catch(e){ checks.push(result(`JSON ${rel}`,false,e.message)); } }
  const diff=run('git',['diff','--check'],project,120000); checks.push(result('Git whitespace 檢查',diff.status===0,diff.stdout||diff.stderr||'無 whitespace 錯誤'));
  const untracked=run('git',['ls-files','--others','--exclude-standard','-z'],project,120000),badUntracked=String(untracked.stdout??'').split('\0').filter(Boolean).filter(rel=>{ try{return fs.readFileSync(path.join(project,rel),'utf8').split(/\r?\n/).some(line=>/[ \t]+$/.test(line));}catch{return false;} });
  checks.push(result('未追蹤檔 whitespace 檢查',badUntracked.length===0,badUntracked.length?badUntracked.join('、'):'無 whitespace 錯誤'));
  if(['planning_gate','implementation_gate','qa'].includes(phase)) checks.push(taskGraphCheck(project));
  if(phase==='planning_gate') checks.push(parallelTaskCheck(project));
  checks.push(...documentCheck(project,phase));
  if(['implementation_gate','qa'].includes(phase)){
    const loaded=loadQualityContract(project); checks.push(result('Versioned Quality Contract',loaded.ok,loaded.ok?'schema、argv、timeout 與必要 capability 有效':loaded.error));
    if(loaded.ok) for(const c of qualityContractCommands(project,loaded.contract)){
      if(c.prerequisite_error){ checks.push(result(c.name,false,c.prerequisite_error)); continue; }
      const r=run(c.cmd,c.args,c.cwd,c.timeout); checks.push(result(c.name,r.status===0,r.stdout||r.stderr||`結束代碼 ${r.status}`));
    }
  } else for(const c of projectCommands(project,phase)){ const r=run(c.cmd,c.args,c.cwd??project); checks.push(result(c.name,r.status===0,r.stdout||r.stderr||`結束代碼 ${r.status}`)); }
  if(['implementation_gate','qa'].includes(phase)){ try { const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')), left=graph.tasks.filter(t=>!String(t.id).startsWith('REQ-')&&!taskComplete(t)); checks.push(result('開發任務完成度',left.length===0,left.length?`尚有 ${left.length} 個未完成任務：${left.map(t=>t.id).join(', ')}`:'所有開發任務皆已完成')); } catch{} }
  return {ok:checks.every(c=>c.ok),phase,checks};
}
