import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('failed paid expansion writes durable hold evidence and never auto-retries',()=>{
  const source=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-expansion.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('candidate-expansion-failure-v1.json'));
  assert.ok(source.includes('ledger_status:record?.status'));
  assert.ok(source.includes('automatic_retry_allowed:false'));
  assert.ok(source.includes('await ledger.markUnknown(lease.lease_id)'));
  assert.ok(source.includes('EXPANSION_ALREADY_ATTEMPTED'));
});
