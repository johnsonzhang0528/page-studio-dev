import assert from 'node:assert/strict';
import fs from 'node:fs';

const contract=JSON.parse(fs.readFileSync(new URL('../project-template/.ai/QUALITY_CONTRACT.json',import.meta.url),'utf8'));
assert.equal(contract.schema_version,1); assert.equal(contract.allow_shell,false); assert.equal(contract.receipt_required,true);
assert.ok(contract.checks.some(check=>check.id==='test'&&check.required&&Array.isArray(check.argv)));
assert.ok(contract.checks.every(check=>Array.isArray(check.argv)&&check.argv.every(value=>typeof value==='string')&&!check.argv.some(value=>/[;&|`$<>]/.test(value))));

const config=JSON.parse(fs.readFileSync(new URL('../project-template/.ai/AUTODEV_CONFIG.json',import.meta.url),'utf8'));
assert.equal(config.allow_deploy,false); assert.equal(config.complexity_control.rollout,'shadow');
const service=fs.readFileSync(new URL('../systemd/page-autodev@.service',import.meta.url),'utf8');
for(const rule of ['NoNewPrivileges=true','PrivateTmp=true','ProtectSystem=strict','ProtectHome=true','ReadWritePaths=']) assert.ok(service.includes(rule),`systemd must retain ${rule}`);
const runbook=fs.readFileSync(new URL('../docs/OPERATOR_RUNBOOK.md',import.meta.url),'utf8'),readme=fs.readFileSync(new URL('../README.md',import.meta.url),'utf8');
for(const command of ['migration-report','migrate-workflow-apply','rollback-workflow-migration']) assert.ok(runbook.includes(command)&&readme.includes(command),`${command} must be documented`);
console.log('RELEASE_ARTIFACTS_TESTS_OK');
