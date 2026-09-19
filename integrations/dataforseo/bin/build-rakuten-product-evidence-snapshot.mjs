#!/usr/bin/env node
import fs from 'node:fs';
import {buildRakutenProductEvidenceSnapshot} from '../lib/rakuten-product-evidence-snapshot.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-affiliate-channel-verification-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-rakuten-product-evidence-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildRakutenProductEvidenceSnapshot(source),created_at:new Date().toISOString(),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,candidate_count:output.candidate_count,decision_counts:Object.fromEntries([...new Set(output.candidates.map(row=>row.decision))].map(decision=>[decision,output.candidates.filter(row=>row.decision===decision).length])),paid_api_spend_microusd:0,output:outputPath}));
