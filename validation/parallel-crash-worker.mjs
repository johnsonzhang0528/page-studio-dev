#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [mode,root,project,stage='never']=process.argv.slice(2);
process.env.PAGE_STUDIO_ROOT=root;
const api=await import('../lib/parallel-write.mjs');
const git=(cwd,args)=>{ const result=spawnSync('git',args,{cwd,encoding:'utf8'}); if(result.status!==0) throw new Error(result.stderr||result.stdout); return String(result.stdout).trim(); };
const faultInjector=current=>{ if(current===stage) process.kill(process.pid,'SIGKILL'); };

if(mode==='setup'){
  fs.mkdirSync(path.join(project,'.ai'),{recursive:true}); fs.mkdirSync(path.join(project,'src'),{recursive:true});
  fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({scripts:{test:'node -e "process.exit(0)"'}},null,2)+'\n');
  const tasks=[
    {id:'TASK-A',title:'A',status:'leased',write_scope:['src/a.txt'],verification:[['npm','run','test']],risk:'low',parallel_policy:'isolated'},
    {id:'TASK-B',title:'B',status:'leased',write_scope:['src/b.txt'],verification:[['npm','run','test']],risk:'low',parallel_policy:'isolated'}
  ];
  fs.writeFileSync(path.join(project,'.ai','TASK_GRAPH.json'),JSON.stringify({tasks},null,2)+'\n');
  git(project,['init','-q']); git(project,['config','user.name','Crash Matrix']); git(project,['config','user.email','crash@example.invalid']); git(project,['add','-A']); git(project,['commit','-qm','base']);
  const run=api.createParallelRun(project,tasks);
  for(const worker of run.workers){ fs.mkdirSync(path.join(worker.worktree,'src'),{recursive:true}); fs.writeFileSync(path.join(worker.worktree,'src',worker.task_id==='TASK-A'?'a.txt':'b.txt'),`${worker.task_id}\n`); api.finalizeWorker(worker,'done',[`${worker.task_id} evidence`]); api.updateParallelRun(run); }
  api.integrateParallelRun(project,run,{}, {faultInjector});
} else if(mode==='recover'){
  const run=api.currentParallelStatus(project);
  if(run?.status!=='cleaned') api.integrateParallelRun(project,run,{});
} else throw new Error(`unknown mode ${mode}`);
