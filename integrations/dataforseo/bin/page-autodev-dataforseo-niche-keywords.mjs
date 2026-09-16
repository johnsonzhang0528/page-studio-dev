import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {validateNicheKeywordApproval} from '../lib/canary-approval.mjs';
import {validateNicheKeywordIdeasBatch,requestFingerprint} from '../lib/dataforseo-contract.mjs';
import {estimateKeywordIdeasMicrousd} from '../lib/provider-registry.mjs';
import {dispatchNicheKeywordIdeas} from '../lib/niche-keyword-dispatch.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_NICHE_KEYWORDS_REQUIRED');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceFile='/var/lib/page-autodev/dataforseo/taiwan-niche-deep-validation-plan-v1.json';
const approvalFile='/etc/page-autodev/credentials/dataforseo-niche-keywords-approval.json';
const policyFile='/etc/page-autodev/credentials/dataforseo-egress-policy.json';
const outputFile='/var/lib/page-autodev/dataforseo/taiwan-niche-keyword-ideas-v1.json';
const checkpointFile='/var/lib/page-autodev/dataforseo/taiwan-niche-keyword-ideas-v1-checkpoint.json';
const failureFile='/var/lib/page-autodev/dataforseo/taiwan-niche-keyword-ideas-v1-failure.json';
const expectedSourceSha='bcdf4bd0170a5daca01ec8c5229188c72143ff5e929f1dce6ad1d051936f6041';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const atomic=(file,value)=>{const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);fs.chmodSync(file,0o600);};
const sourceBytes=fs.readFileSync(sourceFile),sourceSha=sha(sourceBytes);if(sourceSha!==expectedSourceSha)throw new Error('SOURCE_PLAN_CHANGED');
const source=JSON.parse(sourceBytes);if(source.candidate_count!==10||source.candidates?.length!==10)throw new Error('SOURCE_PLAN_SCOPE');
const requests=source.candidates.map((item,index)=>({keywords:[item.topic],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:20,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:`page-autodev-ideas-niche-${String(index+1).padStart(2,'0')}`}));
const contract=validateNicheKeywordIdeasBatch(requests);if(!contract.ok)throw new Error(`NICHE_CONTRACT:${contract.errors.join(',')}`);
const requestPlanSha=sha(JSON.stringify(requests));

if(process.argv.includes('--prepare')){
  if(fs.existsSync(approvalFile)||fs.existsSync(outputFile)||fs.existsSync(checkpointFile))throw new Error('PREPARE_STATE_NOT_CLEAN');
  const approval={schema_version:1,approval_id:`niche-keywords-${crypto.randomBytes(8).toString('hex')}`,expires_at:new Date(Date.now()+10*60*1000).toISOString(),source_plan_sha256:sourceSha,request_plan_sha256:requestPlanSha,task_count:10,per_task_limit:20,max_microusd:144000};
  atomic(approvalFile,approval);
  fs.copyFileSync(path.join(root,'deploy/dataforseo-egress-policy.niche-keywords.json'),policyFile);fs.chownSync(policyFile,0,0);fs.chmodSync(policyFile,0o600);
  console.log(JSON.stringify({ok:true,prepared:true,approval_id:approval.approval_id,source_plan_sha256:sourceSha,request_plan_sha256:requestPlanSha,max_microusd:144000}));process.exit(0);
}

