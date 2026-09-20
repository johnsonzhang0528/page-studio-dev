#!/usr/bin/env node
import fs from 'node:fs';
import {buildCategoryAffiliateSample} from '../lib/category-affiliate-sample.mjs';

const sourcePath='/var/lib/page-autodev/dataforseo/taiwan-niche-rakuten-product-evidence-v1.json';
const outputPath='/var/lib/page-autodev/dataforseo/taiwan-niche-baking-mold-affiliate-sample-v1.json';
const source=JSON.parse(fs.readFileSync(sourcePath,'utf8'));
const output={...buildCategoryAffiliateSample(source),created_at:new Date().toISOString(),source:sourcePath};
fs.writeFileSync(outputPath,`${JSON.stringify(output,null,2)}\n`,{mode:0o600});
console.log(JSON.stringify({ok:true,topic:output.topic,products:output.distinct_product_count,sellers:output.distinct_seller_count,median_price_twd:output.median_price_twd,median_rate_bps:output.median_rate_bps,decision:output.decision,paid_api_spend_microusd:0,output:outputPath}));
