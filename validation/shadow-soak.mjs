import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const controller=fileURLToPath(new URL('../lib/autodev.mjs',import.meta.url));
const projectsRoot=path.join(os.homedir(),'page-studio-dev','projects');
const projects=(process.env.SHADOW_SOAK_PROJECTS??'test-project,seo-empire').split(',').map(value=>value.trim()).filter(Boolean);
const durationMs=Number(process.env.SHADOW_SOAK_DURATION_MS??24*60*60*1000);
const intervalMs=Number(process.env.SHADOW_SOAK_INTERVAL_MS??5*60*1000);
const outputPath=process.env.SHADOW_SOAK_OUTPUT??'/tmp/page-autodev-shadow-soak.jsonl';
assert.ok(Number.isFinite(durationMs)&&durationMs>=0,'SHADOW_SOAK_DURATION_MS 必須是非負數');
assert.ok(Number.isFinite(intervalMs)&&intervalMs>0,'SHADOW_SOAK_INTERVAL_MS 必須是正數');

function filesUnder(root){
  const found=[];
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const full=path.join(root,entry.name);
    if(entry.isDirectory()) found.push(...filesUnder(full));
    else if(entry.isFile()) found.push(full);
  }
  return found.sort();
}
function manifest(){
  const result={};
  for(const project of projects){
    const root=path.join(projectsRoot,project,'.ai');
    result[project]=filesUnder(root).map(file=>({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
  }
  return result;
}
function append(record){ fs.appendFileSync(outputPath,`${JSON.stringify(record)}\n`); }
function evaluate(project){
  const run=spawnSync(process.execPath,[controller,'shadow-evaluate',project],{encoding:'utf8'});
  assert.equal(run.status,0,`${project} shadow-evaluate 失敗：${run.stderr||run.stdout}`);
  const result=JSON.parse(run.stdout),receipt=result.receipt;
  assert.equal(result.ok,true); assert.equal(receipt.project,project); assert.equal(receipt.mode,'shadow');
  assert.equal(receipt.dispatch_allowed,false); assert.equal(receipt.write_allowed,false); assert.equal(receipt.rollback.stop_required,false);
  return receipt.decision_sha256;
}

const startedAt=Date.now(),baseline=manifest(); let samples=0;
append({event:'start',started_at:new Date(startedAt).toISOString(),duration_ms:durationMs,interval_ms:intervalMs,projects,baseline_sha256:crypto.createHash('sha256').update(JSON.stringify(baseline)).digest('hex')});
try {
  while(true){
    const decisions=Object.fromEntries(projects.map(project=>[project,evaluate(project)]));
    assert.deepEqual(manifest(),baseline,'SHADOW_WRITE_DETECTED：Project .ai 內容在 soak 期間改變');
    samples+=1; append({event:'sample',at:new Date().toISOString(),sample:samples,decisions});
    const remaining=durationMs-(Date.now()-startedAt); if(remaining<=0) break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,remaining)));
  }
  append({event:'complete',completed_at:new Date().toISOString(),samples,elapsed_ms:Date.now()-startedAt,ok:true});
  console.log(JSON.stringify({ok:true,samples,elapsed_ms:Date.now()-startedAt,output:outputPath},null,2));
} catch(error) {
  append({event:'failed',failed_at:new Date().toISOString(),samples,elapsed_ms:Date.now()-startedAt,ok:false,error:error.message});
  console.error(error.stack??error.message); process.exitCode=1;
}
