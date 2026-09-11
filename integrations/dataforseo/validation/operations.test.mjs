import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
import {createVerifiedSnapshot, inspectLock, verifySnapshot} from '../lib/operational-tools.mjs';
import {OfflineDataForSeoAdapter} from '../sandbox/offline-adapter.mjs';

test('backup is atomic and tampering is detected', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dfs-ops-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const ledger = new DurableSpendLedger({file: path.join(directory, 'ledger.json')});
  await ledger.reserve({fingerprint: 'a'.repeat(64), estimated_microusd: 1, project_id: 'shadow', day: '2026-09-10'});
  const backup = path.join(directory, 'backup.json');
  assert.equal((await createVerifiedSnapshot({ledger, destination: backup})).records, 1);
  assert.equal((await verifySnapshot(backup)).ok, true);
  const content = await fs.readFile(backup, 'utf8');
  await fs.writeFile(backup, content.replace('shadow', 'changed'));
  assert.equal((await verifySnapshot(backup)).reason, 'BACKUP_CHECKSUM_MISMATCH');
});
test('lock inspection is read-only and requires operator review', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dfs-lock-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const lock = path.join(directory, 'ledger.lock');
  await fs.writeFile(lock, 'evidence');
  assert.equal((await inspectLock(lock)).action, 'OPERATOR_REVIEW_REQUIRED');
  assert.equal(await fs.readFile(lock, 'utf8'), 'evidence');
});

test('offline adapter cannot be turned into a network transport', async () => {
  assert.throws(() => new OfflineDataForSeoAdapter({network_enabled: true}), /FORBIDDEN/);
  assert.throws(() => new OfflineDataForSeoAdapter({transport: async () => {}}), /FORBIDDEN/);
  await assert.rejects(() => new OfflineDataForSeoAdapter().submit(), /NETWORK_DISABLED/);
});
