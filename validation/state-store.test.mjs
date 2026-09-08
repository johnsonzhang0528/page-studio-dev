import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readControllerJson, readProjectState } from '../lib/state-store.mjs';
import { runControllerStorePreflight } from '../lib/schema-registry.mjs';

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
  const graphFile=path.join(ai,'TASK_GRAPH.json'); fs.writeFileSync(graphFile,'{"tasks":');
  assert.throws(()=>readControllerJson(project,'.ai/TASK_GRAPH.json'),error=>error.code==='CONTROLLER_STORE_UNRECOVERABLE');
  assert.equal(fs.readdirSync(path.join(ai,'quarantine','corrupt_controller_json')).filter(name=>name.endsWith('.corrupt')).length,1);
  assert.equal(readControllerJson(project,'.ai/PHASE_TASK_GRAPH.json',{required:false}),null);
  console.log('STATE_STORE_TESTS_OK');
} finally { fs.rmSync(project,{recursive:true,force:true}); }

const preflightProject=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-store-preflight-'));
try {
  const ai=path.join(preflightProject,'.ai'); fs.mkdirSync(ai);
  fs.writeFileSync(path.join(ai,'PROJECT_STATE.json'),'{"phase":"requirements","status":"ready"}\n');
  fs.writeFileSync(path.join(ai,'TASK_GRAPH.json'),'{"tasks":[]}\n');
  fs.writeFileSync(path.join(ai,'AUTODEV_CONFIG.json'),'{"enabled":true}\n');
  fs.writeFileSync(path.join(ai,'PHASE_TASK_GRAPH.json'),'{"schema_version":2,"phases":{}}\n');
  assert.equal(runControllerStorePreflight(preflightProject).ok,true,'合法 phase graph 不得被 TASK_GRAPH suffix 規則誤判');
  fs.writeFileSync(path.join(ai,'PHASE_TASK_GRAPH.json'),'{"schema_version":1,"phases":[]}\n');
  fs.writeFileSync(path.join(ai,'GATE_FINDINGS.json'),'{"schema_version":1,"findings":{}}\n');
  const preflight=runControllerStorePreflight(preflightProject); assert.equal(preflight.ok,false);
  assert.equal(preflight.checks.filter(check=>!check.ok).length,2,'phase graph 與 findings schema 損壞都必須被偵測');
  assert.equal(fs.readdirSync(path.join(ai,'quarantine','corrupt_controller_json')).filter(name=>name.endsWith('.corrupt')).length,2,'每個損壞 controller store 都必須保存證據');
} finally { fs.rmSync(preflightProject,{recursive:true,force:true}); }
