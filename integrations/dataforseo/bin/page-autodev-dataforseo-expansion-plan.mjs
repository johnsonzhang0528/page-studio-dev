import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildCandidateExpansionPlan} from '../lib/candidate-expansion-plan.mjs';

if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('ROOT_LINUX_EXPANSION_PLAN_REQUIRED');
const root='/var/lib/page-autodev/dataforseo';
const source=`${root}/calibration-60-v3-shadow.json`;
const target=`${root}/candidate-expansion-plan-v1.json`;
const sourceBytes=fs.readFileSync(source);
const shadow=JSON.parse(sourceBytes.toString('utf8'));
const profiles=JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-topic-profiles.json',import.meta.url),'utf8'));
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));
const plan=buildCandidateExpansionPlan({shadow,seeds:Object.keys(profiles),registry,source_shadow_sha256:crypto.createHash('sha256').update(sourceBytes).digest('hex')});
const temporary=`${target}.${process.pid}.tmp`;
fs.writeFileSync(temporary,`${JSON.stringify(plan,null,2)}\n`,{mode:0o600,flag:'wx'});
fs.renameSync(temporary,target);
console.log(JSON.stringify({ok:true,decision:plan.decision,task_count:plan.task_count,total_deficit:plan.total_deficit,max_usd:plan.max_usd,network_dispatch:plan.network_dispatch,plan_sha256:plan.plan_sha256}));
