import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checks={
  self_test:{argv:['lib/autodev.mjs','self-test'],marker:'WORKFLOW_EFFICIENCY_SELF_TEST_OK'},
  cache:{argv:['validation/gate-artifact-cache.test.mjs'],marker:'GATE_ARTIFACT_CACHE_TESTS_OK'},
  checkpoint:{argv:['validation/git-checkpoint.test.mjs'],marker:'GIT_CHECKPOINT_TESTS_OK'},
  subprocess:{argv:['validation/subprocess-policy.test.mjs'],marker:'SUBPROCESS_POLICY_TESTS_OK'},
  concurrency:{argv:['validation/concurrency-death-tests.mjs'],marker:'CONCURRENCY_DEATH_TESTS_OK'},
  durable:{argv:['validation/durable-crash-matrix.test.mjs'],marker:'"lifecycle_cases": 7'},
  quality_contract:{argv:['validation/quality-contract.test.mjs'],marker:'QUALITY_CONTRACT_TESTS_OK'},
  quality:{argv:['validation/quality.test.mjs'],marker:'QUALITY_GATE_TASK_STATUS_SMOKE_OK'},
  architecture:{argv:['lib/autodev.mjs','self-test'],marker:'ARCHITECTURE_DEATH_TESTS_OK'},
  parallel:{argv:['validation/parallel-crash-matrix.test.mjs'],marker:'"cases": 6'},
  findings:{argv:['validation/gate-findings.test.mjs'],marker:'GATE_FINDINGS_SMOKE_OK'},
  mutation:{argv:['validation/workflow-optimization-mutation.test.mjs'],marker:'"killed": 22'},
  secret:{argv:['validation/secret-scan.test.mjs'],marker:'SECRET_SCAN_TESTS_OK'},
  tool_broker_escape:{argv:['validation/tool-broker-escape-death.test.mjs'],marker:'TOOL_BROKER_ESCAPE_DEATH_TESTS_OK'},
  service_isolation:{argv:['validation/service-isolation-death.test.mjs'],marker:'SERVICE_ISOLATION_DEATH_TESTS_OK'},
  hybrid_controller:{argv:['validation/hybrid-controller-death.test.mjs'],marker:'HYBRID_CONTROLLER_DEATH_TESTS_OK'}
};
const ranges=(from,to,workPackage,executables)=>Array.from({length:to-from+1},(_,index)=>({id:`DT-${String(from+index).padStart(3,'0')}`,work_package:workPackage,executables}));
const cases=[
  ...ranges(1,4,'WP-11',['self_test']), ...ranges(5,6,'WP-08',['cache']), ...ranges(7,9,'WP-04',['checkpoint','architecture']),
  ...ranges(10,12,'WP-08/WP-01',['cache','architecture']), ...ranges(13,16,'WP-03',['subprocess']), ...ranges(17,17,'WP-04',['checkpoint']),
  ...ranges(18,21,'WP-05',['concurrency']), ...ranges(22,24,'WP-06',['durable']), ...ranges(25,27,'WP-07',['quality_contract','quality']),
  ...ranges(28,28,'WP-01',['architecture']), ...ranges(29,30,'WP-10',['parallel']), ...ranges(31,32,'WP-05',['concurrency']),
  ...ranges(33,33,'WP-06',['durable']), ...ranges(34,34,'WP-07/WP-01',['quality']), ...ranges(35,41,'WP-01/WP-02',['architecture','quality']),
  ...ranges(42,44,'WP-09',['findings']), ...ranges(45,45,'WP-01',['mutation']), ...ranges(46,46,'WP-05/WP-12',['concurrency','secret']),
  ...ranges(47,53,'WP-13',['tool_broker_escape']), ...ranges(54,61,'WP-14',['service_isolation']), ...ranges(62,68,'WP-15',['hybrid_controller'])
];

assert.equal(cases.length,68);
assert.deepEqual(cases.map(item=>item.id),Array.from({length:68},(_,index)=>`DT-${String(index+1).padStart(3,'0')}`));
const required=[...new Set(cases.flatMap(item=>item.executables))],results=new Map();
for(const name of required){
  const check=checks[name]; assert.ok(check,`UNKNOWN_EXECUTABLE_EVIDENCE:${name}`);
  const run=spawnSync(process.execPath,check.argv,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:{...process.env,DEATH_TRACEABILITY_CHILD:'1'}});
  const output=`${run.stdout??''}\n${run.stderr??''}`;
  assert.equal(run.error,undefined,`${name} could not execute: ${run.error?.message??''}`);
  assert.equal(run.status,0,`${name} failed with ${run.status}: ${output.slice(-4000)}`);
  assert.ok(output.includes(check.marker),`${name} success marker missing after real execution: ${check.marker}`);
  results.set(name,{status:run.status,marker:check.marker});
}
for(const item of cases) for(const name of item.executables) assert.equal(results.get(name)?.status,0,`${item.id} executable evidence failed: ${name}`);
console.log(JSON.stringify({ok:true,total:cases.length,passed:cases.length,executed_checks:required.length,mode:'executable_fault_evidence',first:cases[0].id,last:cases.at(-1).id}));
