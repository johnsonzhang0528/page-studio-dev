import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQualityGate } from '../lib/quality.mjs';
import { migrateInputIndexValue, prepareControllerDispatch, validateControllerJson } from '../lib/schema-registry.mjs';

const digest='a'.repeat(64);
const v1={schema_version:1,files:[{original_path:'docs/input/a.md',current_path:'docs/input/brief/a.md',category:'brief',sha256:digest,readable:true}]};
const v2={schema_version:2,files:[{id:'INPUT-001',original_path:'docs/input/b.md',current_path:'docs/input/plans/b.md',category:'plans',sha256:digest,readable:true}]};
assert.equal(validateControllerJson('.ai/INPUT_INDEX.json',v1),null,'production-derived v1 files[] 必須通過');
assert.equal(validateControllerJson('.ai/INPUT_INDEX.json',v2),null,'production-derived v2 files[] 必須通過');
assert.match(validateControllerJson('.ai/INPUT_INDEX.json',{schema_version:3,files:[]}),/支援版本/,'未知 schema 必須 fail closed');
assert.match(validateControllerJson('.ai/INPUT_INDEX.json',{items:[]}),/MIGRATION_REQUIRED/,'legacy items[] 必須要求明確遷移');
const legacy={items:[{original_path:'docs/input/a.md',current_path:'docs/input/a.md',category:'brief',sha256:digest,readable:true}]};
const migrated=migrateInputIndexValue(legacy);
assert.equal(migrated.ok,true); assert.equal(migrated.changed,true); assert.equal(migrated.value.schema_version,1); assert.equal(Array.isArray(migrated.value.files),true); assert.equal('items' in migrated.value,false);
const repeated=migrateInputIndexValue(migrated.value);
assert.equal(repeated.ok,true); assert.equal(repeated.changed,false,'migration 必須冪等');

const preflightProject=fs.mkdtempSync(path.join(os.tmpdir(),'controller-preflight-'));
const preflightAi=path.join(preflightProject,'.ai'); fs.mkdirSync(preflightAi);
fs.writeFileSync(path.join(preflightAi,'PROJECT_STATE.json'),JSON.stringify({status:'running',phase:'requirements'}));
fs.writeFileSync(path.join(preflightAi,'TASK_GRAPH.json'),JSON.stringify({tasks:[]}));
fs.writeFileSync(path.join(preflightAi,'AUTODEV_CONFIG.json'),JSON.stringify({enabled:true}));
fs.writeFileSync(path.join(preflightAi,'INPUT_INDEX.json'),JSON.stringify(legacy));
const prepared=prepareControllerDispatch(preflightProject,{writeMigration:true});
assert.equal(prepared.ok,true); assert.equal(prepared.migration.changed,true); assert.equal(prepared.migration.written,true);
const migratedOnDisk=JSON.parse(fs.readFileSync(path.join(preflightAi,'INPUT_INDEX.json'),'utf8'));
assert.equal(migratedOnDisk.schema_version,1); assert.equal(Array.isArray(migratedOnDisk.files),true);
const preparedAgain=prepareControllerDispatch(preflightProject,{writeMigration:true});
assert.equal(preparedAgain.ok,true); assert.equal(preparedAgain.migration.changed,false,'檔案 migration 第二次必須 no-op');
fs.mkdirSync(path.join(preflightProject,'docs','input'),{recursive:true});fs.writeFileSync(path.join(preflightProject,'docs','input','agent.md'),'agent source');
fs.writeFileSync(path.join(preflightAi,'INPUT_INDEX.json'),JSON.stringify({schema_version:1,files:[{path:'docs/input/agent.md',sha256:null}]}));
const normalized=prepareControllerDispatch(preflightProject,{writeMigration:true});assert.equal(normalized.ok,true);assert.equal(normalized.migration.normalization,'controller_verified_files');
const normalizedFile=JSON.parse(fs.readFileSync(path.join(preflightAi,'INPUT_INDEX.json'),'utf8')).files[0];assert.equal(normalizedFile.original_path,'docs/input/agent.md');assert.equal(normalizedFile.current_path,'docs/input/agent.md');assert.match(normalizedFile.sha256,/^[a-f0-9]{64}$/);assert.equal(normalizedFile.readable,true);
console.log('DEATH_EVIDENCE DT-110 invalid_agent_index_normalized_from_filesystem');
fs.writeFileSync(path.join(preflightAi,'INPUT_INDEX.json'),JSON.stringify({schema_version:99,files:[]}));
const rejected=prepareControllerDispatch(preflightProject,{writeMigration:true});
assert.equal(rejected.ok,false); assert.match(rejected.checks.find(check=>!check.ok)?.detail??'',/支援版本/);
fs.writeFileSync(path.join(preflightAi,'INPUT_INDEX.json'),'{"files":');
const corruptInput=prepareControllerDispatch(preflightProject,{writeMigration:true}); assert.equal(corruptInput.ok,false); assert.ok(corruptInput.migration.quarantine);
assert.equal(fs.readdirSync(path.join(preflightAi,'quarantine','corrupt_controller_json')).filter(name=>name.endsWith('.corrupt')).length>=1,true,'損壞 INPUT_INDEX 必須保存 quarantine 證據');
fs.rmSync(preflightProject,{recursive:true,force:true});

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
console.log('DEATH_EVIDENCE DT-034 incomplete_task_blocks_quality_gate');
console.log('QUALITY_GATE_TASK_STATUS_SMOKE_OK');
