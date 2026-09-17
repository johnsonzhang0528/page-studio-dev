import fs from 'node:fs';
import crypto from 'node:crypto';
import {evaluateBusinessModelGate} from '../lib/business-model-gate.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_BUSINESS_MODEL_GATE_REQUIRED');
const source=process.argv[2]??'/var/lib/page-autodev/dataforseo/pilot-economics-scenario-v1.json';
const target=process.argv[3]??'/var/lib/page-autodev/dataforseo/business-model-unit-economics-gate-v1.json';
const bytes=fs.readFileSync(source);
const prior=JSON.parse(bytes);
const input={
  schema_version:1,
  pilot_cash_cap_twd:prior?.pilot?.cash_cap_twd??1500,
  pilot_hour_cap:prior?.pilot?.hour_cap??20,
  operator_hour_value_twd:null,
  evidence:{product_demand:'UNVERIFIED',price_willingness:'UNVERIFIED',checkout_payout:'UNVERIFIED'},
  product_scenarios:[
    {name:'CONSERVATIVE',price_twd:199,fee_buffer_bps:1500},
    {name:'BASE',price_twd:399,fee_buffer_bps:1500},
    {name:'UPSIDE',price_twd:699,fee_buffer_bps:1500}
  ]
};
const result={...evaluateBusinessModelGate(input),created_at:new Date().toISOString(),source:{path:source,sha256:crypto.createHash('sha256').update(bytes).digest('hex')},verified_facts:{taiwan_payout_country_supported:true,twd_selling_currency_supported:true,merchant_store_activation_review_required:true},sources:[
  'https://docs.lemonsqueezy.com/help/getting-started/supported-countries',
  'https://docs.lemonsqueezy.com/help/payments/currencies',
  'https://docs.lemonsqueezy.com/help/getting-started/activate-your-store',
  'https://docs.lemonsqueezy.com/help/getting-started/fees'
]};
fs.mkdirSync(new URL('.',`file://${target}`).pathname,{recursive:true,mode:0o700});
const temporary=`${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
fs.renameSync(temporary,target);
console.log(JSON.stringify({ok:true,decision:result.decision,blockers:result.blockers,output:target}));
