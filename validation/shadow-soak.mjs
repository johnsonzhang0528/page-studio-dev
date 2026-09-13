import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendEvidenceDurable,readEvidenceChain,resumeSoak } from '../lib/soak-evidence-chain.mjs';

const controller=fileURLToPath(new URL('../lib/autodev.mjs',import.meta.url));
const controllerRoot=path.resolve(path.dirname(controller),'..');
const projectsRoot=process.env.SHADOW_SOAK_SOURCE_ROOT??path.join(os.homedir(),'page-studio-dev','projects');
const projects=(process.env.SHADOW_SOAK_PROJECTS??'test-project,seo-empire').split(',').map(value=>value.trim()).filter(Boolean);
const durationMs=Number(process.env.SHADOW_SOAK_DURATION_MS??24*60*60*1000);
const intervalMs=Number(process.env.SHADOW_SOAK_INTERVAL_MS??5*60*1000);
const outputPath=process.env.SHADOW_SOAK_OUTPUT??'/tmp/page-autodev-shadow-soak.jsonl';
const resilienceScenarios=(process.env.SHADOW_SOAK_SCENARIOS??'quota,state,durable,parallel,controller,hybrid,isolation,migration').split(',').map(value=>value.trim()).filter(Boolean);
const git=args=>{const result=spawnSync('git',['-C',controllerRoot,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const candidate={branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD'])},expectedBranch=process.env.SHADOW_SOAK_EXPECTED_BRANCH??'',expectedHead=process.env.SHADOW_SOAK_EXPECTED_HEAD??'';
assert.ok(Number.isFinite(durationMs)&&durationMs>=0,'SHADOW_SOAK_DURATION_MS 必須是非負數');
assert.ok(Number.isFinite(intervalMs)&&intervalMs>0,'SHADOW_SOAK_INTERVAL_MS 必須是正數');
assert.ok(expectedBranch&&candidate.branch===expectedBranch,'SHADOW_SOAK_EXPECTED_BRANCH 必須明確匹配目前分支');
assert.ok(/^[a-f0-9]{40}$/.test(expectedHead)&&candidate.head===expectedHead,'SHADOW_SOAK_EXPECTED_HEAD 必須明確匹配目前 commit');

function filesUnder(root){
  const found=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory()) found.push(...filesUnder(full));
    else if(entry.isFile()) found.push(full);
  }
  return found.sort();
}
function manifest(root){
  return filesUnder(root).map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
}
const scenarioCommands={
  quota:['validation/quota-coordinator.test.mjs'],
  state:['validation/state-transition-property.test.mjs'],
  durable:['validation/durable-crash-matrix.test.mjs'],
  parallel:['validation/parallel-crash-matrix.test.mjs'],
  controller:['lib/autodev.mjs','self-test'],
  hybrid:['validation/hybrid-controller-death.test.mjs'],
  isolation:['validation/tool-broker-escape-death.test.mjs'],
  migration:['validation/isolated-project-flows.test.mjs']
};
function runResilienceScenario(name){
  const argv=scenarioCommands[name]; assert.ok(argv,`UNKNOWN_SOAK_SCENARIO:${name}`);
  const scenarioTempRoot=fs.mkdtempSync(path.join(os.tmpdir(),`page-autodev-soak-${name}-`)),started=Date.now();
  try {
    const run=spawnSync(process.execPath,argv,{cwd:controllerRoot,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:{...process.env,TMPDIR:scenarioTempRoot,TMP:scenarioTempRoot,TEMP:scenarioTempRoot}});
    assert.equal(run.error,undefined,`${name} 無法執行：${run.error?.message??''}`);
    assert.equal(run.status,0,`${name} 故障注入失敗：${String(run.stderr||run.stdout).slice(-4000)}`);
    const residue=fs.readdirSync(scenarioTempRoot).filter(entry=>/^page-autodev-/u.test(entry));
    assert.deepEqual(residue,[],`${name} 留下 owned orphan temp workspace：${residue.join(',')}`);
    return {ok:true,elapsed_ms:Date.now()-started};
  } finally { fs.rmSync(scenarioTempRoot,{recursive:true,force:true}); }
}
function evaluateOnce(project){
  const temporaryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-shadow-'));
  assert.ok(path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir())+path.sep));
  try {
    const source=path.join(projectsRoot,project),fixtureHome=path.join(temporaryRoot,'home'),fixture=path.join(fixtureHome,'page-studio-dev','projects',project);
    const sourceBefore=manifest(path.join(source,'.ai'));
    fs.mkdirSync(path.join(fixture,'.git'),{recursive:true});
    fs.cpSync(path.join(source,'.ai'),path.join(fixture,'.ai'),{recursive:true,errorOnExist:true});
    fs.copyFileSync(path.join(source,'CLAUDE.md'),path.join(fixture,'CLAUDE.md'));
    assert.deepEqual(manifest(path.join(source,'.ai')),sourceBefore,`SNAPSHOT_CHANGED：${project} 複製期間來源正在更新`);
    const before=manifest(path.join(fixture,'.ai')),sourceSha256=crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex');
    const run=spawnSync(process.execPath,[controller,'shadow-evaluate',project],{encoding:'utf8',env:{...process.env,HOME:fixtureHome}});
    assert.equal(run.status,0,`${project} shadow-evaluate 失敗：${run.stderr||run.stdout}`);
    const result=JSON.parse(run.stdout),receipt=result.receipt;
    assert.equal(result.ok,true); assert.equal(receipt.project,project); assert.equal(receipt.mode,'shadow');
    assert.equal(receipt.dispatch_allowed,false); assert.equal(receipt.write_allowed,false); assert.equal(receipt.rollback.stop_required,false);
    assert.deepEqual(manifest(path.join(fixture,'.ai')),before,`SHADOW_WRITE_DETECTED：${project} 的拋棄式快照被修改`);
    return {decision_sha256:receipt.decision_sha256,source_sha256:sourceSha256};
  } finally { fs.rmSync(temporaryRoot,{recursive:true,force:true}); }
}
function evaluate(project){
  let lastError;
  for(let attempt=1;attempt<=3;attempt+=1){ try { return evaluateOnce(project); } catch(error) { lastError=error; } }
  throw lastError;
}

