import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const worker=new URL('./parallel-crash-worker.mjs',import.meta.url);
const stages=['after_integration_prepared','after_worker_integrated:TASK-A','after_worker_integrated:TASK-B','after_batch_verified','after_fast_forward','after_task_graph'];
for(const stage of stages){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`parallel-crash-${stage.replaceAll(':','-')}-`)),project=path.join(root,'project');
  try{
    const crashed=spawnSync(process.execPath,[worker.pathname,'setup',root,project,stage],{encoding:'utf8'});
    assert.equal(crashed.signal,'SIGKILL',`${stage} 必須由真實 SIGKILL 中止：${crashed.stderr}`);
    for(let restart=0;restart<2;restart++){
      const recovered=spawnSync(process.execPath,[worker.pathname,'recover',root,project],{encoding:'utf8'});
      assert.equal(recovered.status,0,`${stage} 第 ${restart+1} 次恢復失敗：${recovered.stderr}`);
    }
    const state=JSON.parse(fs.readFileSync(path.join(root,'system','parallel-state','project','CURRENT.json'),'utf8'));
    assert.equal(state.status,'cleaned',`${stage} 必須收斂到 cleaned`);
    assert.equal(state.cleanup.failures.length,0,`${stage} cleanup 不得吞掉錯誤`);
    const graph=JSON.parse(fs.readFileSync(path.join(project,'.ai','TASK_GRAPH.json'),'utf8'));
    assert.ok(graph.tasks.every(task=>task.status==='complete'),`${stage} 任務圖必須全部完成`);
    for(const task of graph.tasks) assert.equal(new Set(task.evidence).size,task.evidence.length,`${stage} evidence 不得重複`);
    const worktrees=spawnSync('git',['worktree','list','--porcelain'],{cwd:project,encoding:'utf8'}).stdout.match(/^worktree /gm)??[];
    assert.equal(worktrees.length,1,`${stage} 不得留下 orphan worktree`);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
console.log('DEATH_EVIDENCE DT-029 parallel_integration_crash_converges');
console.log('DEATH_EVIDENCE DT-030 parallel_cleanup_no_orphans');
console.log(JSON.stringify({ok:true,stages,cases:stages.length},null,2));
