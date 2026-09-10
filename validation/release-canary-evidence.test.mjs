import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMigrationInventory } from '../lib/migration-inventory.mjs';
import { buildMigrationPlan,createMigrationBackup,finalizeMigrationBackup,rollbackMigration } from '../lib/workflow-migration.mjs';
import { writeJsonDurable } from '../lib/soak-evidence-chain.mjs';

const controllerRoot=fileURLToPath(new URL('..',import.meta.url)),root=fs.mkdtempSync(path.join(os.tmpdir(),'release-canary-'));
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const git=(cwd,...args)=>{const result=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const init=(name,state=null)=>{const project=path.join(root,name);fs.mkdirSync(path.join(project,'.ai','transactions'),{recursive:true});fs.writeFileSync(path.join(project,'product.txt'),'product');if(state)for(const [relative,value]of Object.entries(state)){const file=path.join(project,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));}git(project,'init','-q');git(project,'config','user.name','Release Canary');git(project,'config','user.email','release-canary@example.invalid');git(project,'add','.');git(project,'commit','-qm','fixture');return project;};
try{
  const cases=[];
  const fresh=init('fresh'),freshHead=git(fresh,'rev-parse','HEAD'),freshProduct=digest(fs.readFileSync(path.join(fresh,'product.txt'))),freshInventory=buildMigrationInventory(fresh),freshPlan=buildMigrationPlan(fresh);assert.equal(freshPlan.blocked,false);assert.equal(git(fresh,'rev-parse','HEAD'),freshHead);assert.equal(digest(fs.readFileSync(path.join(fresh,'product.txt'))),freshProduct);cases.push({id:'fresh',outcome:'DRY_RUN_READY',inventory_sha256:freshInventory.inventory_sha256,head:freshHead});
  const legacy=init('legacy',{'.ai/AUTODEV_CONFIG.json':{schema_version:1,model:'sonnet'},'.ai/PROJECT_STATE.json':{schema_version:1,phase:'qa',input_revision:7}}),legacyHead=git(legacy,'rev-parse','HEAD'),legacyInventory=buildMigrationInventory(legacy),backup=createMigrationBackup(legacy,{id:'2026-09-10T00-00-00.000Z'});fs.writeFileSync(path.join(legacy,'.ai','PROJECT_STATE.json'),JSON.stringify({schema_version:1,phase:'complete',input_revision:8}));finalizeMigrationBackup(legacy,backup.migration_id);assert.equal(rollbackMigration(legacy,backup.migration_id).status,'ROLLED_BACK');assert.equal(git(legacy,'rev-parse','HEAD'),legacyHead);cases.push({id:'legacy',outcome:'ROLLBACK_VERIFIED',inventory_sha256:legacyInventory.inventory_sha256,head:legacyHead,migration_id:backup.migration_id});
  const hostile=init('dirty-corrupt',{'.ai/PROJECT_STATE.json':'{truncated'});fs.writeFileSync(path.join(hostile,'product.txt'),'user-dirty-change');fs.writeFileSync(path.join(hostile,'untracked-user.txt'),'preserve-me');const product=digest(fs.readFileSync(path.join(hostile,'product.txt'))),untracked=digest(fs.readFileSync(path.join(hostile,'untracked-user.txt'))),hostileInventory=buildMigrationInventory(hostile),hostilePlan=buildMigrationPlan(hostile);assert.ok(hostilePlan.actions.some(action=>action.action==='quarantine_corrupt_artifact'));assert.equal(digest(fs.readFileSync(path.join(hostile,'product.txt'))),product);assert.equal(digest(fs.readFileSync(path.join(hostile,'untracked-user.txt'))),untracked);cases.push({id:'dirty-corrupt',outcome:'EXPECTED_FAIL_CLOSED',inventory_sha256:hostileInventory.inventory_sha256,head:hostileInventory.head});
  const branch=process.env.RELEASE_CANDIDATE_EXPECTED_BRANCH??'fixture',head=process.env.RELEASE_CANDIDATE_EXPECTED_HEAD??'fixture',receipt={schema_version:1,kind:'release_canary_matrix',ok:true,candidate:{branch,head},cases};receipt.sha256=digest(receipt);if(process.env.CANARY_EVIDENCE_OUTPUT)writeJsonDurable(process.env.CANARY_EVIDENCE_OUTPUT,receipt);assert.deepEqual(cases.map(item=>item.outcome),['DRY_RUN_READY','ROLLBACK_VERIFIED','EXPECTED_FAIL_CLOSED']);console.log(JSON.stringify(receipt));
}finally{fs.rmSync(root,{recursive:true,force:true});}
