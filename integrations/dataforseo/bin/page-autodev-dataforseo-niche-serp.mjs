import crypto from 'node:crypto';
import fs from 'node:fs';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';
import {validateSerpLiveAdvancedRequest,SERP_LIVE_ADVANCED_ROUTE} from '../lib/dataforseo-serp-contract.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REQUIRED');
const data='/var/lib/page-autodev/dataforseo';
const credential='/etc/page-autodev/credentials/dataforseo-niche-serp-approval.json';
const egressPolicy='/etc/page-autodev/credentials/dataforseo-egress-policy.json';
const marker=`${data}/taiwan-niche-serp-attempt-v1.json`;
const summary=`${data}/taiwan-niche-serp-summary-v1.json`;
const priceFile=new URL('../fixtures/provider-registry.json',import.meta.url);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceBytes=fs.readFileSync(`${data}/taiwan-niche-keyword-review-v2.json`),source=JSON.parse(sourceBytes),sourceSha=sha(sourceBytes);
if(sourceSha!=='8a1ad5ff028579904a5d5fc80d8b8ca996350ca33202dd5ca35af5744caacb7f')throw new Error('APPROVED_SOURCE_CHANGED');
const selected=source.candidates.filter(row=>row.decision==='READY_FOR_SERP_SELECTION').flatMap(row=>row.serp_candidates.map(item=>({topic:row.topic,keyword:item.query})));
if(source.serp_dispatch_authorized!==false||selected.length!==8||new Set(selected.map(row=>row.keyword)).size!==8)throw new Error('PLAN_SCOPE_INVALID');
const requests=selected.map((item,index)=>({keyword:item.keyword,location_code:2158,language_code:'zh-TW',device:'desktop',os:'windows',depth:10,tag:`dfs-serp-calibration-${String(index+21).padStart(2,'0')}`}));
const planSha=sha(Buffer.from(JSON.stringify(requests)));
for(const request of requests)if(!validateSerpLiveAdvancedRequest(request).ok)throw new Error('PLAN_REQUEST_INVALID');
const expectedApproval={schema_version:1,plan_sha256:planSha,source_sha256:sourceSha,task_count:8,max_microusd:16000};

function priorAttempt(){return fs.existsSync(marker)||fs.existsSync(summary)||
  fs.readdirSync('/etc/page-autodev/credentials').some(name=>name.startsWith('dataforseo-niche-serp-approval.json.consumed-'));}