const mode='mixed_resilience_disposable_snapshot',configuration={candidate,duration_ms:durationMs,interval_ms:intervalMs,projects,mode,resilience_scenarios:resilienceScenarios};
let records=[],samples=0,accumulatedElapsed=0,stopSignal=null,sleepTimer=null,wakeSleep=null;
if(fs.existsSync(outputPath)&&fs.statSync(outputPath).size>0){records=readEvidenceChain(outputPath);const resumed=resumeSoak(records,configuration);samples=resumed.samples;accumulatedElapsed=resumed.elapsed_ms;appendEvidenceDurable(outputPath,{event:'resume',resumed_at:new Date().toISOString(),candidate,samples,elapsed_ms:accumulatedElapsed},records);}
else appendEvidenceDurable(outputPath,{event:'start',started_at:new Date().toISOString(),...configuration,elapsed_ms:0},records);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopSignal=signal;if(sleepTimer)clearTimeout(sleepTimer);wakeSleep?.();});
const processStartedAt=Date.now(),activeElapsed=()=>accumulatedElapsed+(Date.now()-processStartedAt);
const resources=()=>{const memory=process.memoryUsage(),stat=fs.statfsSync(path.dirname(path.resolve(outputPath)));return {rss_bytes:memory.rss,heap_used_bytes:memory.heapUsed,receipt_bytes:fs.existsSync(outputPath)?fs.statSync(outputPath).size:0,disk_free_ratio:Number(stat.bavail)/Number(stat.blocks),orphan_count:0};};
const sleep=milliseconds=>new Promise(resolve=>{wakeSleep=resolve;sleepTimer=setTimeout(resolve,milliseconds);}).finally(()=>{sleepTimer=null;wakeSleep=null;});
try {
  while(true){
    if(stopSignal){appendEvidenceDurable(outputPath,{event:'interrupted',interrupted_at:new Date().toISOString(),candidate,signal:stopSignal,samples,elapsed_ms:activeElapsed()},records);console.log(JSON.stringify({ok:true,interrupted:true,signal:stopSignal,samples,elapsed_ms:activeElapsed(),output:outputPath},null,2));break;}
    const decisions=Object.fromEntries(projects.map(project=>[project,evaluate(project)]));
    const resilience=Object.fromEntries(resilienceScenarios.map(name=>[name,runResilienceScenario(name)]));
    samples+=1; appendEvidenceDurable(outputPath,{event:'sample',at:new Date().toISOString(),sample:samples,elapsed_ms:activeElapsed(),decisions,resilience,resources:resources()},records);
    if(stopSignal){appendEvidenceDurable(outputPath,{event:'interrupted',interrupted_at:new Date().toISOString(),candidate,signal:stopSignal,samples,elapsed_ms:activeElapsed()},records);console.log(JSON.stringify({ok:true,interrupted:true,signal:stopSignal,samples,elapsed_ms:activeElapsed(),output:outputPath},null,2));break;}
    const remaining=durationMs-activeElapsed(); if(remaining<=0){appendEvidenceDurable(outputPath,{event:'complete',completed_at:new Date().toISOString(),candidate,samples,elapsed_ms:activeElapsed(),ok:true},records);console.log(JSON.stringify({ok:true,samples,elapsed_ms:activeElapsed(),output:outputPath},null,2));break;}
    await sleep(Math.min(intervalMs,remaining));
  }
} catch(error) {
  appendEvidenceDurable(outputPath,{event:'failed',failed_at:new Date().toISOString(),candidate,samples,elapsed_ms:activeElapsed(),ok:false,error:error.message},records);
  console.error(error.stack??error.message); process.exitCode=1;
}
