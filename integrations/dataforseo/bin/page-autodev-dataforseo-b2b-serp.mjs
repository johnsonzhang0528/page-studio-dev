import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {validateSerpLiveAdvancedRequest,SERP_LIVE_ADVANCED_ROUTE} from '../lib/dataforseo-serp-contract.mjs';
import {estimateSerpLiveAdvancedMicrousd} from '../lib/provider-registry.mjs';
import {SerpRunStore,QUERY_STATUS} from '../lib/serp-run-store.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REQUIRED');

// PHASE B: 10 SERP validation queries, zh-TW desktop, depth 10.
// Locations come from the verified allowlist: 2158 = Taiwan, 9040380 = Taichung City.
// Queries 8 and 9 deliberately share the Taichung code so implicit local intent
// ("玻璃工程") can be compared against explicit ("台中玻璃工程") in the same locale.
const TW=2158, TAICHUNG=9040380;
const QUERIES=[
  {keyword:'玻璃隔間',location_code:TW},
  {keyword:'辦公室玻璃隔間',location_code:TW},
  {keyword:'辦公室隔間費用',location_code:TW},
  {keyword:'店面玻璃門',location_code:TW},
  {keyword:'店面落地玻璃門價格',location_code:TW},
  {keyword:'店面玻璃門設計',location_code:TW},
  {keyword:'無框玻璃門',location_code:TW},
  {keyword:'玻璃工程',location_code:TAICHUNG},
  {keyword:'台中玻璃工程',location_code:TAICHUNG},
  {keyword:'防火玻璃工程',location_code:TW}
];
const PER_QUERY_MICROUSD=2000;
const MONTHLY_CAP_MICROUSD=1_000_000;

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data='/var/lib/page-autodev/dataforseo';
const approvalFile='/etc/page-autodev/credentials/dataforseo-b2b-serp-approval.json';
const egressPolicy='/etc/page-autodev/credentials/dataforseo-egress-policy.json';
const outputFile=`${data}/b2b-serp-validation-v1.json`;
const checkpointFile=`${data}/b2b-serp-validation-v1-checkpoint.json`;
const failureFile=`${data}/b2b-serp-validation-v1-failure.json`;

const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
// Same keyword in two locales must be tracked separately.
const storeKey=r=>`${r.keyword}@${r.location_code}`;
const atomic=(file,value)=>{const t=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(t,`${JSON.stringify(value,null,2)}\n`,{mode:0o600,flag:'wx'});fs.renameSync(t,file);fs.chmodSync(file,0o600);};

const requests=QUERIES.map((entry,index)=>({
  keyword:entry.keyword,location_code:entry.location_code,language_code:'zh-TW',
  device:'desktop',os:'windows',depth:10,
  tag:`dfs-serp-calibration-${String(index+1).padStart(2,'0')}`
}));
for(const [i,r] of requests.entries()){
  const c=validateSerpLiveAdvancedRequest(r);
  if(!c.ok)throw new Error(`CONTRACT_${i}:${c.errors.join(',')}`);
}
const planSha=sha(JSON.stringify(requests));

const registry=JSON.parse(fs.readFileSync(path.join(root,'fixtures/provider-registry.json'),'utf8'));
registry.activation='canary';
const perQuery=estimateSerpLiveAdvancedMicrousd(registry);
if(perQuery!==PER_QUERY_MICROUSD)throw new Error(`SERP_PRICE_CHANGED:${perQuery}`);
const totalEstimate=perQuery*QUERIES.length;

