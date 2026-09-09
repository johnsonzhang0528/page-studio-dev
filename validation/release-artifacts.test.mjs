import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=JSON.parse(fs.readFileSync(new URL('../project-template/.ai/QUALITY_CONTRACT.json',import.meta.url),'utf8'));
assert.equal(contract.schema_version,1); assert.equal(contract.allow_shell,false); assert.equal(contract.receipt_required,true);
assert.ok(contract.checks.some(check=>check.id==='test'&&check.required&&Array.isArray(check.argv)));
assert.ok(contract.checks.every(check=>Array.isArray(check.argv)&&check.argv.every(value=>typeof value==='string')&&!check.argv.some(value=>/[;&|`$<>]/.test(value))));

const config=JSON.parse(fs.readFileSync(new URL('../project-template/.ai/AUTODEV_CONFIG.json',import.meta.url),'utf8'));
assert.equal(config.allow_deploy,false); assert.equal(config.complexity_control.rollout,'shadow');
assert.equal(config.rollout.mode,'shadow');
for(const feature of ['quota_coordinator','compact_handoff','architecture_ir','risk_tiered_routing']) assert.equal(config.rollout.features[feature],true,`${feature} must be enabled in the release template`);
assert.equal(config.account_quota_admission.enabled,true);
const service=fs.readFileSync(new URL('../systemd/page-autodev@.service',import.meta.url),'utf8');
for(const rule of ['NoNewPrivileges=true','PrivateTmp=true','PrivateDevices=true','ProtectSystem=strict','ProtectHome=true','ProtectKernelModules=true','ProtectKernelTunables=true','RestrictNamespaces=true','RestrictSUIDSGID=true','CapabilityBoundingSet=','SystemCallArchitectures=native','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','UMask=0077','ReadWritePaths=']) assert.ok(service.includes(rule),`systemd must retain ${rule}`);
const runbook=fs.readFileSync(new URL('../docs/OPERATOR_RUNBOOK.md',import.meta.url),'utf8'),readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
for(const command of ['migration-report','migrate-workflow-apply','rollback-workflow-migration']) assert.ok(runbook.includes(command)&&readme.includes(command),`${command} must be documented`);
console.log('RELEASE_ARTIFACTS_TESTS_OK');
