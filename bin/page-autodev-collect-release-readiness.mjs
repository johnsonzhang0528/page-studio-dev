#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMigrationInventory } from '../lib/migration-inventory.mjs';
import { writeJsonDurable } from '../lib/soak-evidence-chain.mjs';

const [output,...projects]=process.argv.slice(2);if(!output||projects.length===0)throw new Error('Usage: collect-release-readiness <output.json> <project>...');
const root=fileURLToPath(new URL('..',import.meta.url)),run=args=>{const result=spawnSync('git',['-C',root,...args],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);return result.stdout.trim();},candidate={branch:run(['branch','--show-current']),head:run(['rev-parse','HEAD'])};
if(candidate.branch!==process.env.RELEASE_CANDIDATE_EXPECTED_BRANCH||candidate.head!==process.env.RELEASE_CANDIDATE_EXPECTED_HEAD)throw new Error('RELEASE_READINESS_CANDIDATE_MISMATCH');
const servicePath=path.join(root,'systemd','page-autodev@.service'),service=fs.readFileSync(servicePath,'utf8'),required=['NoNewPrivileges=true','PrivateTmp=true','PrivateDevices=true','ProtectSystem=strict','ProtectHome=true','ProtectProc=invisible','RestrictNamespaces=true','RestrictSUIDSGID=true','CapabilityBoundingSet=','UMask=0077','ReadOnlyPaths=','ReadWritePaths=','InaccessiblePaths='];
const inventories=projects.map(project=>buildMigrationInventory(fs.realpathSync(project))).map(report=>({project_id:report.project_id,head:report.head,dirty_paths:report.dirty_paths,phase:report.phase,input_revision:report.input_revision,transactions:report.transactions,leases:report.leases,parallel_state:report.parallel_state,inventory_sha256:report.inventory_sha256}));
const readiness={schema_version:1,kind:'release_readiness_evidence',ok:required.every(rule=>service.includes(rule)),candidate,live_head:process.env.RELEASE_LIVE_EXPECTED_HEAD??null,service_security:{artifact:'systemd/page-autodev@.service',sha256:crypto.createHash('sha256').update(service).digest('hex'),required_rules:required,missing_rules:required.filter(rule=>!service.includes(rule))},inventories};readiness.sha256=crypto.createHash('sha256').update(JSON.stringify(readiness)).digest('hex');writeJsonDurable(output,readiness);console.log(JSON.stringify({ok:readiness.ok,output,candidate,projects:inventories.length,sha256:readiness.sha256}));if(!readiness.ok)process.exitCode=1;
