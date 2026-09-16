import fs from 'node:fs';
import {atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

const groups={
  home:['租屋收納','小坪數家具','居家除濕','居家隔音','居家照明規劃','浴室清潔','廚房收納','居家防蟲','陽台園藝','搬家整理'],
  pets:['新手養貓用品','貓砂比較','寵物外出用品','寵物友善住宿','寵物攝影','水族箱造景','小型犬用品','寵物居家清潔','寵物智能用品','寵物玩具評測'],
  hobby:['手作皮件','模型製作','桌遊推薦','露營裝備整理','咖啡器材入門','居家烘焙工具','攝影配件','電子琴自學','釣魚裝備入門','拼圖與益智玩具'],
  travel:['台灣親子景點','台灣雨天景點','台灣步道攻略','台灣單車路線','台灣露營地整理','台灣寵物友善景點','台灣火車小旅行','台灣離島旅行','台灣賞花行程','台灣夜市攻略'],
  learning:['簡報設計學習','Excel工作技巧','Notion工作流程','中文打字練習','英文學習規劃','日文自學資源','攝影構圖教學','影片剪輯入門','程式設計入門','居家整理學習'],
  small_business:['餐飲記帳工具','小店庫存管理','預約排程工具','接案報價工具','社群排程工具','電子發票工具','菜單設計工具','表單自動化','小店會員管理','電商出貨工具'],
  food:['氣炸鍋食譜','電鍋料理','便當菜規劃','咖啡豆沖煮','烘焙模具比較','廚房小家電比較','露營料理','素食餐廳整理','地方小吃地圖','食材保存方法'],
  digital:['網站架設工具','無程式碼工具','密碼管理工具','雲端備份工具','PDF工作流程','遠端工作工具','筆記軟體比較','專案管理工具','AI會議整理工具','圖片壓縮工具'],
  mobility:['自行車配件','機車收納用品','行車記錄器比較','車用吸塵器','電動自行車入門','通勤背包比較','安全帽收納','汽車露營用品','兒童自行車選購','大眾運輸旅行規劃'],
  lifestyle:['婚禮小物製作','生日派對佈置','居家香氛','二手物品整理','環保清潔用品','親子手作活動','節慶佈置','桌面整理用品','旅行收納用品','租屋族家電']
};
const sourceUrls=['https://data.gov.tw/','https://www.stat.gov.tw/StandardIndustrialClassificationContent.aspx?Level=4&PID=NDg3MQ%3D%3D&RID=11&n=3144&sms=11195','https://trends.google.com.tw/trending?geo=TW&hl=zh-TW'];
const highRisk=/(醫療|疾病|藥|保健|法律|律師|投資|股票|保險|貸款|加密貨幣|減肥|治療|診斷)/;
const candidates=[];let index=0;
for(const [category,topics] of Object.entries(groups))for(const topic of topics){
  index++;if(highRisk.test(topic))throw new Error(`HIGH_RISK_TOPIC:${topic}`);
  candidates.push({candidate_id:`TW-${String(index).padStart(3,'0')}`,topic,category,market:'Taiwan',language:'zh-TW',stage:'CANDIDATE',validation_status:'UNVALIDATED',scores:{demand:null,serp_attainability:null,click_potential:null,expandability:null,execution_advantage:null,strategic_value:null,stability:null},confidence:'C',decision:null,automatic_enter:false,evidence_status:'TAXONOMY_HYPOTHESIS_ONLY'});
}
if(candidates.length!==100||new Set(candidates.map(row=>row.topic)).size!==100)throw new Error('CANDIDATE_POOL_INVALID');
const output=process.argv[2]??'/var/lib/page-autodev/dataforseo/taiwan-niche-candidates-v1.json';
if(fs.existsSync(output))throw new Error('OUTPUT_ALREADY_EXISTS');
atomicExpansionArtifact(output,{schema_version:1,generated_at:new Date().toISOString(),market:'Taiwan',language:'zh-TW',mode:'FREE_SOURCE_TAXONOMY_DISCOVERY',paid_api_spend_microusd:0,source_urls:sourceUrls,exclusions:['medical','legal','financial','investment','insurance','diagnosis_or_treatment_claims'],candidate_count:100,automatic_enter:false,notes:['Candidate inclusion does not prove demand.','All seven Niche Score dimensions remain missing until evidence is collected.','Current Google trending searches are discovery hints only and cannot directly promote a niche.'],candidates,next_gate:'QUICK_SCREEN_30'});
console.log(JSON.stringify({ok:true,output,candidate_count:candidates.length,paid_api_spend_microusd:0}));
