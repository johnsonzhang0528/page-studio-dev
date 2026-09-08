import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectState } from '../lib/state-store.mjs';

const project=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-state-store-'));
try {
  const ai=path.join(project,'.ai'); fs.mkdirSync(ai);
  const stateFile=path.join(ai,'PROJECT_STATE.json');
  fs.writeFileSync(stateFile,'{"phase":"requirements","status":"ready"}\n');
  assert.equal(readProjectState(project).phase,'requirements');
  const corrupt=Buffer.from('{"phase":"imple'); fs.writeFileSync(stateFile,corrupt);
  for(let attempt=0;attempt<2;attempt++) assert.throws(()=>readProjectState(project),error=>error.code==='STATE_UNRECOVERABLE'&&error.receipt.sha256.length===64);
  const quarantine=path.join(ai,'quarantine','corrupt-state'),files=fs.readdirSync(quarantine);
  assert.equal(files.filter(name=>name.endsWith('.corrupt')).length,1,'相同損壞內容必須只保存一份證據');
  assert.equal(files.filter(name=>name.endsWith('.receipt.json')).length,1,'相同損壞內容必須只保存一份收據');
  const evidence=fs.readFileSync(path.join(quarantine,files.find(name=>name.endsWith('.corrupt')))); assert.deepEqual(evidence,corrupt);
  const receipt=JSON.parse(fs.readFileSync(path.join(quarantine,files.find(name=>name.endsWith('.receipt.json'))),'utf8'));
  assert.equal(receipt.error_code,'INVALID_JSON'); assert.equal(receipt.kind,'corrupt_project_state'); assert.equal(receipt.bytes,corrupt.length); assert.equal('raw' in receipt,false,'收據不得複製可能含敏感資訊的原始內容');
  fs.writeFileSync(stateFile,'{"phase":"requirements"}\n');
  assert.throws(()=>readProjectState(project),error=>error.code==='STATE_UNRECOVERABLE'&&error.receipt.error_code==='INVALID_STATE_SCHEMA');
  console.log('STATE_STORE_TESTS_OK');
} finally { fs.rmSync(project,{recursive:true,force:true}); }
