import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';

if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('ROOT_LINUX_RECONCILIATION_REQUIRED');
const [lease_id, evidence_file] = process.argv.slice(2);
if (!/^[a-f0-9]{64}$/.test(lease_id ?? '') || !evidence_file?.startsWith('/')) throw new Error('RECONCILIATION_ARGUMENTS_INVALID');
const raw = await fs.readFile(evidence_file);
const evidence_sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const evidence = JSON.parse(raw.toString('utf8'));
if (evidence?.schema_version !== 1 || evidence?.source !== 'operator-provided-dataforseo-usage' ||
    !Number.isSafeInteger(evidence?.actual_microusd) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(evidence?.provider_task_id ?? '')) {
  throw new Error('RECONCILIATION_EVIDENCE_INVALID');
}
const ledger = new DurableSpendLedger({file: '/var/lib/page-autodev/dataforseo/spend-ledger.json'});
const result = await ledger.reconcileProviderCost(lease_id, {
  actual_microusd: evidence.actual_microusd,
  provider_task_id: evidence.provider_task_id,
  evidence_sha256
});
console.log(JSON.stringify({ok: true, lease_id: result.lease_id, status: result.status, actual_microusd: result.actual_microusd, evidence_sha256, deduplicated: result.deduplicated}));
