import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildMigrationInventory } from '../lib/migration-inventory.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'migration-inventory-'));
try{
  fs.mkdirSync(path.join(root,'.ai','transactions'),{recursive:true});
  fs.writeFileSync(path.join(root,'.ai','PROJECT_STATE.json'),JSON.stringify({schema_version:1,phase:'qa',input_revision:7,password:'must-not-leak'}));
  fs.writeFileSync(path.join(root,'.ai','TASK_GRAPH.json'),'{"schema_version":1,"tasks":[]}');
  fs.writeFileSync(path.join(root,'.ai','GATE_CACHE.json'),'SECRET_TOKEN=must-not-leak');
  fs.writeFileSync(path.join(root,'.ai','transactions','pending.json'),JSON.stringify({state:'PREPARED'}));
  fs.mkdirSync(path.join(root,'.ai','runtime','work-unit-leases','lease-a'),{recursive:true}); fs.writeFileSync(path.join(root,'.ai','runtime','work-unit-leases','lease-a','lease.json'),'{}');
  for(const args of [['init','-q'],['config','user.name','Migration Test'],['config','user.email','migration@example.invalid'],['add','.'],['commit','-qm','fixture']]) assert.equal(spawnSync('git',args,{cwd:root}).status,0);
  fs.writeFileSync(path.join(root,'dirty.txt'),'dirty');
  const first=buildMigrationInventory(root),second=buildMigrationInventory(root),serialized=JSON.stringify(first);
  assert.equal(first.phase,'qa'); assert.equal(first.input_revision,7); assert.deepEqual(first.dirty_paths,['dirty.txt']);
  assert.equal(first.controller_artifacts.find(item=>item.path==='.ai/GATE_CACHE.json').status,'corrupt');
  assert.equal(first.transactions.states.PREPARED,1); assert.equal(first.leases.count,1); assert.equal(first.inventory_sha256,second.inventory_sha256,'unchanged inventory must be reproducible');
  assert.equal(serialized.includes('must-not-leak'),false,'inventory must never include controller contents or secrets');
}finally{ fs.rmSync(root,{recursive:true,force:true}); }
console.log('MIGRATION_INVENTORY_TESTS_OK');
