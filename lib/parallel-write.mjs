import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT=process.env.PAGE_STUDIO_ROOT||path.join(os.homedir(),'page-studio-dev');
const WORKTREE_ROOT=path.join(ROOT,'system','worktrees');
const STATE_ROOT=path.join(ROOT,'system','parallel-state');
const PROTECTED=[
  '.ai/','CLAUDE.md','package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb',
  '.github/','.gitlab-ci.yml','docker-compose.yml','Dockerfile','.env','migrations/','migration/','prisma/schema.prisma'
];
const SAFE_COMMANDS=new Set(['npm','pnpm','yarn','bun']);
const RUNTIME_ONLY=new Set(['.ai/PROJECT_STATE.json','.ai/PHASE_TASK_GRAPH.json','.ai/GATE_FINDINGS.json','.ai/GATE_CACHE.json']);
const now=()=>new Date().toISOString();
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function writeJson(file,value){ fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp.${process.pid}`; fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n'); fs.renameSync(tmp,file); }
function git(cwd,args,timeout=120000){ const result=spawnSync('git',args,{cwd,encoding:'utf8',timeout}); if(result.status!==0) throw new Error(`Git ${args[0]} 失敗：${String(result.stderr||result.stdout).trim()}`); return String(result.stdout||'').trim(); }
function safeId(value){ return String(value).replace(/[^A-Za-z0-9._-]/g,'-').slice(0,80); }
function normalizeScope(value){ return String(value).replaceAll('\\','/').replace(/^\.\//,'').replace(/\/\*\*.*$/,'').replace(/\*.*$/,'').replace(/\/$/,''); }
function scopesOverlap(a,b){ const x=normalizeScope(a),y=normalizeScope(b); return Boolean(x&&y&&(x===y||x.startsWith(`${y}/`)||y.startsWith(`${x}/`))); }
function protectedScope(scope){ const value=normalizeScope(scope); return PROTECTED.some(item=>{ const rule=normalizeScope(item); return value===rule||value.startsWith(`${rule}/`)||rule.startsWith(`${value}/`); }); }
function taskRisk(task){ return String(task.risk??'medium').toLowerCase(); }
function validVerification(task){ return Array.isArray(task.verification)&&task.verification.length>0&&task.verification.every(command=>{ const text=(Array.isArray(command)?command.join(' '):String(command)).trim(); return /^(npm|pnpm|yarn|bun)\s+(run\s+)?(test|lint|typecheck|build)(\s|$)/.test(text)&&!/[;&|`$<>]/.test(text); }); }
function eligible(task,done){
  const scopes=task.write_scope;
  return !String(task.id).startsWith('REQ-')&&['pending','ready','interrupted','repairing'].includes(String(task.status??'pending'))
    &&(task.depends_on??[]).every(id=>done.has(id))&&Array.isArray(scopes)&&scopes.length>0
    &&scopes.every(scope=>normalizeScope(scope)&&!protectedScope(scope))&&validVerification(task)
    &&!['high','critical','高','重大'].includes(taskRisk(task))&&task.parallel_policy!=='serial';
}

