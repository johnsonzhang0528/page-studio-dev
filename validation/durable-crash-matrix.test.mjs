import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalJson, pendingTransactions } from '../lib/transactions.mjs';

const worker=new URL('./durable-crash-worker.mjs',import.meta.url),stages=['after_write','after_file_fsync','after_rename','after_directory_fsync'];
for(const stage of stages){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`durable-state-${stage}-`)),target=path.join(root,'PROJECT_STATE.json'),old=canonicalJson({schema_version:1,value:'old'}),next=canonicalJson({schema_version:1,value:'new',padding:'x'.repeat(4096)});
  try {
    fs.writeFileSync(target,old); const child=spawnSync(process.execPath,[worker.pathname,'state',target,stage]); assert.equal(child.signal,'SIGKILL',`${stage} 必須由真實 SIGKILL 中止`);
    const actual=fs.readFileSync(target,'utf8'); assert.ok(actual===old||actual===next,`${stage} 後權威 state 只能是完整舊版或完整新版`); JSON.parse(actual);
    assert.equal(actual,stages.indexOf(stage)<2?old:next,`${stage} 的 rename 邊界結果不符`);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}

for(const stage of stages){
  const project=fs.mkdtempSync(path.join(os.tmpdir(),`durable-tx-${stage}-`));
  try {
    const child=spawnSync(process.execPath,[worker.pathname,'transaction',project,stage]); assert.equal(child.signal,'SIGKILL',`transaction ${stage} 必須由真實 SIGKILL 中止`);
    const dir=path.join(project,'.ai','transactions'),json=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>name.endsWith('.json')):[];
    assert.equal(json.length,stages.indexOf(stage)<2?0:1,`transaction ${stage} 不得留下 ghost JSON`);
    if(json.length) { const pending=pendingTransactions(project); assert.equal(pending.length,1); assert.equal(pending[0].state,'PREPARED'); assert.equal(pending[0].source_manifest_fingerprint,'CRASH-MATRIX'); }
  } finally { fs.rmSync(project,{recursive:true,force:true}); }
}
console.log(JSON.stringify({ok:true,stages,state_cases:stages.length,transaction_cases:stages.length},null,2));
