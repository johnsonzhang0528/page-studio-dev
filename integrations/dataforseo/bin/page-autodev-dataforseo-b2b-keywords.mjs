import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {validateKeywordIdeasRequest,requestFingerprint} from '../lib/dataforseo-contract.mjs';
import {estimateKeywordIdeasMicrousd} from '../lib/provider-registry.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REQUIRED');

// PHASE A: commercial-space B2B seeds. Seed 8 is feasibility research only, not a committed MVP page.
const SEEDS=['辦公室玻璃隔間','玻璃隔間','店面玻璃門','無框玻璃門','店面櫥窗','玻璃工程','玻璃工程公司','防火玻璃工程'];
const PER_SEED_LIMIT=60;
const MONTHLY_CAP_MICROUSD=1_000_000;
const API_PATH='/v3/dataforseo_labs/google/keyword_ideas/live';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const approvalFile='/etc/page-autodev/credentials/dataforseo-b2b-keywords-approval.json';
const outputFile='/var/lib/page-autodev/dataforseo/b2b-keyword-ideas-v1.json';
const checkpointFile='/var/lib/page-autodev/dataforseo/b2b-keyword-ideas-v1-checkpoint.json';
const failureFile='/var/lib/page-autodev/dataforseo/b2b-keyword-ideas-v1-failure.json';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const atomic=(file,value)=>{const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:'wx'});fs.renameSync(temp,file);fs.chmodSync(file,0o600);};

// Taiwan zh-TW only (location_code 2158). One paid request per seed, offset 0.
const requests=SEEDS.map((seed,index)=>({
  keywords:[seed],location_code:2158,language_code:'zh-TW',
  closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,
  limit:PER_SEED_LIMIT,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],
  tag:`page-autodev-ideas-b2b-${String(index+1).padStart(2,'0')}`
}));

for(const [index,request] of requests.entries()){
  const check=validateKeywordIdeasRequest(request,{allowed_limits:[PER_SEED_LIMIT]});
  if(!check.ok)throw new Error(`CONTRACT_TASK_${index}:${check.errors.join(',')}`);
}
const requestPlanSha=sha(JSON.stringify(requests));

const registry=JSON.parse(fs.readFileSync(path.join(root,'fixtures/provider-registry.json'),'utf8'));
registry.activation='canary';
const perSeedEstimate=estimateKeywordIdeasMicrousd(registry,PER_SEED_LIMIT);
const totalEstimate=perSeedEstimate*SEEDS.length;

if(process.argv.includes('--prepare')){
  if(fs.existsSync(approvalFile)||fs.existsSync(outputFile)||fs.existsSync(checkpointFile))throw new Error('PREPARE_STATE_NOT_CLEAN');
  const approval={schema_version:1,approval_id:`b2b-keywords-${crypto.randomBytes(8).toString('hex')}`,
    expires_at:new Date(Date.now()+10*60*1000).toISOString(),
    request_plan_sha256:requestPlanSha,seed_count:SEEDS.length,per_seed_limit:PER_SEED_LIMIT,
    per_seed_microusd:perSeedEstimate,max_microusd:totalEstimate};
  atomic(approvalFile,approval);
  console.log(JSON.stringify({ok:true,prepared:true,approval_id:approval.approval_id,seeds:SEEDS,per_seed_microusd:perSeedEstimate,max_microusd:totalEstimate,max_usd:totalEstimate/1e6}));
  process.exit(0);
}

const approvalStat=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
if((approvalStat.mode&0o777)!==0o600||approvalStat.uid!==0)throw new Error('APPROVAL_PERMISSIONS');
if(approval.schema_version!==1||!/^b2b-keywords-[a-f0-9]{16}$/.test(approval.approval_id))throw new Error('APPROVAL_SCOPE');
if(Date.parse(approval.expires_at)<=Date.now()||Date.parse(approval.expires_at)>Date.now()+15*60*1000)throw new Error('APPROVAL_EXPIRY');
if(approval.request_plan_sha256!==requestPlanSha||approval.seed_count!==SEEDS.length||approval.max_microusd!==totalEstimate)throw new Error('APPROVAL_PLAN_MISMATCH');
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);

const project_id=`dfs-b2b-${approval.approval_id}`,day=new Date().toISOString().slice(0,10);
const ledger=new DurableSpendLedger({file:'/var/lib/page-autodev/dataforseo/spend-ledger.json',daily_cap_microusd:MONTHLY_CAP_MICROUSD});
const usage_reader=async()=>{const rows=await ledger.snapshot(),month=day.slice(0,7),cost=row=>row.status!=='REJECTED'?(row.actual_microusd??row.reserved_microusd):0;
  return {project_day_used_microusd:rows.filter(r=>r.project_id===project_id&&r.day===day).reduce((s,r)=>s+cost(r),0),
    global_day_used_microusd:rows.filter(r=>r.day===day).reduce((s,r)=>s+cost(r),0),
    global_month_used_microusd:rows.filter(r=>r.day.startsWith(month)).reduce((s,r)=>s+cost(r),0)};};

