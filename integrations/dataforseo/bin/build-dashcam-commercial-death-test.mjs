import fs from 'node:fs';
import {buildDashcamCommercialDeathTest} from '../lib/dashcam-commercial-death-test.mjs';

const demandPath = '/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-paid-demand-results-v2.json';
const affiliatePath = '/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-affiliate-sample-v1.json';
const outputPath = '/var/lib/page-autodev/dataforseo/taiwan-niche-dashcam-commercial-death-test-v1.json';
const demand = JSON.parse(fs.readFileSync(demandPath));
const affiliate = JSON.parse(fs.readFileSync(affiliatePath));
const output = {...buildDashcamCommercialDeathTest(demand, affiliate), created_at: new Date().toISOString(), sources: [demandPath, affiliatePath]};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, {mode: 0o640});
console.log(JSON.stringify({ok: true, decision: output.decision, cluster_disposition: output.cluster_disposition, incremental_paid_api_spend_microusd: 0, output: outputPath}));
