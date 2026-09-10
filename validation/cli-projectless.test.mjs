import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const controller=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','lib','autodev.mjs');
for(const [id,command,pattern] of [['DT-001','help',/使用方式：page-autodev/],['DT-002','version',/^0\.1\.0\s*$/]]){
  const result=spawnSync(process.execPath,[controller,command],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(result.status,0,`${command} must run without resolving a Project: ${result.stderr}`);
  assert.match(result.stdout,pattern);
  console.log(`DEATH_EVIDENCE ${id} projectless_${command}`);
}
const selfTest=spawnSync(process.execPath,[controller,'self-test'],{cwd:os.tmpdir(),encoding:'utf8'});assert.equal(selfTest.status,0,selfTest.stderr);assert.match(selfTest.stdout,/ARCHITECTURE_DEATH_TESTS_OK/);console.log('DEATH_EVIDENCE DT-003 projectless_architecture_self_test');assert.match(selfTest.stdout,/WORKFLOW_EFFICIENCY_SELF_TEST_OK/);console.log('DEATH_EVIDENCE DT-004 projectless_workflow_self_test');
console.log('CLI_PROJECTLESS_TESTS_OK');
