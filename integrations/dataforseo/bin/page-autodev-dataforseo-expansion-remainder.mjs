import crypto from 'node:crypto';
import fs from 'node:fs';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {dispatchKeywordIdeasExpansion} from '../lib/expansion-dispatch.mjs';
import {validateLiveExpansionPlan,atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';
import {requestFingerprint} from '../lib/dataforseo-contract.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_EXPANSION_REQUIRED');
const data='/var/lib/page-autodev/dataforseo',approvalFile='/etc/page-autodev/credentials/dataforseo-expansion-remainder-approval.json';
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));
const seeds=Object.keys(JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-topic-profiles.json',import.meta.url),'utf8')));
const plan=validateLiveExpansionPlan({plan:JSON.parse(fs.readFileSync(`${data}/candidate-expansion-plan-v1.json`,'utf8')),shadow_bytes:fs.readFileSync(`${data}/calibration-60-v3-shadow.json`),seeds,registry});
const requests=plan.requests.slice(1),remainingMax=57600;
if(plan.requests.length!==5||requests.length!==4||plan.max_microusd!==72000||requests.some(request=>request.keywords[0]==='網站架設'))throw new Error('REMAINDER_SCOPE_INVALID');
const stat=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
const allowed=new Set(['schema_version','approval_id','expires_at','plan_sha256','request_batch_sha256','original_lease_id','original_provider_task_id','task_count','offset','per_seed_limit','max_microusd']);
if((stat.mode&0o777)!==0o600||stat.uid!==0||Object.keys(approval).some(key=>!allowed.has(key))||approval.schema_version!==1||!/^expansion-remainder-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=Date.now()||Date.parse(approval.expires_at)>Date.now()+15*60*1000||approval.plan_sha256!==plan.plan_sha256||approval.request_batch_sha256!==requestFingerprint(requests)||approval.task_count!==4||approval.offset!==20||approval.per_seed_limit!==20||approval.max_microusd!==remainingMax||!/^[a-f0-9]{64}$/.test(approval.original_lease_id??'')||typeof approval.original_provider_task_id!=='string')throw new Error('REMAINDER_APPROVAL_INVALID');
if(fs.existsSync(`${data}/candidate-expansion-remainder-results-v1.json`)||fs.existsSync(`${data}/candidate-expansion-remainder-checkpoint-v1.json`)||fs.existsSync(`${data}/candidate-expansion-remainder-failure-v1.json`))throw new Error('REMAINDER_ALREADY_ATTEMPTED');
registry.activation='canary';
const day=new Date().toISOString().slice(0,10),project_id=`dataforseo-expansion-remainder-${approval.approval_id}`;
const ledger=new DurableSpendLedger({file:`${data}/spend-ledger.json`,daily_cap_microusd:100000});
const original=(await ledger.snapshot()).find(row=>row.lease_id===approval.original_lease_id);
if(original?.status!=='SETTLED'||original.fingerprint!==plan.request_batch_sha256||original.actual_microusd!==14400||original.reconciliation?.provider_task_id!==approval.original_provider_task_id||original.reconciliation?.reason!=='PROVIDER_COST_CONFIRMED'||original.reserved_microusd!==72000)throw new Error('ORIGINAL_TASK_NOT_CONFIRMED');
if(original.actual_microusd+remainingMax>original.reserved_microusd)throw new Error('ORIGINAL_BUDGET_EXCEEDED');
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);
const usage_reader=async()=>{
  const rows=await ledger.snapshot(),month=day.slice(0,7),cost=row=>row.status!=='REJECTED'?(row.actual_microusd??row.reserved_microusd):0;
  const sum=predicate=>rows.filter(predicate).reduce((total,row)=>total+cost(row),0);
  return {project_day_used_microusd:sum(row=>row.project_id===project_id&&row.day===day),global_day_used_microusd:sum(row=>row.day===day),global_month_used_microusd:sum(row=>row.day.startsWith(month))};
};
const gateway=new BillingGateway({ledger,registry,budget_policy:{per_request_microusd:remainingMax,per_project_daily_microusd:remainingMax,global_daily_microusd:100800,global_monthly_microusd:500000},usage_reader,activation_mode:'canary'});
let lease,dispatched=false;
try{
  const admission=await gateway.authorize({capability:'keyword_ideas_expansion',request:requests,estimated_microusd:remainingMax,project_id,day});
  if(!admission.ok)throw new Error(`ADMISSION:${admission.reason}`);
  lease=admission.lease;
  const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64');
  const authority=createDataForSeoAssertionAuthority({secret}),request_id=`expansion:${crypto.randomUUID()}`,path='/v3/dataforseo_labs/google/keyword_ideas/live';
  await ledger.markDispatched(lease.lease_id,request_id);dispatched=true;
  const dispatch=await dispatchKeywordIdeasExpansion({requests,path,lease_id:lease.lease_id,request_id,authority,client:createDataForSeoUnixClient(),expected_task_count:4,on_task:async state=>atomicExpansionArtifact(`${data}/candidate-expansion-remainder-checkpoint-v1.json`,{...state,lease_id:lease.lease_id,request_id,plan_sha256:plan.plan_sha256,original_lease_id:approval.original_lease_id})});
  if(dispatch.actual_microusd>remainingMax)throw Object.assign(new Error('ACTUAL_COST_OUT_OF_BOUNDS'),{known_microusd:null});
  atomicExpansionArtifact(`${data}/candidate-expansion-remainder-results-v1.json`,{schema_version:1,retrieved_at:new Date().toISOString(),plan_sha256:plan.plan_sha256,original_lease_id:approval.original_lease_id,lease_id:lease.lease_id,actual_microusd:dispatch.actual_microusd,envelope:dispatch.envelope});
  await ledger.settle(lease.lease_id,dispatch.actual_microusd);
  fs.unlinkSync(`${data}/candidate-expansion-remainder-checkpoint-v1.json`);
  console.log(JSON.stringify({ok:true,actual_microusd:dispatch.actual_microusd,lease_id:lease.lease_id,task_count:dispatch.envelope.tasks.length}));
}catch(error){
  if(lease){
    if(dispatched&&Number.isSafeInteger(error.known_microusd)&&error.known_microusd>=0)await ledger.settle(lease.lease_id,error.known_microusd).catch(()=>ledger.markUnknown(lease.lease_id));
    else await ledger.markUnknown(lease.lease_id);
  }
  try{
    const record=lease?(await ledger.snapshot()).find(row=>row.lease_id===lease.lease_id):null;
    atomicExpansionArtifact(`${data}/candidate-expansion-remainder-failure-v1.json`,{
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
