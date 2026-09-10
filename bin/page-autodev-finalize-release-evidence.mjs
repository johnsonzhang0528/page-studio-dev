#!/usr/bin/env node
import fs from 'node:fs';
import { finalizeReleaseEvidence,readJson,readJsonLines } from '../lib/release-evidence-finalizer.mjs';
const [preflightPath,deathPath,soakPath,output]=process.argv.slice(2),branch=process.env.RELEASE_CANDIDATE_EXPECTED_BRANCH,head=process.env.RELEASE_CANDIDATE_EXPECTED_HEAD,live=process.env.RELEASE_LIVE_EXPECTED_HEAD;
if(!preflightPath||!deathPath||!soakPath||!output)throw new Error('Usage: finalize <preflight.json> <death.json> <soak.jsonl> <output.json>');
const receipt=finalizeReleaseEvidence({candidate_branch:branch,candidate_head:head,live_head:live,preflight:readJson(preflightPath),death:readJson(deathPath),soak_lines:readJsonLines(soakPath)}),temporary=`${output}.${process.pid}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(receipt,null,2)}\n`,{mode:0o600});fs.renameSync(temporary,output);console.log(JSON.stringify({decision:receipt.decision,deploy_authorized:receipt.deploy_authorized,output,sha256:receipt.sha256}));
