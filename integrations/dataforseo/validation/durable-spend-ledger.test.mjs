import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';

async function sandbox(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dfs-ledger-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'spend-ledger.json');
  return {file, ledger: new DurableSpendLedger({file, ...options})};
}

const request = suffix => ({fingerprint: suffix.repeat(64), estimated_microusd: 10_000, project_id: 'shadow', day: '2026-09-10'});

test('ledger survives process-style reconstruction without duplicate spend', async t => {
  const {file, ledger} = await sandbox(t);
  const first = await ledger.reserve(request('a'));
  const reconstructed = new DurableSpendLedger({file});
  const replay = await reconstructed.reserve(request('a'));
  assert.equal(replay.lease_id, first.lease_id);
  assert.equal(replay.deduplicated, true);
  assert.equal((await reconstructed.snapshot()).length, 1);
});
test('independent instances serialize concurrent reservations against one daily cap', async t => {
  const {file} = await sandbox(t, {daily_cap_microusd: 10_000});
  const instances = Array.from({length: 20}, () => new DurableSpendLedger({file, daily_cap_microusd: 10_000}));
  const results = await Promise.all(instances.map((ledger, index) => ledger.reserve(request(index % 2 ? 'b' : 'c'))));
  assert.equal(results.filter(item => item.status === 'RESERVED').length, 10);
  assert.equal(results.filter(item => item.status === 'REJECTED').length, 10);
  const records = await instances[0].snapshot();
  assert.equal(records.length, 1);
  assert.equal(records[0].reserved_microusd, 10_000);
});

test('dispatch and settlement persist across instances', async t => {
  const {file, ledger} = await sandbox(t);
  const lease = await ledger.reserve(request('d'));
  await new DurableSpendLedger({file}).markDispatched(lease.lease_id, 'provider-task-1');
  const settled = await new DurableSpendLedger({file}).settle(lease.lease_id, 10_500);
  assert.equal(settled.status, 'SETTLED');
  assert.equal((await ledger.snapshot())[0].actual_microusd, 10_500);
});

test('ledger corruption fails closed and is never silently reset', async t => {
  const {file, ledger} = await sandbox(t);
  await ledger.reserve(request('e'));
  await fs.writeFile(file, '{"payload":"tampered","checksum":"' + '0'.repeat(64) + '"}\n');
  await assert.rejects(() => ledger.reserve(request('f')), /LEDGER_CHECKSUM_MISMATCH/);
});

test('existing lock is not stolen and causes bounded failure', async t => {
  const {file} = await sandbox(t);
  await fs.writeFile(`${file}.lock`, 'owner-unknown');
  const ledger = new DurableSpendLedger({file, lock_timeout_ms: 30, lock_retry_ms: 5});
  await assert.rejects(() => ledger.reserve(request('a')), /LEDGER_LOCK_TIMEOUT/);
});

test('identity fields cannot inject alternate ledger keys', async t => {
  const {ledger} = await sandbox(t);
  await assert.rejects(() => ledger.reserve({...request('a'), project_id: 'bad|project'}), /INVALID_PROJECT_ID/);
  await assert.rejects(() => ledger.reserve({...request('a'), day: '../escape'}), /INVALID_DAY/);
});
test('unknown hold requires machine evidence before no-dispatch reconciliation',async t=>{const {ledger}=await sandbox(t),lease=await ledger.reserve(request('f'));await ledger.markDispatched(lease.lease_id,'provider-1');await ledger.markUnknown(lease.lease_id);await assert.rejects(()=>ledger.reconcileNoDispatch(lease.lease_id,{reason:'guess',evidence_sha256:'a'.repeat(64)}),/EVIDENCE/);const reconciled=await ledger.reconcileNoDispatch(lease.lease_id,{reason:'SERVICE_CRASHED_BEFORE_LISTENER',evidence_sha256:'a'.repeat(64)});assert.equal(reconciled.status,'REJECTED');});

test('provider evidence reconciles an unknown hold to its confirmed cost', async t => {
  const {ledger} = await sandbox(t, {daily_cap_microusd: 100_000});
  const lease = await ledger.reserve({...request('9'), estimated_microusd: 86_400});
  await ledger.markDispatched(lease.lease_id, 'balanced-calibration:request');
  await ledger.markUnknown(lease.lease_id);
  const input = {actual_microusd: 14_400, provider_task_id: '09141514-2497-0400-0000-c6ab0f221c11', evidence_sha256: 'b'.repeat(64)};
  const settled = await ledger.reconcileProviderCost(lease.lease_id, input);
  assert.equal(settled.status, 'SETTLED');
  assert.equal(settled.actual_microusd, 14_400);
  assert.equal(settled.cost_variance_ratio, -5 / 6);
  assert.deepEqual(settled.reconciliation, {reason: 'PROVIDER_COST_CONFIRMED', provider_task_id: input.provider_task_id, evidence_sha256: input.evidence_sha256});
  assert.equal((await ledger.reconcileProviderCost(lease.lease_id, input)).deduplicated, true);
});

test('provider reconciliation fails closed on excess cost, missing evidence, or a conflicting replay', async t => {
  const {ledger} = await sandbox(t);
  const lease = await ledger.reserve(request('8'));
  await ledger.markDispatched(lease.lease_id, 'provider-request');
  await ledger.markUnknown(lease.lease_id);
  await assert.rejects(() => ledger.reconcileProviderCost(lease.lease_id, {actual_microusd: 10_001, provider_task_id: 'task-1', evidence_sha256: 'c'.repeat(64)}), /EXCEEDS_RESERVATION/);
  await assert.rejects(() => ledger.reconcileProviderCost(lease.lease_id, {actual_microusd: 9_000, provider_task_id: 'task-1'}), /EVIDENCE/);
  await ledger.reconcileProviderCost(lease.lease_id, {actual_microusd: 9_000, provider_task_id: 'task-1', evidence_sha256: 'c'.repeat(64)});
  await assert.rejects(() => ledger.reconcileProviderCost(lease.lease_id, {actual_microusd: 8_000, provider_task_id: 'task-1', evidence_sha256: 'c'.repeat(64)}), /INVALID_TRANSITION/);
});