if(process.argv.includes('--prepare')){
  if(fs.existsSync(approvalFile)||fs.existsSync(outputFile)||fs.existsSync(checkpointFile))throw new Error('PREPARE_STATE_NOT_CLEAN');
  const installed=JSON.parse(fs.readFileSync(egressPolicy,'utf8'));
  if(installed.activation!=='disabled')throw new Error('EGRESS_NOT_DISABLED');
  // SERP canary policy carries a hard 15-minute expiry (SERP_CANARY_EXPIRY_INVALID).
  const expires_at=new Date(Date.now()+10*60*1000).toISOString();
  const approval={schema_version:1,approval_id:`b2bserp-${crypto.randomBytes(8).toString('hex')}`,
    expires_at,plan_sha256:planSha,task_count:QUERIES.length,per_query_microusd:perQuery,max_microusd:totalEstimate};
  atomic(approvalFile,approval);
  const canary=JSON.parse(fs.readFileSync(path.join(root,'deploy/dataforseo-egress-policy.serp-canary.json'),'utf8'));
  canary.expires_at=expires_at;
  const tmp=`${egressPolicy}.${process.pid}.tmp`,fd=fs.openSync(tmp,'wx',0o600);
  try{fs.writeSync(fd,`${JSON.stringify(canary)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(tmp,egressPolicy);
  console.log(JSON.stringify({ok:true,prepared:true,approval_id:approval.approval_id,queries:QUERIES,max_microusd:totalEstimate,max_usd:totalEstimate/1e6,expires_at}));
  process.exit(0);
}

const st=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
if((st.mode&0o777)!==0o600||st.uid!==0)throw new Error('APPROVAL_PERMISSIONS');
if(approval.schema_version!==1||!/^b2bserp-[a-f0-9]{16}$/.test(approval.approval_id))throw new Error('APPROVAL_SCOPE');
if(Date.parse(approval.expires_at)<=Date.now())throw new Error('APPROVAL_EXPIRED');
if(approval.plan_sha256!==planSha||approval.task_count!==QUERIES.length||approval.max_microusd!==totalEstimate)throw new Error('APPROVAL_PLAN_MISMATCH');
const activePolicy=JSON.parse(fs.readFileSync(egressPolicy,'utf8'));
if(activePolicy.activation!=='active'||activePolicy.expires_at!==approval.expires_at||
   JSON.stringify(activePolicy.upstream?.paths)!==JSON.stringify([SERP_LIVE_ADVANCED_ROUTE]))throw new Error('SERP_EGRESS_POLICY_MISMATCH');
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);

const day=new Date().toISOString().slice(0,10),project_id=`dfs-b2bserp-${approval.approval_id}`;
const ledger=new DurableSpendLedger({file:`${data}/spend-ledger.json`,daily_cap_microusd:MONTHLY_CAP_MICROUSD});
const usage_reader=async()=>{const rows=await ledger.snapshot(),month=day.slice(0,7),c=r=>r.status==='REJECTED'?0:(r.actual_microusd??r.reserved_microusd);
  const sum=p=>rows.filter(p).reduce((s,r)=>s+c(r),0);
  return {project_day_used_microusd:sum(r=>r.project_id===project_id&&r.day===day),global_day_used_microusd:sum(r=>r.day===day),global_month_used_microusd:sum(r=>r.day.startsWith(month))};};

const pre=await usage_reader();
if(pre.global_month_used_microusd+totalEstimate>MONTHLY_CAP_MICROUSD)
  throw new Error(`MONTHLY_CAP_WOULD_EXCEED:used=${pre.global_month_used_microusd},add=${totalEstimate}`);

const gateway=new BillingGateway({ledger,registry,
  budget_policy:{per_request_microusd:perQuery,per_project_daily_microusd:totalEstimate,global_daily_microusd:MONTHLY_CAP_MICROUSD,global_monthly_microusd:MONTHLY_CAP_MICROUSD},
  usage_reader,activation_mode:'canary'});

const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64');
const authority=createDataForSeoAssertionAuthority({secret}),client=createDataForSeoUnixClient();

const store=new SerpRunStore({root:data,run_id:approval.approval_id});
const results=[],evidence=[];let spent=0,lease=null,currentKeyword=null;
try{
  for(const [index,request] of requests.entries()){
    currentKeyword=storeKey(request);
    if(Date.parse(approval.expires_at)<=Date.now())throw new Error(`SERP_WINDOW_EXPIRED_AT_${index+1}`);
    if(store.isRedispatchForbidden(storeKey(request))){
      console.error(JSON.stringify({skipped:request.keyword,reason:store.get(storeKey(request)).status}));continue;}
    const request_id=`b2bserp:${approval.approval_id}:${index+1}`;
    const admission=await gateway.authorize({capability:'serp_live_advanced',request,estimated_microusd:perQuery,project_id,day});
    if(!admission.ok)throw new Error(`ADMISSION_${index+1}:${admission.reason}:${(admission.errors??[]).join(',')}`);
    lease=admission.lease;
    const body=Buffer.from(JSON.stringify([request])),body_sha256=sha(body);
    const gateway_assertion=authority.issue({request_id,body_sha256,lease_id:lease.lease_id,path:SERP_LIVE_ADVANCED_ROUTE});
    store.markDispatched(storeKey(request),{index,keyword:request.keyword,request_id,estimated_microusd:perQuery,
      location_code:request.location_code,language_code:request.language_code,device:request.device});
    await ledger.markDispatched(lease.lease_id,request_id);
    const raw=await client({gateway_assertion,request_id,method:'POST',path:SERP_LIVE_ADVANCED_ROUTE,body,body_sha256,lease_id:lease.lease_id});
    if(raw?.status!==200)throw Object.assign(new Error(`HTTP_${raw?.status}_Q${index+1}`),{});
    let envelope;try{envelope=JSON.parse(raw.body.toString('utf8'));}catch{throw new Error(`JSON_INVALID_Q${index+1}`);}
    const task=Array.isArray(envelope.tasks)&&envelope.tasks.length===1?envelope.tasks[0]:null;
    // DURABILITY: persist the paid provider response to its own fsync'd file BEFORE settling.
    store.persistRawResponse(storeKey(request),{index,keyword:request.keyword,envelope});
    const cost=Math.round(Number(task?.cost??0)*1_000_000);
    if(!Number.isSafeInteger(cost)||cost<0||cost>perQuery)throw Object.assign(new Error(`COST_INVALID_Q${index+1}`),{known:cost});
    evidence.push({index,keyword:request.keyword,location_code:request.location_code,source_status_code:envelope.status_code??null,task_status_code:task?.status_code??null,cost_microusd:cost});
    if(envelope.status_code!==20000||!task||task.status_code!==20000)throw Object.assign(new Error(`PROVIDER_TASK_Q${index+1}`),{known:cost});
    await ledger.settle(lease.lease_id,cost);
    store.markSettled(storeKey(request),{actual_microusd:cost,provider_task_id:task?.id??null,request_id});
    spent+=cost;lease=null;
    results.push({keyword:request.keyword,location_code:request.location_code,request,provider_task:task});
    atomic(checkpointFile,{schema_version:1,approval_id:approval.approval_id,updated_at:new Date().toISOString(),completed:results.length,actual_microusd:spent,evidence});
  }
  atomic(outputFile,{schema_version:1,approval_id:approval.approval_id,plan_sha256:planSha,
    retrieved_at:new Date().toISOString(),provider:'dataforseo',endpoint:SERP_LIVE_ADVANCED_ROUTE,
    localization:{language_code:'zh-TW',device:'desktop',os:'windows',depth:10,
      locations:{2158:'Taiwan (country)',9040380:'Taichung City (verified via official DataForSEO locations CSV)'},
      per_query_location:Object.fromEntries(QUERIES.map(q=>[q.keyword,q.location_code]))},
    task_count:results.length,actual_microusd:spent,evidence,queries:results});
  fs.rmSync(checkpointFile,{force:true});
  console.log(JSON.stringify({ok:true,output:outputFile,task_count:results.length,actual_microusd:spent,actual_usd:spent/1e6}));
}catch(error){
  if(lease){if(Number.isSafeInteger(error.known)&&error.known>=0)await ledger.settle(lease.lease_id,error.known).catch(()=>ledger.markUnknown(lease.lease_id).catch(()=>{}));
    else await ledger.markUnknown(lease.lease_id).catch(()=>{});
    try{store.markFailed(currentKeyword??'unknown',{status:QUERY_STATUS.FAILED_AFTER_DISPATCH,error:error.message,actual_microusd:error.known??null});}catch{}}
  atomic(failureFile,{schema_version:1,failed_at:new Date().toISOString(),error:String(error.message),completed:results.length,actual_microusd:spent,evidence});
  console.error(JSON.stringify({ok:false,error:String(error.message),completed:results.length,actual_microusd:spent}));
  process.exitCode=1;
}