if(process.argv[2]==='--prepare'){
  if(priorAttempt()||fs.existsSync(credential))throw new Error('CANARY_ALREADY_ATTEMPTED_OR_APPROVED');
  const installedPolicy=JSON.parse(fs.readFileSync(egressPolicy,'utf8'));
  if(installedPolicy.activation!=='disabled')throw new Error('EGRESS_NOT_DISABLED');
  const approval={...expectedApproval,approval_id:`serp-${crypto.randomUUID()}`,expires_at:new Date(Date.now()+10*60*1000).toISOString()};
  const fd=fs.openSync(credential,'wx',0o600);
  try{fs.writeSync(fd,`${JSON.stringify(approval)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const canary=JSON.parse(fs.readFileSync(new URL('../deploy/dataforseo-egress-policy.serp-canary.json',import.meta.url),'utf8'));
  canary.expires_at=approval.expires_at;
  const temporary=`${egressPolicy}.${process.pid}.tmp`,policyFd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeSync(policyFd,`${JSON.stringify(canary)}\n`);fs.fsyncSync(policyFd);}finally{fs.closeSync(policyFd);}
  fs.renameSync(temporary,egressPolicy);
  console.log(JSON.stringify({approval_id:approval.approval_id,task_count:8,max_microusd:16000,expires_at:approval.expires_at}));
  process.exit(0);
}
if(process.argv.length!==2)throw new Error('UNKNOWN_COMMAND');
if(priorAttempt())throw new Error('CANARY_ALREADY_ATTEMPTED');
const stat=fs.statSync(credential),approval=JSON.parse(fs.readFileSync(credential,'utf8'));
const keys=new Set([...Object.keys(expectedApproval),'approval_id','expires_at']);
if(stat.uid!==0||(stat.mode&0o777)!==0o600||Object.keys(approval).some(key=>!keys.has(key))||
   Object.entries(expectedApproval).some(([key,value])=>approval[key]!==value)||
   !/^serp-[0-9a-f-]{36}$/.test(approval.approval_id)||
   Date.parse(approval.expires_at)<=Date.now()||Date.parse(approval.expires_at)>Date.now()+10*60*1000)throw new Error('APPROVAL_INVALID');
const activePolicy=JSON.parse(fs.readFileSync(egressPolicy,'utf8'));
if(activePolicy.activation!=='active'||activePolicy.expires_at!==approval.expires_at||
   JSON.stringify(activePolicy.upstream?.paths)!==JSON.stringify([SERP_LIVE_ADVANCED_ROUTE]))throw new Error('SERP_EGRESS_POLICY_MISMATCH');
const registry=JSON.parse(fs.readFileSync(priceFile,'utf8'));registry.activation='canary';
const day=new Date().toISOString().slice(0,10),project_id=`dfs-serp-${approval.approval_id}`;
const ledger=new DurableSpendLedger({file:`${data}/spend-ledger.json`,daily_cap_microusd:16000});
const initial=await ledger.snapshot();
if(initial.some(row=>row.project_id===project_id))throw new Error('EXISTING_SPEND_STATE');
const usage_reader=async()=>{
  const rows=await ledger.snapshot(),month=day.slice(0,7),cost=row=>row.status==='REJECTED'?0:(row.actual_microusd??row.reserved_microusd);
  const sum=predicate=>rows.filter(predicate).reduce((total,row)=>total+cost(row),0);
  return {project_day_used_microusd:sum(row=>row.project_id===project_id&&row.day===day),global_day_used_microusd:sum(row=>row.day===day),global_month_used_microusd:sum(row=>row.day.startsWith(month))};
};
const gateway=new BillingGateway({ledger,registry,budget_policy:{per_request_microusd:2000,per_project_daily_microusd:16000,global_daily_microusd:500000,global_monthly_microusd:5000000},usage_reader,activation_mode:'canary'});
const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64');
const authority=createDataForSeoAssertionAuthority({secret}),client=createDataForSeoUnixClient();
fs.renameSync(credential,`${credential}.consumed-${approval.approval_id}`);
atomicExpansionArtifact(marker,{schema_version:1,approval_id:approval.approval_id,plan_sha256:planSha,source_sha256:sourceSha,started_at:new Date().toISOString(),max_microusd:16000,automatic_retry_allowed:false});
const receipts=[];let failure=null;
for(let index=0;index<requests.length;index++){
  const request=requests[index],output=`${data}/taiwan-niche-serp-result-${String(index+1).padStart(2,'0')}-v1.json`;
  if(fs.existsSync(output)){failure='RESULT_ALREADY_EXISTS';break;}
  const rows=await ledger.snapshot();
  if(rows.some(row=>row.project_id===project_id&&row.status==='UNKNOWN_HOLD')){failure='UNKNOWN_SPEND_HOLD';break;}
  let lease,dispatched=false,knownCost=null;
  try{
    const admission=await gateway.authorize({capability:'serp_live_advanced',request,estimated_microusd:2000,project_id,day});
    if(!admission.ok)throw new Error(`ADMISSION:${admission.reason}`);
    lease=admission.lease;
    const body=Buffer.from(JSON.stringify([request])),body_sha256=sha(body),request_id=`serp:${approval.approval_id}:${index+1}`;
    const gateway_assertion=authority.issue({request_id,body_sha256,lease_id:lease.lease_id,path:SERP_LIVE_ADVANCED_ROUTE});
    await ledger.markDispatched(lease.lease_id,request_id);dispatched=true;
    let raw;try{raw=await client({gateway_assertion,request_id,method:'POST',path:SERP_LIVE_ADVANCED_ROUTE,body,body_sha256,lease_id:lease.lease_id});}
    catch{throw new Error('TRANSPORT_OUTCOME_UNKNOWN');}
    if(raw.status!==200)throw new Error(`HTTP_${raw.status}`);
    let envelope;try{envelope=JSON.parse(raw.body.toString('utf8'));}catch{throw new Error('PROVIDER_JSON_INVALID');}
    const task=Array.isArray(envelope.tasks)&&envelope.tasks.length===1?envelope.tasks[0]:null;
    if(!task||!Number.isFinite(Number(task.cost))||Number(task.cost)<0)throw new Error('PROVIDER_COST_INVALID');
    knownCost=Math.round(Number(task.cost)*1000000);
    atomicExpansionArtifact(output,{schema_version:1,request,lease_id:lease.lease_id,provider_task_id:task.id??null,provider_cost_microusd:knownCost,retrieved_at:new Date().toISOString(),envelope});
    const settlement=await ledger.settle(lease.lease_id,knownCost);
    receipts.push({index:index+1,topic:selected[index].topic,keyword:request.keyword,lease_id:lease.lease_id,provider_task_id:task.id??null,cost_microusd:knownCost,status:settlement.status,organic_count:task.result?.[0]?.items?.filter(item=>item.type==='organic').length??null});
    atomicExpansionArtifact(summary,{schema_version:1,plan_sha256:planSha,approval_id:approval.approval_id,max_microusd:16000,receipts,completed:false});
    if(envelope.status_code!==20000||task.status_code!==20000||knownCost!==2000||settlement.status!=='SETTLED')throw new Error('PROVIDER_RESULT_OR_COST_MISMATCH');
  }catch(error){
    failure=String(error.message).slice(0,200);
    if(lease){try{if(dispatched&&knownCost!==null)await ledger.settle(lease.lease_id,knownCost);else await ledger.markUnknown(lease.lease_id);}catch{failure+=':LEDGER_UPDATE_FAILED';}}
    break;
  }
}
atomicExpansionArtifact(summary,{schema_version:1,plan_sha256:planSha,source_sha256:sourceSha,approval_id:approval.approval_id,max_microusd:16000,receipts,completed:failure===null&&receipts.length===8,failure,automatic_retry_allowed:false});
console.log(JSON.stringify({completed:failure===null&&receipts.length===8,task_count:receipts.length,known_cost_microusd:receipts.reduce((sum,row)=>sum+row.cost_microusd,0),failure}));
if(failure)process.exitCode=1;
