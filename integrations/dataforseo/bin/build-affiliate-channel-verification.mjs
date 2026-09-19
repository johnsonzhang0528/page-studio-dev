#!/usr/bin/env node
import fs from 'node:fs';
import {buildAffiliateChannelVerification} from '../lib/affiliate-channel-verification.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-affiliate-economics-stress-test-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-affiliate-channel-verification-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildAffiliateChannelVerification(source),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,candidate_count:output.candidates.length,channel_count:output.channels.length,closed_or_disqualified:output.channels.filter(row=>row.status==='CLOSED'||row.status==='CLOSED_TO_NEW_AFFILIATES').map(row=>row.id),paid_api_spend_microusd:0,output:outputPath}));
