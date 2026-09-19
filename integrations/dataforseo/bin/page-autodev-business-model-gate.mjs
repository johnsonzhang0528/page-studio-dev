import fs from 'node:fs';
import crypto from 'node:crypto';
import {evaluateBusinessModelGate} from '../lib/business-model-gate.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_BUSINESS_MODEL_GATE_REQUIRED');
const source=process.argv[2]??'/var/lib/page-autodev/dataforseo/pilot-economics-scenario-v1.json';
const target=process.argv[3]??'/var/lib/page-autodev/dataforseo/business-model-unit-economics-gate-v2.json';
const bytes=fs.readFileSync(source);
const prior=JSON.parse(bytes);
const unknown={channel_eligibility:'UNVERIFIED',search_intent_fit:'UNVERIFIED',revenue_rate:'UNVERIFIED',traffic_requirement:'UNVERIFIED',operating_cost:'UNVERIFIED',legal_policy:'UNVERIFIED',dependency_resilience:'UNVERIFIED',worst_case_viability:'UNVERIFIED',kill_rule:'VERIFIED'};
const scenarios=[{name:'CONSERVATIVE',status:'ASSUMPTION_ONLY'},{name:'BASE',status:'ASSUMPTION_ONLY'},{name:'UPSIDE',status:'ASSUMPTION_ONLY'}];
const common={requires_manual_product_production:false,requires_manual_customer_fulfillment:false,automation_ratio_bps:9500,ongoing_manual_hours_per_1000_visits:2,evidence:unknown,economic_scenarios:scenarios};
const input={schema_version:2,niche_id:'excel-work-tips',pilot_cash_cap_twd:prior?.pilot?.cash_cap_twd??1500,pilot_hour_cap:prior?.pilot?.hour_cap??20,models:[
  {...common,id:'original-excel-products',type:'DIGITAL_PRODUCT',requires_manual_product_production:true,automation_ratio_bps:7000,ongoing_manual_hours_per_1000_visits:4},
  {...common,id:'display-ads',type:'DISPLAY_ADS',evidence:{...unknown,channel_eligibility:'VERIFIED',search_intent_fit:'VERIFIED',legal_policy:'VERIFIED'}},
  {...common,id:'affiliate',type:'AFFILIATE',evidence:{...unknown,channel_eligibility:'VERIFIED',search_intent_fit:'DISPROVEN',legal_policy:'VERIFIED'}},
  {...common,id:'free-tool-monetization',type:'AUTOMATED_TOOL'}
]};
const result={...evaluateBusinessModelGate(input),created_at:new Date().toISOString(),source:{path:source,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},observations:{selected_query_volume_sum:22480,selected_query_count:10,informational_query_count:10,commercial_query_count:0},evidence_sources:[
  {claim:'ADSENSE_TAIWAN_AND_ORIGINAL_SITE_ELIGIBILITY',url:'https://support.google.com/adsense/answer/13402307',status:'VERIFIED'},
  {claim:'ADSENSE_SITE_REVIEW_REQUIRED',url:'https://support.google.com/adsense/answer/10162',status:'VERIFIED'},
  {claim:'COURSERA_AFFILIATE_CHANNEL_EXISTS',url:'https://www.coursera.org/about/affiliates',status:'VERIFIED'},
  {claim:'UDEMY_AFFILIATE_REQUIRES_APPLICATION',url:'https://partnersupport.udemy.com/hc/en-us/articles/360049411933-Who-can-Participate-in-the-Udemy-Affiliate-Program',status:'VERIFIED'},
  {claim:'MICROSOFT_TAIWAN_CONSUMER_AFFILIATE_CURRENT',url:null,status:'UNVERIFIED'}
]};
fs.mkdirSync(new URL('.',`file://${target}`).pathname,{recursive:true,mode:0o700});
const temporary=`${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
fs.renameSync(temporary,target);
console.log(JSON.stringify({ok:true,decision:result.decision,models:result.models.map(row=>({id:row.id,decision:row.decision})),output:target}));
