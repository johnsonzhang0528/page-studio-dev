import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildMigrationPlan, createMigrationBackup, finalizeMigrationBackup, rollbackMigration } from '../lib/workflow-migration.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-migration-'));
try{
  fs.mkdirSync(path.join(root,'.ai','transactions'),{recursive:true}); fs.writeFileSync(path.join(root,'product.txt'),'product-v1');
  for(const [name,value] of [['AUTODEV_CONFIG.json',{schema_version:1,model:'sonnet'}],['PROJECT_STATE.json',{schema_version:1,phase:'qa'}],['TASK_GRAPH.json',{schema_version:1,tasks:[]}],['PHASE_TASK_GRAPH.json',{schema_version:2,phases:{}}]]) fs.writeFileSync(path.join(root,'.ai',name),JSON.stringify(value));
  for(const args of [['init','-q'],['config','user.name','Migration Test'],['config','user.email','migration@example.invalid'],['add','.'],['commit','-qm','fixture']]) assert.equal(spawnSync('git',args,{cwd:root}).status,0);
  const dryRunBefore=fs.readFileSync(path.join(root,'.ai','PROJECT_STATE.json')),plan=buildMigrationPlan(root),dryRunAfter=fs.readFileSync(path.join(root,'.ai','PROJECT_STATE.json')); assert.equal(plan.mode,'dry-run'); assert.deepEqual(dryRunAfter,dryRunBefore,'dry-run must not write controller state');
  const backup=createMigrationBackup(root,{id:'2026-09-09T00-00-00.000Z'}); assert.equal(backup.status,'BACKED_UP');
  fs.writeFileSync(path.join(root,'.ai','AUTODEV_CONFIG.json'),JSON.stringify({schema_version:1,rollout:{mode:'shadow'}})); fs.writeFileSync(path.join(root,'.ai','PROJECT_STATE.json'),JSON.stringify({schema_version:1,phase:'complete'})); fs.writeFileSync(path.join(root,'.ai','GATE_CACHE.json'),JSON.stringify({schema_version:2,entries:{}})); fs.writeFileSync(path.join(root,'product.txt'),'product-user-change');
  assert.equal(finalizeMigrationBackup(root,backup.migration_id).status,'APPLIED'); const rolled=rollbackMigration(root,backup.migration_id);
  assert.equal(rolled.status,'ROLLED_BACK'); assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.ai','PROJECT_STATE.json'))).phase,'qa'); assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.ai','AUTODEV_CONFIG.json'))).model,'sonnet','rollback must restore controller config'); assert.equal(fs.existsSync(path.join(root,'.ai','GATE_CACHE.json')),false); assert.equal(fs.readFileSync(path.join(root,'product.txt'),'utf8'),'product-user-change','rollback must not touch product files or commits');
  fs.mkdirSync(path.join(root,'.ai','runtime','work-unit-leases','active'),{recursive:true}); fs.writeFileSync(path.join(root,'.ai','runtime','work-unit-leases','active','lease.json'),'{}'); assert.throws(()=>createMigrationBackup(root,{id:'2026-09-09T00-00-01.000Z'}),/MIGRATION_NOT_QUIESCENT/);
}finally{ fs.rmSync(root,{recursive:true,force:true}); }
console.log('WORKFLOW_MIGRATION_TESTS_OK');
