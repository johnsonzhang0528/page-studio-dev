#!/usr/bin/env node
import fs from 'node:fs';
import {buildDashcamFreeSerpReview} from '../lib/dashcam-free-serp-review.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-affiliate-sample-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-free-serp-review-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildDashcamFreeSerpReview(source),created_at:new Date().toISOString(),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,topic:output.topic,commercial_intent_queries:output.commercial_intent_queries,independent_editorial_domains:output.independent_editorial_domains,decision:output.decision,paid_research_authorized:false,paid_api_spend_microusd:0,output:outputPath}));
