import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendEvidenceDurable,readEvidenceChain,resumeSoak,verifyEvidenceChain,writeJsonDurable } from '../lib/soak-evidence-chain.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'soak-chain-')),file=path.join(root,'soak.jsonl'),candidate={branch:'codex/rc',head:'a'.repeat(40)},configuration={candidate,duration_ms:86400000,interval_ms:300000,projects:['test-project','seo-empire'],mode:'mixed_resilience_disposable_snapshot',resilience_scenarios:['quota','state','durable','parallel','controller','hybrid','isolation','migration']},records=[];
appendEvidenceDurable(file,{event:'start',...configuration,elapsed_ms:0},records);appendEvidenceDurable(file,{event:'sample',sample:1,elapsed_ms:1000},records);appendEvidenceDurable(file,{event:'interrupted',signal:'SIGKILL',samples:1,elapsed_ms:1000},records);
assert.deepEqual(readEvidenceChain(file),records);assert.equal(resumeSoak(records,configuration).samples,1);
for(const mutate of [v=>{v[1].sample=2;return v;},v=>{v.splice(1,1);return v;},v=>[v[1],v[0],...v.slice(2)]]){const copy=structuredClone(records),changed=mutate(copy);assert.throws(()=>verifyEvidenceChain(changed),/SOAK_CHAIN_/);}
assert.throws(()=>resumeSoak(records,{...configuration,interval_ms:1}),/SOAK_RESUME_CONFIG_MISMATCH/);
fs.appendFileSync(file,'{"event":');assert.throws(()=>readEvidenceChain(file),/SOAK_EVIDENCE_TORN_TAIL/);
const output=path.join(root,'final.json');writeJsonDurable(output,{ok:true});assert.deepEqual(JSON.parse(fs.readFileSync(output)),{ok:true});if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
fs.rmSync(root,{recursive:true,force:true});console.log('SOAK_EVIDENCE_CHAIN_TESTS_OK');
