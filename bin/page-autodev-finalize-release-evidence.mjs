#!/usr/bin/env node
import { finalizeReleaseEvidence,readJson,readJsonLines } from '../lib/release-evidence-finalizer.mjs';
import { writeJsonDurable } from '../lib/soak-evidence-chain.mjs';
const [preflightPath,deathPath,canaryPath,readinessPath,soakPath,output]=process.argv.slice(2),branch=process.env.RELEASE_CANDIDATE_EXPECTED_BRANCH,head=process.env.RELEASE_CANDIDATE_EXPECTED_HEAD,live=process.env.RELEASE_LIVE_EXPECTED_HEAD;
if(!preflightPath||!deathPath||!canaryPath||!readinessPath||!soakPath||!output)throw new Error('Usage: finalize <preflight.json> <death.json> <canary.json> <readiness.json> <soak.jsonl> <output.json>');
const receipt=finalizeReleaseEvidence({candidate_branch:branch,candidate_head:head,live_head:live,preflight:readJson(preflightPath),death:readJson(deathPath),canary:readJson(canaryPath),readiness:readJson(readinessPath),soak_lines:readJsonLines(soakPath)});writeJsonDurable(output,receipt);console.log(JSON.stringify({decision:receipt.decision,deploy_authorized:receipt.deploy_authorized,output,sha256:receipt.sha256}));
