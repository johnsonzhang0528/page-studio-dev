#!/usr/bin/env node
import fs from 'node:fs';
import {buildFreeBusinessDeathTest} from '../lib/free-business-death-test.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-free-commercial-shortlist-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-free-business-death-test-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildFreeBusinessDeathTest(source),created_at:new Date().toISOString(),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,evaluated_count:output.evaluated_count,decision_counts:output.decision_counts,paid_api_spend_microusd:0,output:outputPath}));
