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
assert.match(service,/^LoadCredential=billing_reservation_credential:\/etc\/page-autodev\/credentials\/billing-reservation-credential$/m);
for(const rule of ['NoNewPrivileges=true','PrivateTmp=true','PrivateDevices=true','ProtectSystem=strict','ProtectHome=true','ProtectKernelModules=true','ProtectKernelTunables=true','ProtectProc=invisible','ProcSubset=pid','RestrictNamespaces=true','RestrictSUIDSGID=true','CapabilityBoundingSet=','SystemCallArchitectures=native','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','UMask=0077','ReadOnlyPaths=','ReadWritePaths=','InaccessiblePaths=']) assert.ok(service.includes(rule),`systemd must retain ${rule}`);
const writable=service.match(/^ReadWritePaths=(.*)$/m)?.[1]??'';assert.ok(writable.includes('%h/page-studio-dev/projects/%i'));assert.ok(writable.includes('%h/.cache/claude'));assert.ok(!writable.includes('%h/.config'),'.config must never be writable');
const readonly=service.match(/^ReadOnlyPaths=(.*)$/m)?.[1]??'';assert.ok(readonly.includes('%h/.config/page-autodev/telegram.env'));assert.ok(!readonly.split(/\s+/).includes('%h/.config'),'only the exact notification credential may be readable');
const inaccessible=service.match(/^InaccessiblePaths=(.*)$/m)?.[1]??'';for(const secretHome of ['%h/.ssh','%h/.aws','%h/.kube','%h/.docker','%h/.gnupg'])assert.ok(inaccessible.includes(secretHome));
const runbook=fs.readFileSync(new URL('../docs/OPERATOR_RUNBOOK.md',import.meta.url),'utf8'),readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
for(const command of ['migration-report','migrate-workflow-apply','rollback-workflow-migration']) assert.ok(runbook.includes(command)&&readme.includes(command),`${command} must be documented`);
for(const command of ['validate:billing-config','page-autodev-issue-controller-credential','page-autodev-openai-tunnel.socket']) assert.ok(runbook.includes(command),`${command} must be documented in the operator runbook`);
for(const topic of ['accepted_generations','revoked_before_ms','do not restart the controller']) assert.ok(runbook.includes(topic),`${topic} lifecycle rule must be documented`);
console.log('RELEASE_ARTIFACTS_TESTS_OK');
