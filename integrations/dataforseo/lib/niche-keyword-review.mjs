import {canonicalKeyword,keywordDedupeKey} from './discovery-quality.mjs';

const profiles={
  '租屋收納':{groups:[['租屋','搬家'],['收納']]},
  '寵物友善住宿':{groups:[['寵物'],['住宿','民宿','飯店']]},
  '桌遊推薦':{groups:[['桌遊']]},
  '台灣雨天景點':{groups:[['雨天','下雨'],['景點','行程','室內']]},
  'Excel工作技巧':{groups:[['excel','vlookup','countif','power query','csv to excel','json to excel']],exact_excludes:['excel']},
  '預約排程工具':{groups:[['預約','排程','行事曆','日程','booking','calendar']]},
  '氣炸鍋食譜':{groups:[['氣炸鍋']]},
  'PDF工作流程':{groups:[['pdf'],['工作流程','流程','自動化','簽署','合併','轉檔','壓縮']]},
  '大眾運輸旅行規劃':{groups:[['大眾運輸','客運','公車','火車','捷運'],['規劃','行程','路線','轉乘','時刻','訂票']],brand_terms:['和欣','統聯','國光','首都','南投客運']},
  '租屋族家電':{groups:[['租屋','租屋族'],['家電','電器']]}
};
const blocked=['破解版','破解','盜版','crack','keygen','torrent'];
const staleYear=(query,year)=>[...query.matchAll(/(?:^|\D)((?:19|20)\d{2})(?=\D|$)/gu)].some(match=>Number(match[1])<year-1);
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null;};

export function reviewNicheKeywordIdeas(artifact,{current_year=new Date().getUTCFullYear()}={}){
  if(artifact?.schema_version!==1||artifact?.task_count!==10||artifact?.candidates?.length!==10)throw new Error('NICHE_KEYWORD_ARTIFACT_INVALID');
  const candidates=artifact.candidates.map(candidate=>{
    const profile=profiles[candidate.topic];if(!profile)throw new Error(`PROFILE_MISSING:${candidate.topic}`);const groups=profile.groups;
    const items=candidate.provider_task?.result?.[0]?.items;if(!Array.isArray(items)||items.length!==20)throw new Error(`ITEM_COUNT_INVALID:${candidate.topic}`);
    const seen=new Set(),relevant=[],rejected=[];
    for(const item of items){
      const query=canonicalKeyword(item.keyword),key=keywordDedupeKey(query);
      let reason=null;
      if(!query)reason='INVALID_QUERY';else if(seen.has(key))reason='DUPLICATE';else if(blocked.some(term=>query.includes(term)))reason='POLICY_BLOCKED';else if(staleYear(query,current_year))reason='STALE_YEAR';else if((profile.exact_excludes??[]).map(canonicalKeyword).includes(query))reason='TOO_BROAD_HEAD_TERM';else if(!groups.every(group=>group.some(term=>query.includes(canonicalKeyword(term)))))reason='TOPIC_DRIFT';
      if(reason){rejected.push({query:item.keyword,reason});continue;}seen.add(key);
      relevant.push({query:item.keyword,canonical_query:query,volume:item.keyword_info?.search_volume??null,kd:item.keyword_properties?.keyword_difficulty??null,intent:item.search_intent_info?.main_intent??'unknown',is_brand_query:(profile.brand_terms??[]).some(term=>query.includes(canonicalKeyword(term)))});
    }
    relevant.sort((a,b)=>(b.volume??-1)-(a.volume??-1)||a.canonical_query.localeCompare(b.canonical_query,'zh-TW'));
    const selected=relevant.slice(0,10),volumeSum=selected.reduce((sum,row)=>sum+(Number.isFinite(row.volume)?row.volume:0),0),knownKd=selected.filter(row=>Number.isFinite(row.kd)).map(row=>row.kd),missingKd=selected.length-knownKd.length,navigational=selected.filter(row=>row.intent==='navigational').length,brands=selected.filter(row=>row.is_brand_query).length;
    const metrics={received:items.length,relevant:relevant.length,selected:selected.length,rejected:rejected.length,topic_drift:rejected.filter(row=>row.reason==='TOPIC_DRIFT').length,duplicates:rejected.filter(row=>row.reason==='DUPLICATE').length,stale_years:rejected.filter(row=>row.reason==='STALE_YEAR').length,broad_head_terms:rejected.filter(row=>row.reason==='TOO_BROAD_HEAD_TERM').length,selected_volume_sum:volumeSum,kd_coverage:selected.length?knownKd.length/selected.length:0,median_known_kd:median(knownKd),navigational_ratio:selected.length?navigational/selected.length:0,brand_ratio:selected.length?brands/selected.length:0};
    let decision='READY_FOR_SERP_SELECTION',reason='BOUNDED_RELEVANT_DEMAND_FOUND';
    if(selected.length<3){decision='REJECT_DISCOVERY';reason='INSUFFICIENT_RELEVANT_QUERIES';}
    else if(metrics.navigational_ratio>=0.5){decision='REJECT_NAVIGATIONAL';reason='NAVIGATIONAL_CONCENTRATION';}
    else if((profile.brand_terms??[]).length&&metrics.brand_ratio>=0.5){decision='REJECT_BRAND_CONCENTRATION';reason='BRAND_CONCENTRATION';}
    else if(volumeSum<100){decision='HOLD_LOW_DEMAND';reason='SELECTED_VOLUME_BELOW_100';}
    const opportunity=row=>Math.log10((row.volume??0)+1)*20+(row.kd===null?25:(100-row.kd)*0.3);
    const serp_candidates=decision==='READY_FOR_SERP_SELECTION'?selected.filter(row=>row.intent!=='navigational').sort((a,b)=>opportunity(b)-opportunity(a)||b.volume-a.volume).slice(0,2):[];
    return {candidate_id:candidate.candidate_id,topic:candidate.topic,decision,reason,metrics,selected,rejected,serp_candidates};
  });
  return {schema_version:1,mode:'OFFLINE_REVIEW',writes_to_business_state:false,automatic_enter:false,source_actual_microusd:artifact.actual_microusd,candidate_count:candidates.length,ready_for_serp_count:candidates.filter(row=>row.decision==='READY_FOR_SERP_SELECTION').length,serp_query_count:candidates.reduce((sum,row)=>sum+row.serp_candidates.length,0),serp_dispatch_authorized:false,candidates,next_gate:'OWNER_REVIEW_THEN_EXPLICIT_SERP_COST_APPROVAL'};
}
