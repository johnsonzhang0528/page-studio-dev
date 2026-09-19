import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildNicheMonetizationPrefilter} from '../lib/niche-monetization-prefilter.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_MONETIZATION_PREFILTER_REQUIRED');
const source=process.argv[2]??'/var/lib/page-autodev/dataforseo/taiwan-niche-candidates-v1.json';
const target=process.argv[3]??'/var/lib/page-autodev/dataforseo/taiwan-niche-monetization-prefilter-v1.json';
const bytes=fs.readFileSync(source);
const result={...buildNicheMonetizationPrefilter(JSON.parse(bytes)),created_at:new Date().toISOString(),source:{path:source,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}};
const temporary=`${target}.tmp-${process.pid}`;
fs.writeFileSync(temporary,`${JSON.stringify(result,null,2)}\n`,{mode:0o600});
fs.renameSync(temporary,target);
console.log(JSON.stringify({ok:true,advance_count:result.advance_count,hold_count:result.hold_count,paid_api_spend_microusd:0,output:target}));
