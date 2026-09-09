import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ranges=(from,to,workPackage,evidence)=>Array.from({length:to-from+1},(_,index)=>({id:`DT-${String(from+index).padStart(3,'0')}`,work_package:workPackage,evidence}));
const cases=[
  ...ranges(1,4,'WP-11',[['validation/cli-projectless.test.mjs','CLI_PROJECTLESS_TESTS_OK'],['lib/autodev.mjs','WORKFLOW_EFFICIENCY_SELF_TEST_OK']]),
  ...ranges(5,6,'WP-08',[['lib/autodev.mjs','大於 5MB 的同大小同 mtime'],['validation/gate-artifact-cache.test.mjs','GATE_ARTIFACT_CACHE_TESTS_OK']]),
  ...ranges(7,9,'WP-04',[['validation/git-checkpoint.test.mjs','GIT_CHECKPOINT_TESTS_OK'],['lib/architecture-death-tests.mjs','ARCHITECTURE_DEATH_TESTS_OK']]),
  ...ranges(10,12,'WP-08/WP-01',[['lib/autodev.mjs','progress identity'],['lib/gate-execution.mjs','computeGateSourceManifest']]),
  ...ranges(13,16,'WP-03',[['validation/subprocess-policy.test.mjs','SUBPROCESS_POLICY_TESTS_OK'],['validation/release-artifacts.test.mjs','systemd must retain']]),
  ...ranges(17,17,'WP-04',[['validation/git-checkpoint.test.mjs','runtime only']]),
  ...ranges(18,21,'WP-05',[['validation/concurrency-death-tests.mjs','CONCURRENCY_DEATH_TESTS_OK']]),
  ...ranges(22,24,'WP-06',[['validation/durable-crash-matrix.test.mjs','lifecycle_cases']]),
  ...ranges(25,27,'WP-07',[['validation/quality-contract.test.mjs','QUALITY_CONTRACT_TESTS_OK'],['validation/quality.test.mjs','QUALITY_GATE_TASK_STATUS_SMOKE_OK']]),
  ...ranges(28,28,'WP-01',[['lib/architecture-death-tests.mjs','ARCHITECTURE_DEATH_TESTS_OK']]),
  ...ranges(29,30,'WP-10',[['validation/parallel-crash-matrix.test.mjs','after_fast_forward']]),
  ...ranges(31,32,'WP-05',[['validation/concurrency-death-tests.mjs','CONCURRENCY-DEATH-11']]),
  ...ranges(33,33,'WP-06',[['validation/durable-crash-matrix.test.mjs','after_committed']]),
  ...ranges(34,34,'WP-07/WP-01',[['validation/quality.test.mjs','runQualityGate']]),
  ...ranges(35,41,'WP-01/WP-02',[['lib/architecture-death-tests.mjs','ARCHITECTURE_DEATH_TESTS_OK'],['lib/gate-execution.mjs','verifyGateSourceUnchanged']]),
  ...ranges(42,44,'WP-09',[['lib/autodev.mjs','finding instance key'],['lib/gate-findings.mjs','findingInstanceKey']]),
  ...ranges(45,45,'WP-01',[['validation/workflow-optimization-mutation.test.mjs','kill_rate_percent']]),
  ...ranges(46,46,'WP-05/WP-12',[['validation/concurrency-death-tests.mjs','CONCURRENCY_DEATH_TESTS_OK'],['validation/secret-scan.test.mjs','SECRET_SCAN_TESTS_OK']])
];
assert.equal(cases.length,46); assert.deepEqual(cases.map(item=>item.id),Array.from({length:46},(_,index)=>`DT-${String(index+1).padStart(3,'0')}`));
for(const item of cases){ assert.ok(item.work_package.startsWith('WP-')); for(const [relative,marker] of item.evidence){ const file=path.join(root,relative); assert.ok(fs.existsSync(file),`${item.id} evidence missing: ${relative}`); assert.ok(fs.readFileSync(file,'utf8').includes(marker),`${item.id} marker missing: ${relative} :: ${marker}`); } }
console.log(JSON.stringify({ok:true,total:cases.length,passed:cases.length,first:cases[0].id,last:cases.at(-1).id}));
