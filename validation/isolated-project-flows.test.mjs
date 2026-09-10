import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildMigrationInventory } from '../lib/migration-inventory.mjs';
import { buildMigrationPlan,createMigrationBackup,finalizeMigrationBackup,rollbackMigration } from '../lib/workflow-migration.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'isolated-project-flows-'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git=(project,...args)=>assert.equal(spawnSync('git',args,{cwd:project,stdio:'ignore'}).status,0,args.join(' '));
const init=project=>{fs.mkdirSync(path.join(project,'.ai','transactions'),{recursive:true});fs.writeFileSync(path.join(project,'product.txt'),'product');git(project,'init','-q');git(project,'config','user.name','Isolation Test');git(project,'config','user.email','isolation@example.invalid');git(project,'add','.');git(project,'commit','-qm','fixture');};
try{
  const fresh=path.join(root,'fresh-project');init(fresh);const freshProduct=hash(path.join(fresh,'product.txt')),freshPlan=buildMigrationPlan(fresh);assert.equal(freshPlan.blocked,false);assert.ok(freshPlan.actions.filter(action=>action.action==='initialize_missing_artifact').length>=8);assert.equal(hash(path.join(fresh,'product.txt')),freshProduct);

  const legacy=path.join(root,'legacy-project');init(legacy);fs.writeFileSync(path.join(legacy,'.ai','AUTODEV_CONFIG.json'),JSON.stringify({schema_version:1,model:'sonnet'}));fs.writeFileSync(path.join(legacy,'.ai','PROJECT_STATE.json'),JSON.stringify({schema_version:1,phase:'qa',input_revision:7}));git(legacy,'add','.');git(legacy,'commit','-qm','legacy state');const legacyHead=spawnSync('git',['rev-parse','HEAD'],{cwd:legacy,encoding:'utf8'}).stdout.trim(),backup=createMigrationBackup(legacy,{id:'2026-09-10T00-00-00.000Z'});fs.writeFileSync(path.join(legacy,'.ai','PROJECT_STATE.json'),JSON.stringify({schema_version:1,phase:'complete',input_revision:8}));finalizeMigrationBackup(legacy,backup.migration_id);const rolled=rollbackMigration(legacy,backup.migration_id);assert.equal(rolled.status,'ROLLED_BACK');assert.equal(JSON.parse(fs.readFileSync(path.join(legacy,'.ai','PROJECT_STATE.json'))).input_revision,7);assert.equal(spawnSync('git',['rev-parse','HEAD'],{cwd:legacy,encoding:'utf8'}).stdout.trim(),legacyHead);

  const hostile=path.join(root,'dirty-corrupt-project');init(hostile);fs.writeFileSync(path.join(hostile,'.ai','PROJECT_STATE.json'),'{truncated');fs.writeFileSync(path.join(hostile,'product.txt'),'user-dirty-change');fs.writeFileSync(path.join(hostile,'untracked-user.txt'),'preserve-me');const dirtyBefore=hash(path.join(hostile,'product.txt')),untrackedBefore=hash(path.join(hostile,'untracked-user.txt')),hostileInventory=buildMigrationInventory(hostile),hostilePlan=buildMigrationPlan(hostile);assert.equal(hostileInventory.controller_artifacts.find(item=>item.path==='.ai/PROJECT_STATE.json').status,'corrupt');assert.ok(hostilePlan.actions.some(action=>action.action==='quarantine_corrupt_artifact'&&action.path==='.ai/PROJECT_STATE.json'));assert.ok(hostileInventory.dirty_paths.includes('product.txt')&&hostileInventory.dirty_paths.includes('untracked-user.txt'));assert.equal(hash(path.join(hostile,'product.txt')),dirtyBefore);assert.equal(hash(path.join(hostile,'untracked-user.txt')),untrackedBefore);
  fs.mkdirSync(path.join(hostile,'.ai','runtime','work-unit-leases','active'),{recursive:true});fs.writeFileSync(path.join(hostile,'.ai','runtime','work-unit-leases','active','lease.json'),'{}');assert.equal(buildMigrationPlan(hostile).blocked,true);assert.throws(()=>createMigrationBackup(hostile,{id:'2026-09-10T00-00-01.000Z'}),/MIGRATION_NOT_QUIESCENT/);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('ISOLATED_PROJECT_FLOWS_OK fresh=1 legacy=1 dirty_corrupt=1');
