import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const controllerRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),controller=path.join(controllerRoot,'lib','autodev.mjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-canary-command-')),home=path.join(root,'home'),projects=path.join(home,'page-studio-dev','projects');
const git=(cwd,...args)=>{const result=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
function fixture(name,mutate=()=>{}){
  const project=path.join(projects,name);fs.mkdirSync(projects,{recursive:true});fs.cpSync(path.join(controllerRoot,'project-template'),project,{recursive:true});fs.copyFileSync(path.join(controllerRoot,'project-template.gitignore'),path.join(project,'.gitignore'));
  const configPath=path.join(project,'.ai','AUTODEV_CONFIG.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));mutate(config);fs.writeFileSync(configPath,`${JSON.stringify(config,null,2)}\n`);
  for(const file of ['PROJECT_STATE.json','TASK_GRAPH.json']){const p=path.join(project,'.ai',file),text=fs.readFileSync(p,'utf8').replaceAll('__PROJECT_NAME__',name).replaceAll('__CREATED_AT__','2026-09-13T00:00:00Z');fs.writeFileSync(p,text);}
  git(project,'init','-q','-b','main');git(project,'config','user.name','Canary Test');git(project,'config','user.email','canary@example.invalid');git(project,'add','-A');git(project,'commit','-qm','fixture');return {project,configPath};
}
const run=name=>spawnSync(process.execPath,[controller,'activate-canary',name],{cwd:root,encoding:'utf8',env:{...process.env,HOME:home,PAGE_AUTODEV_NO_BACKGROUND:'1'}});
try{
  const safe=fixture('safe'),first=run('safe');assert.equal(first.status,0,first.stderr);const config=JSON.parse(fs.readFileSync(safe.configPath,'utf8'));assert.equal(config.enabled,false);assert.equal(config.allow_deploy,false);assert.equal(config.rollout.mode,'canary');for(const feature of ['quota_coordinator','compact_handoff','architecture_ir','risk_tiered_routing','hybrid_provider','openai_adapter','hybrid_routing'])assert.equal(config.rollout.features[feature],true);console.log('DEATH_EVIDENCE DT-101 canary_preserves_deploy_lock');
  const before=fs.readFileSync(safe.configPath,'utf8'),second=run('safe');assert.equal(second.status,0,second.stderr);assert.equal(fs.readFileSync(safe.configPath,'utf8'),before);console.log('DEATH_EVIDENCE DT-102 canary_activation_idempotent');
  const invalid=fixture('invalid',config=>{config.rollout.features.unknown_escape=true;}),invalidBefore=fs.readFileSync(invalid.configPath,'utf8'),denied=run('invalid');assert.notEqual(denied.status,0);assert.match(denied.stderr,/CANARY_FEATURE_REGISTRY_INVALID/);assert.equal(fs.readFileSync(invalid.configPath,'utf8'),invalidBefore);console.log('DEATH_EVIDENCE DT-103 invalid_registry_no_partial_write');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('CANARY_ACTIVATION_TESTS_OK cases=3');