const COMPLETE_STATUSES=new Set(['complete','completed','done','passed']);
function taskComplete(task){ return COMPLETE_STATUSES.has(String(task?.status??'').toLowerCase()); }
export function selectParallelWriteBatch(project,config){
  const settings=config.parallel_execution??{};
  if(settings.enabled===false||settings.isolated_write_worktrees===false) return [];
  const graph=readJson(path.join(project,'.ai','TASK_GRAPH.json')),done=new Set(graph.tasks.filter(taskComplete).map(task=>task.id));
  const limit=Math.max(1,Math.min(3,Number(settings.max_concurrency??2))), selected=[];
  for(const task of graph.tasks){
    if(!eligible(task,done)) continue;
    if(selected.some(other=>task.write_scope.some(a=>other.write_scope.some(b=>scopesOverlap(a,b))))) continue;
    selected.push(task); if(selected.length>=limit) break;
  }
  return selected.length>1?selected:[];
}
export function createParallelRun(project,tasks){
  const projectName=path.basename(project),runId=`parallel-${Date.now()}`,base=git(project,['rev-parse','HEAD']);
  if(git(project,['status','--porcelain'])) throw new Error('啟動寫入型併行前，主專案必須先建立 Git checkpoint 並保持乾淨。');
  const root=path.join(WORKTREE_ROOT,projectName,runId); fs.mkdirSync(root,{recursive:true});
  const workers=[];
  for(const task of tasks){
    const id=safeId(task.id),branch=`autodev/${runId}/${id}`,worktree=path.join(root,id);
    git(project,['worktree','add','-b',branch,worktree,base],300000);
    workers.push({task_id:task.id,title:task.title,branch,worktree,status:'ready',write_scope:task.write_scope,verification:task.verification,base_commit:base,created_at:now()});
  }
  const run={schema_version:1,project:projectName,run_id:runId,status:'running',base_commit:base,created_at:now(),updated_at:now(),workers,integration:null};
  writeJson(path.join(STATE_ROOT,projectName,`${runId}.json`),run); writeJson(path.join(STATE_ROOT,projectName,'CURRENT.json'),run); return run;
}
export function updateParallelRun(run){ run.updated_at=now(); const dir=path.join(STATE_ROOT,run.project); writeJson(path.join(dir,`${run.run_id}.json`),run); writeJson(path.join(dir,'CURRENT.json'),run); }
function changedFiles(worker){ return git(worker.worktree,['diff','--name-only',`${worker.base_commit}...HEAD`]).split(/\r?\n/).filter(Boolean); }
export function meaningfulProjectChanges(project){ return git(project,['status','--porcelain=v1','-z','--untracked-files=all']).split('\0').filter(Boolean).map(entry=>entry[2]===' '?entry.slice(3):entry[1]===' '?entry.slice(2):entry).map(entry=>entry.split(' -> ').pop().replaceAll('\\','/')).filter(file=>!RUNTIME_ONLY.has(file)&&!file.startsWith('.ai/logs/')&&!file.endsWith('.lock')); }
function withinScope(file,scopes){ return scopes.some(scope=>{ const value=normalizeScope(scope); return file===value||file.startsWith(`${value}/`); }); }
export function finalizeWorker(worker,summary,evidence,identity={}){
  const taskGraph='.ai/TASK_GRAPH.json';
  const touchedTaskGraph=git(worker.worktree,['status','--porcelain','--',taskGraph]);
  if(touchedTaskGraph) git(worker.worktree,['restore','--staged','--worktree','--',taskGraph]);
  const status=git(worker.worktree,['status','--porcelain']);
  if(!status){ worker.commit=worker.base_commit; worker.changed_files=[]; worker.summary=summary; worker.evidence=evidence; worker.status='candidate_ready'; worker.completed_at=now(); worker.noop=true; return worker; }
  git(worker.worktree,['diff','--check']); git(worker.worktree,['add','-A']);
  const staged=git(worker.worktree,['diff','--cached','--name-only']).split(/\r?\n/).filter(Boolean);
  const outside=staged.filter(file=>!withinScope(file,worker.write_scope)||protectedScope(file));
  if(outside.length) throw new Error(`${worker.task_id} 修改超出允許範圍：${outside.join('、')}`);
  git(worker.worktree,['config','user.name',identity.name??'Page Studio Autodev']); git(worker.worktree,['config','user.email',identity.email??'autodev@page-studio.local']);
  git(worker.worktree,['commit','-m',`feat(autodev): ${worker.task_id} ${worker.title}`],300000);
  worker.commit=git(worker.worktree,['rev-parse','HEAD']); worker.changed_files=changedFiles(worker); worker.summary=summary; worker.evidence=evidence; worker.status='candidate_ready'; worker.completed_at=now(); return worker;
}
function commandArgs(command){
  const parts=Array.isArray(command)?command.map(String):String(command).trim().split(/\s+/);
  if(!SAFE_COMMANDS.has(parts[0])||parts.some(part=>/[;&|`$<>]/.test(part))) throw new Error(`不允許的驗證指令：${Array.isArray(command)?command.join(' '):command}`);
  return {cmd:parts[0],args:parts.slice(1)};
}
function verify(worktree,commands){
  const receipts=[];
  for(const command of commands){ const {cmd,args}=commandArgs(command),display=[cmd,...args].join(' '),result=process.platform==='win32'?spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',display],{cwd:worktree,encoding:'utf8',timeout:1200000,env:{...process.env,CI:'1'}}):spawnSync(cmd,args,{cwd:worktree,encoding:'utf8',timeout:1200000,env:{...process.env,CI:'1'}}); const output=[result.stdout,result.stderr,result.error?.message].filter(Boolean).join('\n'); receipts.push({command:display,ok:result.status===0,output:String(output).slice(-4000)}); if(result.status!==0) return {ok:false,receipts}; }
  return {ok:true,receipts};
}
export function linkProjectDependencies(project,worktree){
  const roots=['',...fs.readdirSync(project,{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.name.startsWith('.')).map(item=>item.name)],linked=[];
  for(const rel of roots){ const source=path.join(project,rel,'node_modules'),target=path.join(worktree,rel,'node_modules'); if(!fs.existsSync(source)||fs.existsSync(target)) continue; fs.mkdirSync(path.dirname(target),{recursive:true}); fs.symlinkSync(source,target,'dir'); linked.push(rel?`${rel}/node_modules`:'node_modules'); }
  return linked;
}
export function integrateParallelRun(project,run,config){
  run.integration_attempt=(run.integration_attempt??0)+1;
  const suffix=String(run.integration_attempt).padStart(2,'0'),root=path.dirname(run.workers[0].worktree),integrationBranch=`autodev/${run.run_id}/integration-${suffix}`,integrationPath=path.join(root,`integration-${suffix}`),integrationBase=git(project,['rev-parse','HEAD']);
  git(project,['worktree','add','-b',integrationBranch,integrationPath,integrationBase],300000);
  const dependencyLinks=linkProjectDependencies(project,integrationPath);
  run.integration={branch:integrationBranch,worktree:integrationPath,status:'integrating',dependency_links:dependencyLinks,receipts:[]}; updateParallelRun(run);
  for(const worker of run.workers){
    if(!worker.noop) git(integrationPath,['cherry-pick',worker.commit],300000); worker.integrated_commit=git(integrationPath,['rev-parse','HEAD']); worker.status='verifying'; updateParallelRun(run);
    const receipt=verify(integrationPath,worker.verification); run.integration.receipts.push({task_id:worker.task_id,...receipt});
    if(!receipt.ok){ worker.status='verification_failed'; run.status='failed'; run.integration.status='failed'; updateParallelRun(run); return {ok:false,reason:`${worker.task_id} 整合後驗證失敗`,worker,receipt}; }
    worker.status='integrated'; updateParallelRun(run);
  }
  return finishIntegratedParallelRun(project,run);
}
export function finishIntegratedParallelRun(project,run){
  const meaningful=meaningfulProjectChanges(project); if(meaningful.length) throw new Error(`整合完成前主專案出現未提交的實質變更：${meaningful.join('、')}，已停止快轉以避免覆寫。`);
  git(project,['merge','--ff-only',run.integration.branch],300000);
  const graphFile=path.join(project,'.ai','TASK_GRAPH.json'),graph=readJson(graphFile);
  for(const worker of run.workers){ const task=graph.tasks.find(item=>item.id===worker.task_id); if(task){ task.status='complete'; task.completed_at=now(); task.commit=worker.integrated_commit; task.source_commit=worker.commit; task.evidence=[...(task.evidence??[]),...(worker.evidence??[]),...run.integration.receipts.find(item=>item.task_id===worker.task_id).receipts.map(item=>`${item.command}：通過`)]; } worker.status='complete'; }
  writeJson(graphFile,graph); run.status='complete'; run.integration.status='complete'; run.completed_at=now(); updateParallelRun(run);
  return {ok:true,run};
}
export function currentParallelStatus(project){ const file=path.join(STATE_ROOT,path.basename(project),'CURRENT.json'); try{return readJson(file);}catch{return null;} }
