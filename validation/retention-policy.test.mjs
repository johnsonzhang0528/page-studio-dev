import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { checkpointPathDecision, checkpointEligiblePath } from '../lib/checkpoint-policy.mjs';
import { saveFindings, loadFindings, findingsArchivePath } from '../lib/gate-findings.mjs';

for(const file of ['.ai/PROJECT_STATE.json','.ai/TASK_GRAPH.json','.ai/telemetry/claude-invocations.jsonl','.ai/handoffs/run.json','.ai/archive/gate-findings.jsonl','docs/architecture/ARCHIFY_EVIDENCE.json','docs/architecture/diagrams/x.visual-check.json','tmp/file.lock','src/app.js.bak']) assert.equal(checkpointEligiblePath(file),false,`${file} 不得進產品 checkpoint`);
for(const file of ['src/app.js','tests/app.test.js','docs/architecture/ARCHITECTURE.md','docs/architecture/diagrams/system-architecture.architecture.json','.ai/AUTODEV_CONFIG.json']) assert.equal(checkpointEligiblePath(file),true,`${file} 是可審查產品變更`);
assert.equal(checkpointPathDecision('.ai/runtime/lease.json').reason,'machine_runtime');

const project=fs.mkdtempSync(path.join(os.tmpdir(),'finding-retention-')); fs.mkdirSync(path.join(project,'.ai'));
const finding=(id,status,updated_at)=>({id,fingerprint:id,status,gate_phase:'architecture_gate',gate_unit:'G',input_revision:1,severity:'medium',category:'test',title:id,summary:id,source_files:[],repair_targets:[],repair_plan:[],acceptance_check:[],strategies:[],updated_at});
const store={schema_version:1,revision:0,findings:[finding('ACTIVE','open','2026-01-01'),finding('OLD','closed','2026-01-01'),finding('NEW','stale','2026-02-01')]};
const result=saveFindings(project,store,{retention:{maxTerminal:1,maxActive:2}}); assert.equal(result.archived,1); assert.deepEqual(loadFindings(project).findings.map(item=>item.id).sort(),['ACTIVE','NEW']);
const archiveBefore=fs.readFileSync(findingsArchivePath(project),'utf8'); saveFindings(project,{...loadFindings(project),findings:[...loadFindings(project).findings,finding('OLD','closed','2026-01-01')]},{retention:{maxTerminal:1,maxActive:2}}); assert.equal(fs.readFileSync(findingsArchivePath(project),'utf8'),archiveBefore,'重播相同 finding 不得重複封存');
const tooMany={schema_version:1,revision:0,findings:[finding('A','open',''),finding('B','repairing',''),finding('C','verifying','')]}; assert.throws(()=>saveFindings(project,tooMany,{retention:{maxTerminal:1,maxActive:2}}),/ACTIVE_FINDINGS_LIMIT_EXCEEDED/);
fs.rmSync(project,{recursive:true,force:true}); console.log('RETENTION_POLICY_TESTS_OK');

for(const fixture of String(process.env.RETENTION_FIXTURE_PROJECTS??'').split(path.delimiter).filter(Boolean)){
  const fixtureStore=loadFindings(fixture),before=fixtureStore.findings.length,result=saveFindings(fixture,fixtureStore,{retention:{maxTerminal:2,maxActive:200}}),after=loadFindings(fixture).findings.length;
  assert.ok(after<=before); console.log(`RETENTION_FIXTURE_OK ${path.basename(fixture)} before=${before} after=${after} archived=${result.archived} active=${result.active}`);
}
