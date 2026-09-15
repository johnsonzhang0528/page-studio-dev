import fs from 'node:fs';
import crypto from 'node:crypto';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {balanceDiscoveryRows,canonicalKeyword,keywordDedupeKey} from '../lib/discovery-quality.mjs';
import {validateLiveExpansionPlan,atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_REVIEW_REQUIRED');
const data='/var/lib/page-autodev/dataforseo',sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sourceFiles={original:`${data}/calibration-60-v2.json`,remainder:`${data}/candidate-expansion-remainder-results-v1.json`,recovery:`${data}/candidate-expansion-recovery-results-v1.json`,plan:`${data}/candidate-expansion-plan-v1.json`};
const bytes=Object.fromEntries(Object.entries(sourceFiles).map(([key,file])=>[key,fs.readFileSync(file)]));
const original=JSON.parse(bytes.original),remainder=JSON.parse(bytes.remainder),recovery=JSON.parse(bytes.recovery);
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));
const profiles=JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-topic-profiles.json',import.meta.url),'utf8'));
const seeds=Object.keys(profiles);
const plan=validateLiveExpansionPlan({plan:JSON.parse(bytes.plan),shadow_bytes:fs.readFileSync(`${data}/calibration-60-v3-shadow.json`),seeds,registry});
if(original?.rows?.length!==60||remainder?.actual_microusd!==57600||recovery?.actual_microusd!==14400||remainder.plan_sha256!==plan.plan_sha256||recovery.plan_sha256!==plan.plan_sha256||remainder.envelope?.tasks?.length!==4||recovery.envelope?.tasks?.length!==1)throw new Error('REVIEW_SOURCE_SCOPE_INVALID');
const ledger=new DurableSpendLedger({file:`${data}/spend-ledger.json`}),ledgerRows=await ledger.snapshot();
const first=ledgerRows.find(row=>row.lease_id===recovery.original_lease_id),four=ledgerRows.find(row=>row.lease_id===remainder.lease_id),repeat=ledgerRows.find(row=>row.lease_id===recovery.lease_id);
if(first?.status!=='SETTLED'||first.actual_microusd!==14400||first.reconciliation?.reason!=='PROVIDER_COST_CONFIRMED'||four?.status!=='SETTLED'||four.actual_microusd!==57600||repeat?.status!=='SETTLED'||repeat.actual_microusd!==14400||recovery.remainder_lease_id!==four.lease_id)throw new Error('REVIEW_LEDGER_NOT_SETTLED');
const received=[...remainder.envelope.tasks,...recovery.envelope.tasks],expected=[...plan.requests.slice(1),plan.requests[0]],ids=new Set(),newRows=[],languageFlags=[];
for(const [index,task] of received.entries()){
  const request=expected[index],result=task?.result?.[0],items=result?.items;
  if(task?.status_code!==20000||task?.cost!==0.0144||typeof task.id!=='string'||ids.has(task.id)||task.data?.keywords?.[0]!==request.keywords[0]||task.data?.location_code!==2158||task.data?.language_code!=='zh-TW'||task.data?.limit!==20||task.data?.offset!==20||result?.location_code!==2158||result?.language_code!=='zh-TW'||!Array.isArray(items)||items.length!==20)throw new Error(`REVIEW_TASK_${index}_INVALID`);
  ids.add(task.id);
  for(const item of items){
    const query=item?.keyword,detected=item?.keyword_properties?.detected_language,another=item?.keyword_properties?.is_another_language;
    if(typeof query!=='string'||item.location_code!==2158||item.language_code!=='zh-TW')throw new Error(`REVIEW_ITEM_${index}_INVALID`);
    if(another===true||(detected&&detected!=='zh-TW'))languageFlags.push({query,source_seed:request.keywords[0],detected_language:detected??null,is_another_language:another??null});
    newRows.push({query,source_seed:request.keywords[0],source_task_index:index,location_code:2158,language_code:'zh-TW',volume:item.keyword_info?.search_volume??null,kd:item.keyword_properties?.keyword_difficulty??null,intent:{informational:'informational',commercial:'commercial',transactional:'transactional',navigational:'navigational'}[item.search_intent_info?.main_intent]??null,observed_at:index<4?remainder.retrieved_at:recovery.retrieved_at});
  }
}
const allRows=[...original.rows,...newRows],quality=balanceDiscoveryRows(allRows,{seeds,profiles,per_seed_quota:10,minimum_per_seed:5});
const selectedKeys=new Set(quality.selected.map(row=>row.dedupe_key));
const selectedLanguageFlags=languageFlags.filter(row=>selectedKeys.has(keywordDedupeKey(row.query)));
const originalKeys=new Set(original.rows.map(row=>keywordDedupeKey(row.query)));
const semanticReview=quality.selected.filter(row=>!originalKeys.has(row.dedupe_key)&&!canonicalKeyword(row.query).includes(canonicalKeyword(row.source_seed))).map(row=>({query:row.query,source_seed:row.source_seed,reason:'TOPIC_ANCHOR_NOT_EXACT_SEED'}));
const groups=new Map();for(const row of allRows){const key=keywordDedupeKey(row.query),group=groups.get(key)??[];group.push({query:row.query,source_seed:row.source_seed});groups.set(key,group);}
const duplicateGroups=[...groups.values()].filter(group=>group.length>1);
const complete=quality.selected.length===60&&seeds.every(seed=>quality.per_seed[seed].selected===10);
const hold=!quality.ok||!complete||selectedLanguageFlags.length>0||semanticReview.length>0;
const report={schema_version:1,mode:'offline_post_expansion_review',created_at:new Date().toISOString(),network_dispatch:false,website_pilot_started:false,source_sha256:Object.fromEntries(Object.entries(bytes).map(([key,value])=>[key,sha(value)])),plan_sha256:plan.plan_sha256,provider_task_ids:[...ids],confirmed_expansion_microusd:86400,first_attempt_result_lost:true,first_seed_recovered:true,raw_rows:allRows.length,qualified_quota_complete:complete,decision:hold?'HOLD_FOR_MANUAL_QUALITY_REVIEW':quality.decision,policy_decision:quality.decision,policy_errors:quality.errors,metrics:quality.metrics,per_seed:quality.per_seed,selected_rows:quality.selected,selected_language_flags:selectedLanguageFlags,semantic_review:semanticReview,duplicate_groups:duplicateGroups,auto_enter_allowed:false};
const target=`${data}/candidate-expansion-post-review-v4.json`;
if(fs.existsSync(target))throw new Error('POST_REVIEW_ALREADY_EXISTS');
atomicExpansionArtifact(target,report);
console.log(JSON.stringify({ok:true,decision:report.decision,qualified_quota_complete:complete,selected:quality.selected.length,raw_rows:allRows.length,duplicate_ratio:quality.metrics.duplicate_ratio,language_review:selectedLanguageFlags.length,semantic_review:semanticReview.length,source_sha256:report.source_sha256}));
