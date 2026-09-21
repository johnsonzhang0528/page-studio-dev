#!/usr/bin/env node
import fs from 'node:fs';
import {buildDashcamPaidDemandPlan} from '../lib/dashcam-paid-demand-plan.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-free-serp-review-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-paid-demand-plan-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildDashcamPaidDemandPlan(source),created_at:new Date().toISOString(),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,plan_sha256:output.plan_sha256,keyword_count:output.keyword_count,serp_task_count:output.serp_task_count,maximum_cost_usd:output.maximum_cost_usd,dispatch_authorized:false,output:outputPath}));
