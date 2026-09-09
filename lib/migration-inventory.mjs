import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const CONTROLLER_FILES=Object.freeze(['.ai/PROJECT_STATE.json','.ai/PHASE_TASK_GRAPH.json','.ai/TASK_GRAPH.json','.ai/GATE_FINDINGS.json','.ai/GATE_CACHE.json','.ai/INPUT_INDEX.json','.ai/RELEASE_RISKS.json']);
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const git=(project,args)=>{ const result=spawnSync('git',args,{cwd:project,encoding:'utf8'}); return result.status===0?String(result.stdout??'').trim():null; };
function inspectJson(project,relative){
  const file=path.join(project,relative);
  if(!fs.existsSync(file)) return {path:relative,status:'missing'};
  const raw=fs.readFileSync(file);
  try{
    const value=JSON.parse(raw.toString('utf8'));
    return {path:relative,status:'valid',sha256:sha256(raw),bytes:raw.length,schema_version:value.schema_version??null,revision:value.revision??null};
  }catch{
    return {path:relative,status:'corrupt',sha256:sha256(raw),bytes:raw.length};
  }
}
const jsonNames=directory=>{ try{return fs.readdirSync(directory).filter(name=>name.endsWith('.json')).sort();}catch{return [];} };
const leaseCount=directory=>{ try{return fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&fs.existsSync(path.join(directory,entry.name,'lease.json'))).length;}catch{return 0;} };
export function buildMigrationInventory(project,{runtimeRoot=null,parallelRoot=null}={}){
  const stateFile=path.join(project,'.ai','PROJECT_STATE.json'); let phase=null,inputRevision=null;
  try{ const state=JSON.parse(fs.readFileSync(stateFile,'utf8')); phase=state.phase??null; inputRevision=state.input_revision??null; }catch{}
  const dirty=String(git(project,['status','--porcelain=v1','-z','--untracked-files=all'])??'').split('\0').filter(Boolean).map(entry=>entry.slice(3).split(' -> ').pop().replaceAll('\\','/')).sort();
  const projectId=path.basename(project),transactions=jsonNames(path.join(project,'.ai','transactions'));
  const transactionStates={}; for(const name of transactions){ try{ const item=JSON.parse(fs.readFileSync(path.join(project,'.ai','transactions',name),'utf8')); transactionStates[item.state??'UNKNOWN']=(transactionStates[item.state??'UNKNOWN']??0)+1; }catch{ transactionStates.CORRUPT=(transactionStates.CORRUPT??0)+1; } }
  const leaseDirectory=runtimeRoot??path.join(project,'.ai','runtime','work-unit-leases'),parallelDirectory=parallelRoot??path.join(path.dirname(path.dirname(project)),'system','parallel-state',projectId);
  const artifacts=CONTROLLER_FILES.map(relative=>inspectJson(project,relative));
  const report={schema_version:1,project_id:projectId,head:git(project,['rev-parse','--verify','HEAD']),dirty_paths:dirty,phase,input_revision:inputRevision,controller_artifacts:artifacts,transactions:{total:transactions.length,states:transactionStates},leases:{count:leaseCount(leaseDirectory)},parallel_state:{count:jsonNames(parallelDirectory).length},worktrees:String(git(project,['worktree','list','--porcelain'])??'').split(/\r?\n/).filter(line=>line.startsWith('worktree ')).map(line=>line.slice(9)).sort()};
  report.inventory_sha256=sha256(JSON.stringify(report)); return report;
}
