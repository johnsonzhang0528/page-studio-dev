import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createDataForSeoAssertionAuthority} from '../lib/dataforseo-assertion.mjs';
import {createDataForSeoUnixClient} from '../lib/dataforseo-unix-ipc.mjs';
import {validateBalancedCalibrationApproval} from '../lib/canary-approval.mjs';
import {buildSeedDiscoveryPlan} from '../lib/query-candidate-builder.mjs';
import {requestFingerprint,validateBalancedKeywordIdeasBatch} from '../lib/dataforseo-contract.mjs';
import {normalizeBalancedKeywordIdeas} from '../lib/dataforseo-normalizer.mjs';
import {balanceDiscoveryRows} from '../lib/discovery-quality.mjs';
import {buildCalibrationReport} from '../lib/calibration-report.mjs';
import {estimateBalancedKeywordIdeasMicrousd} from '../lib/provider-registry.mjs';
import {dispatchBalancedKeywordIdeas} from '../lib/balanced-calibration-dispatch.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_CALIBRATION_REQUIRED');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seeds=JSON.parse(fs.readFileSync(path.join(root,'fixtures/taiwan-zhtw-calibration-seeds.json'),'utf8'));
const profiles=JSON.parse(fs.readFileSync(path.join(root,'fixtures/taiwan-zhtw-topic-profiles.json'),'utf8'));
const plan=buildSeedDiscoveryPlan(seeds,{per_seed_limit:20}),requests=plan.map(item=>item.request);
const contract=validateBalancedKeywordIdeasBatch(requests);if(!contract.ok)throw new Error(`BALANCED_CONTRACT:${contract.errors.join(',')}`);
const request_plan_sha256=crypto.createHash('sha256').update(JSON.stringify(requests)).digest('hex');
const approvalFile='/etc/page-autodev/credentials/dataforseo-calibration-approval.json';
const approvalStat=fs.statSync(approvalFile),approval=JSON.parse(fs.readFileSync(approvalFile,'utf8'));
validateBalancedCalibrationApproval({approval,mode:approvalStat.mode&0o777,uid:approvalStat.uid,expected_request_plan_sha256:request_plan_sha256});
fs.renameSync(approvalFile,`${approvalFile}.consumed-${approval.approval_id}`);
const registry=JSON.parse(fs.readFileSync(path.join(root,'fixtures/provider-registry.json'),'utf8'));registry.activation='canary';
const estimated_microusd=estimateBalancedKeywordIdeasMicrousd(registry,requests);
if(estimated_microusd!==approval.max_microusd)throw new Error('APPROVED_COST_MISMATCH');
const project_id=`dataforseo-balanced-${approval.approval_id}`,day=new Date().toISOString().slice(0,10),request_id=`balanced-calibration:${crypto.randomUUID()}`;
const ledger=new DurableSpendLedger({file:'/var/lib/page-autodev/dataforseo/spend-ledger.json',daily_cap_microusd:100000});
const usage_reader=async()=>{const ledgerRows=await ledger.snapshot(),month=day.slice(0,7),count=row=>row.status!=='REJECTED'?(row.actual_microusd??row.reserved_microusd):0;return {project_day_used_microusd:ledgerRows.filter(row=>row.project_id===project_id&&row.day===day).reduce((sum,row)=>sum+count(row),0),global_day_used_microusd:ledgerRows.filter(row=>row.day===day).reduce((sum,row)=>sum+count(row),0),global_month_used_microusd:ledgerRows.filter(row=>row.day.startsWith(month)).reduce((sum,row)=>sum+count(row),0)};};
const gateway=new BillingGateway({ledger,registry,budget_policy:{per_request_microusd:86400,per_project_daily_microusd:86400,global_daily_microusd:100800,global_monthly_microusd:500000},usage_reader,activation_mode:'canary'});
let lease;
try{
  const admission=await gateway.authorize({capability:'keyword_ideas_balanced',request:requests,estimated_microusd,project_id,day});
  if(!admission.ok)throw new Error(`ADMISSION:${admission.reason}`);lease=admission.lease;
  const secret=Buffer.from(fs.readFileSync('/etc/page-autodev/credentials/gateway-assertion-secret','utf8').trim(),'base64'),authority=createDataForSeoAssertionAuthority({secret});
  const apiPath='/v3/dataforseo_labs/google/keyword_ideas/live';
  await ledger.markDispatched(lease.lease_id,request_id);
  const checkpointFile='/var/lib/page-autodev/dataforseo/calibration-60-v2-checkpoint.json';
  const writeCheckpoint=async checkpoint=>{
    const artifact={schema_version:1,approval_id:approval.approval_id,request_plan_sha256,lease_id:lease.lease_id,request_id,updated_at:new Date().toISOString(),...checkpoint};
    const temporary=`${checkpointFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary,`${JSON.stringify(artifact,null,2)}\n`,{mode:0o600,flag:'wx'});
    fs.renameSync(temporary,checkpointFile);
  };
  const dispatch=await dispatchBalancedKeywordIdeas({requests,path:apiPath,lease_id:lease.lease_id,request_id,authority,client:createDataForSeoUnixClient(),on_task:writeCheckpoint}),envelope=dispatch.envelope,actual_microusd=dispatch.actual_microusd;
  if(!Number.isSafeInteger(actual_microusd)||actual_microusd<1||actual_microusd>estimated_microusd)throw new Error('ACTUAL_COST_OUT_OF_BOUNDS');
  await ledger.settle(lease.lease_id,actual_microusd);
  const retrieved_at=new Date().toISOString(),contexts=plan.map(item=>({source_seed:item.source_seed,request_fingerprint:requestFingerprint(item.request),retrieved_at,location_code:2158,language_code:'zh-TW',endpoint:'dataforseo_labs/google/keyword_ideas/live'}));
  const normalized=normalizeBalancedKeywordIdeas(envelope,contexts);
  const discoveryRows=normalized.map(row=>({query:row.metric_subject,source_seed:row.source_seed,source_task_index:row.source_task_index,location_code:2158,language_code:'zh-TW',volume:row.search_volume_estimate,kd:row.organic_kd,intent:['informational','commercial','transactional','navigational'].includes(row.intent_provider)?row.intent_provider:'unknown',observed_at:retrieved_at}));
  const quality=balanceDiscoveryRows(discoveryRows,{seeds,profiles,per_seed_quota:10,minimum_per_seed:5});
  const rows=quality.selected.map(({canonical_query,quality_class,quality_reason,...row})=>row);
  const report=quality.ok&&rows.length===60?buildCalibrationReport(rows):{ok:false,decision:'HOLD_FOR_DISCOVERY_REPAIR',errors:[...quality.errors,...(rows.length===60?[]:['ROW_COUNT_EXPECTED:60'])],metrics:quality.metrics};
  const artifact={schema_version:3,approval_id:approval.approval_id,request_plan_sha256,retrieved_at,provider:'dataforseo',actual_microusd,lease_id:lease.lease_id,raw_provider_envelope:envelope,quality,report,rows};
  fs.mkdirSync('/var/lib/page-autodev/dataforseo',{recursive:true});fs.writeFileSync('/var/lib/page-autodev/dataforseo/calibration-60-v2.json',`${JSON.stringify(artifact,null,2)}\n`,{mode:0o600});
  fs.unlinkSync(checkpointFile);
  console.log(JSON.stringify({ok:quality.ok&&report.ok,actual_microusd,lease_id:lease.lease_id,quality:quality.metrics,report:artifact.report}));
}catch(error){
  if(lease){
    if(Number.isSafeInteger(error.known_microusd)&&error.known_microusd>=0)await ledger.settle(lease.lease_id,error.known_microusd).catch(()=>ledger.markUnknown(lease.lease_id).catch(()=>{}));
    else await ledger.markUnknown(lease.lease_id).catch(()=>{});
  }
  const failure={schema_version:1,failed_at:new Date().toISOString(),request_plan_sha256,error:String(error.message),known_microusd:Number.isSafeInteger(error.known_microusd)?error.known_microusd:null,provider_evidence:error.provider_evidence??[]};
  fs.mkdirSync('/var/lib/page-autodev/dataforseo',{recursive:true});fs.writeFileSync('/var/lib/page-autodev/dataforseo/calibration-60-v2-failure.json',`${JSON.stringify(failure,null,2)}\n`,{mode:0o600});
  console.error(JSON.stringify({ok:false,error:String(error.message),known_microusd:failure.known_microusd,provider_evidence:failure.provider_evidence}));process.exitCode=1;
}