// Hard stop before any spend: refuse if the whole batch could push the month past US$1.
const preUsage=await usage_reader();
if(preUsage.global_month_used_microusd+totalEstimate>MONTHLY_CAP_MICROUSD)
  throw new Error(`MONTHLY_CAP_WOULD_EXCEED:used=${preUsage.global_month_used_microusd},add=${totalEstimate},cap=${MONTHLY_CAP_MICROUSD}`);

const gateway=new BillingGateway({ledger,registry,
  budget_policy:{per_request_microusd:perSeedEstimate,per_project_daily_microusd:totalEstimate,global_daily_microusd:MONTHLY_CAP_MICROUSD,global_monthly_microusd:MONTHLY_CAP_MICROUSD},
  usage_reader,activation_mode:'canary'});

const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64');
const authority=createDataForSeoAssertionAuthority({secret});
const client=createDataForSeoUnixClient();

const results=[],evidence=[];
let spent=0,lease=null;
try{
  for(const [index,request] of requests.entries()){
    const request_id=`b2b-keywords:${crypto.randomUUID()}`;
    const admission=await gateway.authorize({capability:'keyword_ideas',request,estimated_microusd:perSeedEstimate,project_id,day});
    if(!admission.ok)throw new Error(`ADMISSION_SEED_${index+1}:${admission.reason}:${(admission.errors??[]).join(',')}`);
    lease=admission.lease;
    const body=Buffer.from(JSON.stringify([request])),body_sha256=crypto.createHash('sha256').update(body).digest('hex');
    const gateway_assertion=authority.issue({request_id,body_sha256,lease_id:lease.lease_id,path:API_PATH});
    await ledger.markDispatched(lease.lease_id,request_id);
    const raw=await client({gateway_assertion,request_id,method:'POST',path:API_PATH,body,body_sha256,lease_id:lease.lease_id});
    if(raw?.status!==200)throw Object.assign(new Error(`HTTP_${raw?.status??'UNKNOWN'}_SEED_${index+1}`),{lease_open:true});
    let envelope;try{envelope=JSON.parse(raw.body.toString('utf8'));}catch{throw Object.assign(new Error(`JSON_INVALID_SEED_${index+1}`),{lease_open:true});}
    const task=Array.isArray(envelope.tasks)&&envelope.tasks.length===1?envelope.tasks[0]:null;
    const taskCost=Math.round(Number(task?.cost??0)*1_000_000);
    if(!Number.isSafeInteger(taskCost)||taskCost<0||taskCost>perSeedEstimate)throw Object.assign(new Error(`COST_INVALID_SEED_${index+1}`),{lease_open:true,known:taskCost});
    evidence.push({index,seed:SEEDS[index],source_status_code:envelope.status_code??null,task_status_code:task?.status_code??null,cost_microusd:taskCost});
    if(envelope.status_code!==20000||!task||task.status_code!==20000)throw Object.assign(new Error(`PROVIDER_TASK_${task?.status_code??envelope.status_code}_SEED_${index+1}`),{lease_open:true,known:taskCost});
    await ledger.settle(lease.lease_id,taskCost);
    spent+=taskCost;lease=null;
    results.push({seed:SEEDS[index],request_fingerprint:requestFingerprint(request),provider_task:task});
    atomic(checkpointFile,{schema_version:1,approval_id:approval.approval_id,updated_at:new Date().toISOString(),completed_seeds:results.length,actual_microusd:spent,evidence});
  }
  atomic(outputFile,{schema_version:1,approval_id:approval.approval_id,request_plan_sha256:requestPlanSha,
    retrieved_at:new Date().toISOString(),provider:'dataforseo',endpoint:API_PATH,market:'Taiwan',location_code:2158,language_code:'zh-TW',
    dataset_label:'new_b2b_dataset',seed_count:SEEDS.length,per_seed_limit:PER_SEED_LIMIT,
    actual_microusd:spent,evidence,seeds:results});
  fs.rmSync(checkpointFile,{force:true});
  console.log(JSON.stringify({ok:true,output:outputFile,seed_count:results.length,actual_microusd:spent,actual_usd:spent/1e6}));
}catch(error){
  if(lease){if(Number.isSafeInteger(error.known)&&error.known>=0)await ledger.settle(lease.lease_id,error.known).catch(()=>ledger.markUnknown(lease.lease_id).catch(()=>{}));
    else await ledger.markUnknown(lease.lease_id).catch(()=>{});}
  atomic(failureFile,{schema_version:1,failed_at:new Date().toISOString(),error:String(error.message),completed_seeds:results.length,actual_microusd:spent,evidence});
  console.error(JSON.stringify({ok:false,error:String(error.message),completed_seeds:results.length,actual_microusd:spent}));
  process.exitCode=1;
}
