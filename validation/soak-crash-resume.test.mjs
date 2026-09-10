import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendEvidenceDurable,readEvidenceChain,resumeSoak } from '../lib/soak-evidence-chain.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'soak-crash-')),file=path.join(root,'receipt.jsonl'),configuration={candidate:{branch:'codex/rc',head:'a'.repeat(40)},duration_ms:86400000,interval_ms:300000,projects:['test-project','seo-empire'],mode:'mixed_resilience_disposable_snapshot',resilience_scenarios:['quota','state','durable','parallel','controller','hybrid','isolation','migration']};
try{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./soak-crash-worker.mjs',import.meta.url)),file,JSON.stringify(configuration)],{stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);});child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
  const records=readEvidenceChain(file),resume=resumeSoak(records,configuration);assert.equal(resume.samples,1);assert.equal(resume.elapsed_ms,100);
  appendEvidenceDurable(file,{event:'resume',candidate:configuration.candidate,samples:resume.samples,elapsed_ms:resume.elapsed_ms},records);appendEvidenceDurable(file,{event:'sample',sample:2,elapsed_ms:200,decisions:{},resilience:{},resources:{}},records);
  assert.equal(resumeSoak(readEvidenceChain(file),configuration).samples,2);
  const wrong={...configuration,candidate:{...configuration.candidate,head:'b'.repeat(40)}};assert.throws(()=>resumeSoak(readEvidenceChain(file),wrong),/SOAK_RESUME_CONFIG_MISMATCH:candidate/);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('SOAK_CRASH_RESUME_TESTS_OK');
