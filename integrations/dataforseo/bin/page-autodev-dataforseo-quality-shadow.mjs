import fs from 'node:fs';
import crypto from 'node:crypto';
import {balanceDiscoveryRows} from '../lib/discovery-quality.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_QUALITY_SHADOW_REQUIRED');
const root='/var/lib/page-autodev/dataforseo',source=`${root}/calibration-60-v2.json`,target=`${root}/calibration-60-v3-shadow.json`;
const sourceBytes=fs.readFileSync(source),artifact=JSON.parse(sourceBytes.toString('utf8'));
const profiles=JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-topic-profiles.json',import.meta.url),'utf8'));
const seeds=Object.keys(profiles),quality=balanceDiscoveryRows(artifact.rows,{seeds,profiles,per_seed_quota:10,minimum_per_seed:5});
const complete=quality.selected.length===seeds.length*10&&seeds.every(seed=>quality.per_seed[seed].selected===10);
const decision=quality.ok&&complete?quality.decision:'HOLD_FOR_CANDIDATE_EXPANSION';
const output={schema_version:1,mode:'offline_quality_shadow',network_dispatch:false,source_artifact_sha256:crypto.createHash('sha256').update(sourceBytes).digest('hex'),evaluated_at:new Date().toISOString(),decision,quality,selected_rows:quality.selected};
const temporary=`${target}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(output,null,2)}\n`,{mode:0o600,flag:'wx'});fs.renameSync(temporary,target);
console.log(JSON.stringify({ok:true,decision,metrics:quality.metrics,per_seed:quality.per_seed}));
