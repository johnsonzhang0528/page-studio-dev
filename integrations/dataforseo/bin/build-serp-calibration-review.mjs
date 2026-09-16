import fs from 'node:fs';
import crypto from 'node:crypto';
import {atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

const base=process.argv[2]??'/var/lib/page-autodev/dataforseo';
const output=process.argv[3]??`${base}/serp-calibration-12-review-v1.json`;
const expected={
  '免費架設網站':{decision:'HOLD',opportunity:'LOW',reason:'PLATFORM_AND_BRAND_DOMINANCE'},
  'wordpress 架設網站':{decision:'PILOT',opportunity:'MEDIUM',reason:'MIXED_OFFICIAL_AND_INDEPENDENT_RESULTS'},
  'seo優化':{decision:'HOLD',opportunity:'LOW',reason:'ESTABLISHED_PUBLISHER_AND_AGENCY_DOMINANCE'},
  'seo 軟體':{decision:'HOLD',opportunity:'LOW',reason:'MATURE_LISTICLE_COMPETITION'},
  '電腦版記帳軟體':{decision:'PILOT',opportunity:'HIGH',reason:'FRAGMENTED_PRODUCT_AND_REVIEW_RESULTS'},
  '餐飲業記帳軟體':{decision:'PILOT',opportunity:'HIGH',reason:'FRAGMENTED_VERTICAL_COMMERCIAL_RESULTS'},
  'diy 空氣清淨機':{decision:'HOLD',opportunity:'MEDIUM',reason:'SHOPPING_VIDEO_AND_COMMUNITY_INTENT_MIX'},
  '氣喘空氣清淨機':{decision:'REJECT',opportunity:'LOW',reason:'YMYL_EVIDENCE_AND_PRODUCT_SAFETY_RISK'},
  '日本自由行推薦':{decision:'HOLD',opportunity:'LOW',reason:'TRAVEL_PUBLISHER_AND_BOOKING_DOMINANCE'},
  '日本大阪自由行':{decision:'HOLD',opportunity:'LOW',reason:'COMMERCIAL_TRAVEL_AND_SERP_FEATURE_DOMINANCE'},
  '學英文':{decision:'HOLD',opportunity:'LOW',reason:'PLATFORM_GOVERNMENT_AND_LOCAL_INTENT_MIX'},
  '英文 學習規劃':{decision:'PILOT',opportunity:'MEDIUM',reason:'INDEPENDENT_INFORMATIONAL_RESULTS_PRESENT'}
};
const ugc=new Set(['www.dcard.tw','www.threads.com','www.reddit.com','www.facebook.com','www.mobile01.com','www.ptt.cc','medium.com']);
const receipts=[];
for(let index=1;index<=12;index++){
  const file=`${base}/serp-calibration-12-result-${String(index).padStart(2,'0')}-v1.json`;
  const bytes=fs.readFileSync(file),source_sha256=crypto.createHash('sha256').update(bytes).digest('hex'),record=JSON.parse(bytes);
  const task=record.envelope?.tasks?.[0],result=task?.result?.[0],items=result?.items;
  if(record.provider_cost_microusd!==2000||task?.status_code!==20000||!Array.isArray(items))throw new Error(`SOURCE_INVALID:${index}`);
  const organic=items.filter(item=>item.type==='organic').map(item=>({rank:item.rank_group,domain:item.domain,url:item.url,title:item.title}));
  const query=record.request.keyword,assessment=expected[query];
  if(!assessment||organic.length<7)throw new Error(`REVIEW_SCOPE_INVALID:${query}`);
  const types=[...new Set(items.map(item=>item.type))];
  receipts.push({
    index,query,source_sha256,provider_task_id:record.provider_task_id,cost_microusd:record.provider_cost_microusd,
    organic_count:organic.length,unique_domain_count:new Set(organic.map(item=>item.domain)).size,
    ugc_count:organic.filter(item=>ugc.has(item.domain)).length,
    has_ai_overview:types.includes('ai_overview'),has_paid_results:types.includes('paid'),has_video:types.includes('video')||types.includes('short_videos'),
    result_types:types,top_domains:organic.slice(0,10).map(item=>item.domain),...assessment
  });
}
const totals={task_count:receipts.length,cost_microusd:receipts.reduce((sum,row)=>sum+row.cost_microusd,0),pilot:receipts.filter(row=>row.decision==='PILOT').length,hold:receipts.filter(row=>row.decision==='HOLD').length,reject:receipts.filter(row=>row.decision==='REJECT').length};
if(totals.task_count!==12||totals.cost_microusd!==24000||totals.pilot+totals.hold+totals.reject!==12)throw new Error('TOTALS_INVALID');
atomicExpansionArtifact(output,{schema_version:1,generated_at:new Date().toISOString(),mode:'offline_post_serp_review',market:'Taiwan',language:'zh-TW',automatic_enter:false,url_approval:false,totals,assessments:receipts,next_gate:'HUMAN_REVIEW_BEFORE_URL_OR_NICHE_PROMOTION'});
console.log(JSON.stringify({ok:true,output,totals}));
