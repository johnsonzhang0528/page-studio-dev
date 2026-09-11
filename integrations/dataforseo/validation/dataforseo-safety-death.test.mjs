import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateSerpRoute, validateSerpStandardRequest} from '../lib/dataforseo-serp-contract.mjs';
import {validateProviderRegistry} from '../lib/provider-registry.mjs';
import {SpendReservations} from '../lib/spend-reservations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const registry = JSON.parse(fs.readFileSync(path.join(root,'fixtures','provider-registry.json'),'utf8'));
const request = {keyword:'seo 工具', location_code:2158, language_code:'zh-TW', device:'desktop', os:'windows', depth:10, tag:'serp-001'};

test('SERP contract accepts only bounded Standard task route', () => {
  assert.equal(validateSerpStandardRequest(request).ok, true);
  assert.equal(validateSerpRoute('/v3/serp/google/organic/task_post').ok, true);
  for (const route of ['/v3/serp/google/organic/live/advanced','/v3/serp/google/organic/live/regular','https://evil.invalid']) assert.equal(validateSerpRoute(route).ok, false);
});

test('SERP contract blocks depth expansion and paid parameters', () => {
  assert.equal(validateSerpStandardRequest({...request, depth:11}).ok, false);
  assert.equal(validateSerpStandardRequest({...request, calculate_rectangles:true}).ok, false);
  assert.equal(validateSerpStandardRequest({...request, people_also_ask_click_depth:1}).ok, false);
  assert.equal(validateSerpStandardRequest({...request, priority:2}).ok, false);
});

test('provider registry fails closed on activation, price and market drift', () => {
  assert.equal(validateProviderRegistry(registry, {now:Date.parse('2026-09-10T00:00:00Z')}).ok, true);
  assert.equal(validateProviderRegistry({...registry, activation:'enabled'}).ok, false);
  assert.equal(validateProviderRegistry({...registry, markets:[]}).ok, false);
  assert.equal(validateProviderRegistry({...registry, fallback:{automatic:true}}).ok, false);
  assert.equal(validateProviderRegistry({...registry, price_snapshot:{...registry.price_snapshot, expires_at:'2020-01-01T00:00:00Z'}}).ok, false);
  assert.equal(validateProviderRegistry({...registry, price_snapshot:{...registry.price_snapshot, expires_at:'2099-01-01T00:00:00Z'}}, {now:Date.parse('2026-09-10T00:00:00Z')}).ok, false);
  assert.equal(validateProviderRegistry({...registry, price_snapshot:{...registry.price_snapshot, source:'operator_approved'}}, {now:Date.parse('2026-09-10T00:00:00Z')}).ok, false);
});

test('concurrent logical duplicates receive one lease', async () => {
  const store = new SpendReservations({daily_cap_microusd:250_000});
  const input = {fingerprint:'a'.repeat(64), estimated_microusd:20_000, project_id:'shadow', day:'2026-09-10'};
  const results = await Promise.all(Array.from({length:100}, () => Promise.resolve().then(() => store.reserve(input))));
  assert.equal(new Set(results.map(item => item.lease_id)).size, 1);
  assert.equal(results.filter(item => !item.deduplicated).length, 1);
  assert.equal(store.snapshot().length, 1);
});

test('daily budget is atomic and cannot be bypassed by distinct requests', () => {
  const store = new SpendReservations({daily_cap_microusd:25_000});
  assert.equal(store.reserve({fingerprint:'a'.repeat(64), estimated_microusd:20_000, project_id:'shadow', day:'2026-09-10'}).status, 'RESERVED');
  assert.equal(store.reserve({fingerprint:'b'.repeat(64), estimated_microusd:20_000, project_id:'shadow', day:'2026-09-10'}).reason, 'DAILY_CAP_EXCEEDED');
});

test('unknown dispatch outcome holds lease and forbids replay', () => {
  const store = new SpendReservations();
  const lease = store.reserve({fingerprint:'c'.repeat(64), estimated_microusd:10_000, project_id:'shadow', day:'2026-09-10'});
  store.markDispatched(lease.lease_id, 'task-1');
  assert.equal(store.markUnknown(lease.lease_id).status, 'UNKNOWN_HOLD');
  assert.throws(() => store.markDispatched(lease.lease_id, 'task-2'), /INVALID_TRANSITION/);
  assert.equal(store.reserve({fingerprint:'c'.repeat(64), estimated_microusd:10_000, project_id:'shadow', day:'2026-09-10'}).status, 'UNKNOWN_HOLD');
});

test('cost variance over twenty percent triggers billing hold', () => {
  const store = new SpendReservations();
  const lease = store.reserve({fingerprint:'d'.repeat(64), estimated_microusd:10_000, project_id:'shadow', day:'2026-09-10'});
  store.markDispatched(lease.lease_id, 'task-2');
  assert.equal(store.settle(lease.lease_id, 12_001).status, 'UNKNOWN_HOLD');
});
