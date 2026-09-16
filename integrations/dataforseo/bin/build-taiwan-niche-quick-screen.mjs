import fs from 'node:fs';
import crypto from 'node:crypto';
import {atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

const selected={
  home:['租屋收納','小坪數家具','居家除濕'],pets:['寵物外出用品','寵物友善住宿','寵物居家清潔'],hobby:['桌遊推薦','露營裝備整理','咖啡器材入門'],travel:['台灣親子景點','台灣雨天景點','台灣步道攻略'],learning:['Excel工作技巧','Notion工作流程','影片剪輯入門'],small_business:['餐飲記帳工具','預約排程工具','接案報價工具'],food:['氣炸鍋食譜','電鍋料理','食材保存方法'],digital:['網站架設工具','無程式碼工具','PDF工作流程'],mobility:['自行車配件','行車記錄器比較','大眾運輸旅行規劃'],lifestyle:['二手物品整理','旅行收納用品','租屋族家電']
};
const calibrationRelated=new Set(['餐飲記帳工具','英文學習規劃','網站架設工具']);
const input=process.argv[2]??'/var/lib/page-autodev/dataforseo/taiwan-niche-candidates-v1.json',output=process.argv[3]??'/var/lib/page-autodev/dataforseo/taiwan-niche-quick-screen-v1.json';
const bytes=fs.readFileSync(input),sourceSha=crypto.createHash('sha256').update(bytes).digest('hex');
const expectedSourceSha=process.argv[4]??'6603e56db1593772c57930805379048e2e2ffffff6d473439675cb102112308a';
if(sourceSha!==expectedSourceSha)throw new Error('CANDIDATE_SOURCE_CHANGED');
if(fs.existsSync(output))throw new Error('OUTPUT_ALREADY_EXISTS');
const pool=JSON.parse(bytes),wanted=new Set(Object.values(selected).flat());
if(pool.candidate_count!==100||wanted.size!==30)throw new Error('SCREEN_SCOPE_INVALID');
const shortlist=pool.candidates.filter(row=>wanted.has(row.topic)).map(row=>({...row,stage:'QUICK_SCREEN',validation_status:'SHORTLISTED_PENDING_EXTERNAL_EVIDENCE',screen_basis:['LOW_YMYL_RISK','MULTI_QUERY_CLUSTER_HYPOTHESIS','POTENTIAL_TOOL_DATABASE_OR_COMPARISON_ASSET','PLAUSIBLE_MONETIZATION_PATH'],calibration_transfer:calibrationRelated.has(row.topic)?'DIRECTIONAL_ONLY_NOT_EVIDENCE':'NONE'}));
if(shortlist.length!==30||new Set(shortlist.map(row=>row.category)).size!==10||Object.keys(selected).some(category=>shortlist.filter(row=>row.category===category).length!==3))throw new Error('SCREEN_BALANCE_INVALID');
atomicExpansionArtifact(output,{schema_version:1,generated_at:new Date().toISOString(),source_candidates_sha256:sourceSha,market:'Taiwan',language:'zh-TW',mode:'ZERO_COST_FEASIBILITY_QUICK_SCREEN',paid_api_spend_microusd:0,selection_count:30,automatic_enter:false,niche_scores_assigned:false,serp_validated:false,shortlist,next_gate:'DEEP_VALIDATE_10_WITH_FRESH_QUERY_AND_SERP_EVIDENCE'});
console.log(JSON.stringify({ok:true,output,selection_count:shortlist.length,paid_api_spend_microusd:0}));
