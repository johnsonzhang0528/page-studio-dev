import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQualityGate } from '../lib/quality.mjs';

const project=fs.mkdtempSync(path.join(os.tmpdir(),'quality-gate-'));
const ai=path.join(project,'.ai');
fs.mkdirSync(ai);
for(const name of ['PROJECT_STATE','AUTODEV_CONFIG','INPUT_INDEX']) {
  fs.writeFileSync(path.join(ai,`${name}.json`),'{}\n');
}
fs.writeFileSync(path.join(ai,'TASK_GRAPH.json'),JSON.stringify({tasks:[
  {id:'TASK-COMPLETE',title:'complete',status:'complete'},
  {id:'TASK-COMPLETED',title:'completed',status:'completed'},
  {id:'TASK-DONE',title:'done',status:'done'},
  {id:'TASK-PASSED',title:'passed',status:'passed'},
  {id:'REQ-IGNORED',title:'requirement',status:'pending'}
]},null,2));
assert.equal(spawnSync('git',['init','--quiet'],{cwd:project}).status,0);

const receipt=runQualityGate(project,'implementation_gate');
const completion=receipt.checks.find(check=>check.name==='開發任務完成度');
assert.equal(completion?.ok,true,completion?.detail);
assert.equal(completion?.detail,'所有開發任務皆已完成');

const graph=JSON.parse(fs.readFileSync(path.join(ai,'TASK_GRAPH.json'),'utf8'));
graph.tasks.push({id:'TASK-PENDING',title:'pending',status:'pending'});
fs.writeFileSync(path.join(ai,'TASK_GRAPH.json'),JSON.stringify(graph,null,2));
const failed=runQualityGate(project,'implementation_gate').checks.find(check=>check.name==='開發任務完成度');
assert.equal(failed?.ok,false);
assert.match(failed?.detail??'',/TASK-PENDING/);
console.log('QUALITY_GATE_TASK_STATUS_SMOKE_OK');