const approvalStat=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
validateNicheKeywordApproval({approval,mode:approvalStat.mode&0o777,uid:approvalStat.uid,expected_source_plan_sha256:sourceSha,expected_request_plan_sha256:requestPlanSha});
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);
const registry=JSON.parse(fs.readFileSync(path.join(root,'fixtures/provider-registry.json'),'utf8'));registry.activation='canary';
const estimated=requests.reduce((sum,item)=>sum+estimateKeywordIdeasMicrousd(registry,item.limit),0);if(estimated!==approval.max_microusd)throw new Error('APPROVED_COST_MISMATCH');
const project_id=`dfs-niche-${approval.approval_id}`,day=new Date().toISOString().slice(0,10),request_id=`niche-keywords:${crypto.randomUUID()}`;
const ledger=new DurableSpendLedger({file:'/var/lib/page-autodev/dataforseo/spend-ledger.json',daily_cap_microusd:144000});
const usage_reader=async()=>{const rows=await ledger.snapshot(),month=day.slice(0,7),cost=row=>row.status!=='REJECTED'?(row.actual_microusd??row.reserved_microusd):0;return {project_day_used_microusd:rows.filter(r=>r.project_id===project_id&&r.day===day).reduce((s,r)=>s+cost(r),0),global_day_used_microusd:rows.filter(r=>r.day===day).reduce((s,r)=>s+cost(r),0),global_month_used_microusd:rows.filter(r=>r.day.startsWith(month)).reduce((s,r)=>s+cost(r),0)};};
const gateway=new BillingGateway({ledger,registry,budget_policy:{per_request_microusd:144000,per_project_daily_microusd:144000,global_daily_microusd:500000,global_monthly_microusd:5000000},usage_reader,activation_mode:'canary'});
let lease;
try{
  const admission=await gateway.authorize({capability:'keyword_ideas_niche_validation',request:requests,estimated_microusd:estimated,project_id,day});if(!admission.ok)throw new Error(`ADMISSION:${admission.reason}:${(admission.errors??[]).join(',')}`);lease=admission.lease;
  const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64'),authority=createDataForSeoAssertionAuthority({secret}),apiPath='/v3/dataforseo_labs/google/keyword_ideas/live';
  await ledger.markDispatched(lease.lease_id,request_id);
  const saveCheckpoint=checkpoint=>atomic(checkpointFile,{schema_version:1,approval_id:approval.approval_id,source_plan_sha256:sourceSha,request_plan_sha256:requestPlanSha,updated_at:new Date().toISOString(),...checkpoint});
  const dispatch=await dispatchNicheKeywordIdeas({requests,path:apiPath,lease_id:lease.lease_id,request_id,authority,client:createDataForSeoUnixClient(),on_task:saveCheckpoint,on_batch_boundary:async checkpoint=>{if(checkpoint.tasks.length!==5||checkpoint.actual_microusd!==72000)throw new Error('FIRST_BATCH_COST_MISMATCH');saveCheckpoint({...checkpoint,batch_one_verified:true});}});
  if(dispatch.actual_microusd!==144000)throw Object.assign(new Error('ACTUAL_COST_NOT_EXACT'),{known_microusd:dispatch.actual_microusd,provider_evidence:dispatch.evidence});
  await ledger.settle(lease.lease_id,dispatch.actual_microusd);
  const candidates=source.candidates.map((item,index)=>({candidate_id:item.candidate_id,rank:item.rank,topic:item.topic,request_fingerprint:requestFingerprint(requests[index]),provider_task:dispatch.envelope.tasks[index]}));
  atomic(outputFile,{schema_version:1,approval_id:approval.approval_id,source_plan_sha256:sourceSha,request_plan_sha256:requestPlanSha,retrieved_at:new Date().toISOString(),provider:'dataforseo',market:'Taiwan',language:'zh-TW',task_count:10,actual_microusd:dispatch.actual_microusd,lease_id:lease.lease_id,evidence:dispatch.evidence,candidates});
  fs.rmSync(checkpointFile,{force:true});console.log(JSON.stringify({ok:true,output:outputFile,task_count:10,actual_microusd:dispatch.actual_microusd,lease_id:lease.lease_id}));
}catch(error){if(lease){if(Number.isSafeInteger(error.known_microusd)&&error.known_microusd>=0)await ledger.settle(lease.lease_id,error.known_microusd).catch(()=>ledger.markUnknown(lease.lease_id).catch(()=>{}));else await ledger.markUnknown(lease.lease_id).catch(()=>{});}atomic(failureFile,{schema_version:1,failed_at:new Date().toISOString(),source_plan_sha256:sourceSha,request_plan_sha256:requestPlanSha,error:String(error.message),known_microusd:Number.isSafeInteger(error.known_microusd)?error.known_microusd:null,provider_evidence:error.provider_evidence??[]});console.error(JSON.stringify({ok:false,error:String(error.message),known_microusd:Number.isSafeInteger(error.known_microusd)?error.known_microusd:null}));process.exitCode=1;}
