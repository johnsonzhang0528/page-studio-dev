import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const checks={
  ai_ledger:{argv:['validation/ai-invocation-ledger.test.mjs'],marker:'AI_INVOCATION_LEDGER_TESTS_OK'},
  cli:{argv:['validation/cli-projectless.test.mjs'],marker:'CLI_PROJECTLESS_TESTS_OK'},
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
  hybrid_controller:{argv:['validation/hybrid-controller-death.test.mjs'],marker:'HYBRID_CONTROLLER_DEATH_TESTS_OK'},
  isolated_project_flows:{argv:['validation/isolated-project-flows.test.mjs'],marker:'ISOLATED_PROJECT_FLOWS_OK'},
  fixed_tunnel:{argv:['validation/fixed-egress-tunnel.test.mjs'],marker:'FIXED_EGRESS_TUNNEL_TESTS_OK'},
  billing_egress_tls:{argv:['validation/billing-egress-tls.test.mjs'],marker:'BILLING_EGRESS_TLS_TESTS_OK'},
  billing_egress_unix_client:{argv:['validation/billing-egress-unix-client.test.mjs'],marker:'BILLING_EGRESS_UNIX_CLIENT_TESTS_OK'},
  controller_credential:{argv:['validation/billing-gateway-credential.test.mjs'],marker:'BILLING_GATEWAY_CREDENTIAL_TESTS_OK'},
  shadow_rollout:{argv:['validation/shadow-rollout-validation.test.mjs'],marker:'SHADOW_ROLLOUT_VALIDATION_TESTS_OK'},
  canary_activation:{argv:['validation/canary-activation.test.mjs'],marker:'CANARY_ACTIVATION_TESTS_OK'}
};
const ranges=(from,to,workPackage,executables)=>Array.from({length:to-from+1},(_,index)=>({id:`DT-${String(from+index).padStart(3,'0')}`,work_package:workPackage,executables}));
const cases=[
  ...ranges(1,4,'WP-11',['cli']), ...ranges(5,6,'WP-08',['cache']), ...ranges(7,9,'WP-04',['checkpoint']),
  ...ranges(10,12,'WP-08/WP-01',['cache']), ...ranges(13,16,'WP-03',['subprocess']), ...ranges(17,17,'WP-04',['checkpoint']),
  ...ranges(18,21,'WP-05',['concurrency']), ...ranges(22,24,'WP-06',['durable']), ...ranges(25,27,'WP-07',['quality_contract']),
  ...ranges(28,28,'WP-01',['architecture']), ...ranges(29,30,'WP-10',['parallel']), ...ranges(31,32,'WP-05',['concurrency']),
  ...ranges(33,33,'WP-06',['durable']), ...ranges(34,34,'WP-07/WP-01',['quality']), ...ranges(35,41,'WP-01/WP-02',['architecture']),
  ...ranges(42,44,'WP-09',['findings']), ...ranges(45,45,'WP-01',['mutation']), ...ranges(46,46,'WP-05/WP-12',['concurrency']),
  ...ranges(47,53,'WP-13',['tool_broker_escape']), ...ranges(54,61,'WP-14',['service_isolation']), ...ranges(62,68,'WP-15',['hybrid_controller']), ...ranges(69,76,'WP-16',['isolated_project_flows']), ...ranges(77,82,'WP-17',['fixed_tunnel']), ...ranges(83,89,'WP-18',['controller_credential']), ...ranges(90,90,'WP-17',['fixed_tunnel']), ...ranges(91,91,'WP-17',['billing_egress_tls']), ...ranges(92,92,'WP-17',['billing_egress_unix_client']), ...ranges(93,100,'WP-19',['shadow_rollout']), ...ranges(101,103,'WP-20',['canary_activation']), ...ranges(104,109,'WP-13',['tool_broker_escape']), ...ranges(110,110,'WP-07',['quality']), ...ranges(111,111,'WP-05',['ai_ledger'])
];

assert.equal(cases.length,111);
assert.deepEqual(cases.map(item=>item.id),Array.from({length:111},(_,index)=>`DT-${String(index+1).padStart(3,'0')}`));
const required=[...new Set(cases.flatMap(item=>item.executables))],results=new Map();
for(const name of required){
  const check=checks[name]; assert.ok(check,`UNKNOWN_EXECUTABLE_EVIDENCE:${name}`);
  const run=spawnSync(process.execPath,check.argv,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,env:{...process.env,DEATH_TRACEABILITY_CHILD:'1'}});
  const output=`${run.stdout??''}\n${run.stderr??''}`;
  assert.equal(run.error,undefined,`${name} could not execute: ${run.error?.message??''}`);
  assert.equal(run.status,0,`${name} failed with ${run.status}: ${output.slice(-4000)}`);
  assert.ok(output.includes(check.marker),`${name} success marker missing after real execution: ${check.marker}`);
  results.set(name,{status:run.status,marker:check.marker,output});
}
const evidence=[];
for(const item of cases) for(const name of item.executables){
  const result=results.get(name);assert.equal(result?.status,0,`${item.id} executable evidence failed: ${name}`);
  const pattern=new RegExp(`^DEATH_EVIDENCE ${item.id} ([a-z0-9_]+)$`,'gm'),matches=[...result.output.matchAll(pattern)];
  assert.equal(matches.length,1,`${item.id} must produce exactly one named executable evidence record in ${name}`);
  evidence.push({id:item.id,work_package:item.work_package,executable:name,scenario:matches[0][1]});
}
assert.equal(new Set(evidence.map(item=>item.id)).size,cases.length,'death evidence IDs must be unique');
const git=args=>{const result=spawnSync('git',['-C',root,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
const receipt={schema_version:1,kind:'death_test_evidence_manifest',ok:true,candidate:{branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD'])},total:cases.length,individually_evidenced:evidence.length,executed_checks:required.length,mode:'unique_named_executable_fault_evidence',first:cases[0].id,last:cases.at(-1).id,evidence};receipt.sha256=crypto.createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
if(process.env.DEATH_EVIDENCE_OUTPUT)fs.writeFileSync(process.env.DEATH_EVIDENCE_OUTPUT,`${JSON.stringify(receipt,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify(receipt));
