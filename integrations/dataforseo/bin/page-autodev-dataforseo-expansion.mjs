import crypto from 'node:crypto';
import fs from 'node:fs';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {validateExpansionApproval} from '../lib/canary-approval.mjs';
import {dispatchKeywordIdeasExpansion} from '../lib/expansion-dispatch.mjs';
import {validateLiveExpansionPlan,atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_EXPANSION_REQUIRED');
const data='/var/lib/page-autodev/dataforseo',approvalFile='/etc/page-autodev/credentials/dataforseo-expansion-approval.json';
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));
const seeds=Object.keys(JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-topic-profiles.json',import.meta.url),'utf8')));
const plan=validateLiveExpansionPlan({plan:JSON.parse(fs.readFileSync(`${data}/candidate-expansion-plan-v1.json`,'utf8')),shadow_bytes:fs.readFileSync(`${data}/calibration-60-v3-shadow.json`),seeds,registry});
const stat=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
validateExpansionApproval({approval,mode:stat.mode&0o777,uid:stat.uid,expected_plan_sha256:plan.plan_sha256,expected_request_batch_sha256:plan.request_batch_sha256});
if(fs.existsSync(`${data}/candidate-expansion-results-v1.json`)||fs.existsSync(`${data}/candidate-expansion-checkpoint-v1.json`))throw new Error('EXPANSION_ALREADY_ATTEMPTED');
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);
registry.activation='canary';
const day=new Date().toISOString().slice(0,10),project_id=`dataforseo-expansion-${approval.approval_id}`;
const ledger=new DurableSpendLedger({file:`${data}/spend-ledger.json`,daily_cap_microusd:100000});
const usage_reader=async()=>{
  const rows=await ledger.snapshot(),month=day.slice(0,7),cost=row=>row.status!=='REJECTED'?(row.actual_microusd??row.reserved_microusd):0;
  const sum=predicate=>rows.filter(predicate).reduce((total,row)=>total+cost(row),0);
  return {project_day_used_microusd:sum(row=>row.project_id===project_id&&row.day===day),global_day_used_microusd:sum(row=>row.day===day),global_month_used_microusd:sum(row=>row.day.startsWith(month))};
};
const gateway=new BillingGateway({ledger,registry,budget_policy:{per_request_microusd:72000,per_project_daily_microusd:72000,global_daily_microusd:100800,global_monthly_microusd:500000},usage_reader,activation_mode:'canary'});
let lease,dispatched=false;
try{
  const admission=await gateway.authorize({capability:'keyword_ideas_expansion',request:plan.requests,estimated_microusd:72000,project_id,day});
  if(!admission.ok)throw new Error(`ADMISSION:${admission.reason}`);
  lease=admission.lease;
  const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64');
  const authority=createDataForSeoAssertionAuthority({secret}),request_id=`expansion:${crypto.randomUUID()}`,path='/v3/dataforseo_labs/google/keyword_ideas/live';
  await ledger.markDispatched(lease.lease_id,request_id);dispatched=true;
  const dispatch=await dispatchKeywordIdeasExpansion({requests:plan.requests,path,lease_id:lease.lease_id,request_id,authority,client:createDataForSeoUnixClient(),on_task:async state=>atomicExpansionArtifact(`${data}/candidate-expansion-checkpoint-v1.json`,{...state,lease_id:lease.lease_id,request_id,plan_sha256:plan.plan_sha256})});
  if(dispatch.actual_microusd>72000)throw Object.assign(new Error('ACTUAL_COST_OUT_OF_BOUNDS'),{known_microusd:null});
  atomicExpansionArtifact(`${data}/candidate-expansion-results-v1.json`,{schema_version:1,retrieved_at:new Date().toISOString(),plan_sha256:plan.plan_sha256,lease_id:lease.lease_id,actual_microusd:dispatch.actual_microusd,envelope:dispatch.envelope});
  await ledger.settle(lease.lease_id,dispatch.actual_microusd);
  fs.unlinkSync(`${data}/candidate-expansion-checkpoint-v1.json`);
  console.log(JSON.stringify({ok:true,actual_microusd:dispatch.actual_microusd,lease_id:lease.lease_id,task_count:dispatch.envelope.tasks.length}));
}catch(error){
  if(lease){
    if(dispatched&&Number.isSafeInteger(error.known_microusd)&&error.known_microusd>=0)await ledger.settle(lease.lease_id,error.known_microusd).catch(()=>ledger.markUnknown(lease.lease_id));
    else await ledger.markUnknown(lease.lease_id);
  }
  try{
    const record=lease?(await ledger.snapshot()).find(row=>row.lease_id===lease.lease_id):null;
    atomicExpansionArtifact(`${data}/candidate-expansion-failure-v1.json`,{
      schema_version:1,failed_at:new Date().toISOString(),plan_sha256:plan.plan_sha256,
      lease_id:lease?.lease_id??null,ledger_status:record?.status??null,
      error_code:String(error.message).slice(0,200),
      known_microusd:Number.isSafeInteger(error.known_microusd)?error.known_microusd:null,
      provider_evidence:Array.isArray(error.provider_evidence)?error.provider_evidence:[],
      automatic_retry_allowed:false
    });
  }catch{console.error('EXPANSION_FAILURE_EVIDENCE_WRITE_FAILED');}
  console.error(JSON.stringify({ok:false,error:String(error.message),known_microusd:Number.isSafeInteger(error.known_microusd)?error.known_microusd:null}));
  process.exitCode=1;
}
