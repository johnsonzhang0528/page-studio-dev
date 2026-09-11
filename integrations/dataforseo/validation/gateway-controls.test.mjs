import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeFourLayerBudget, DEFAULT_BUDGET_POLICY} from '../lib/budget-policy.mjs';
import {decideRetry} from '../lib/retry-policy.mjs';
import {redact, safeAuditEvent} from '../lib/redaction.mjs';
import {BillingGateway} from '../lib/billing-gateway.mjs';
import {validateCalibrationDataset} from '../lib/calibration-validator.mjs';

const usage = overrides => ({estimated_microusd: 1, project_day_used_microusd: 0, global_day_used_microusd: 0, global_month_used_microusd: 0, ...overrides});

test('four budget layers each fail closed at their boundary', () => {
  assert.equal(authorizeFourLayerBudget(usage({estimated_microusd: 20_001})).reason, 'REQUEST_CAP_EXCEEDED');
  assert.equal(authorizeFourLayerBudget(usage({project_day_used_microusd: 250_000})).reason, 'PROJECT_DAILY_CAP_EXCEEDED');
  assert.equal(authorizeFourLayerBudget(usage({global_day_used_microusd: 500_000})).reason, 'GLOBAL_DAILY_CAP_EXCEEDED');
  assert.equal(authorizeFourLayerBudget(usage({global_month_used_microusd: 5_000_000})).reason, 'GLOBAL_MONTHLY_CAP_EXCEEDED');
  assert.equal(authorizeFourLayerBudget(usage({estimated_microusd: 20_000})).ok, true);
});

test('retry never repeats an ambiguous paid dispatch', () => {
  assert.equal(decideRetry({phase: 'AFTER_DISPATCH', status_code: 50301, attempt: 1}).action, 'HOLD');
  assert.equal(decideRetry({phase: 'AFTER_DISPATCH', status_code: 50301, attempt: 1, dispatch_confirmed_absent: true}).action, 'RETRY');
  assert.equal(decideRetry({phase: 'BEFORE_DISPATCH', status_code: 40100, attempt: 1}).action, 'STOP');
  assert.equal(decideRetry({phase: 'BEFORE_DISPATCH', status_code: 50301, attempt: 3}).reason, 'ATTEMPT_CAP_REACHED');
});

test('logs recursively redact credential material', () => {
  const clean = redact({authorization: 'Basic abc', nested: {api_key: 'secret', message: 'Bearer token.value'}});
  assert.equal(clean.authorization, '[REDACTED]');
  assert.equal(clean.nested.api_key, '[REDACTED]');
  assert.equal(clean.nested.message, 'Bearer [REDACTED]');
  assert.doesNotMatch(safeAuditEvent(clean), /abc|secret|token\.value/);
});

test('gateway cannot authorize while preintegration registry is disabled', async () => {
  let reserved = false;
  const gateway = new BillingGateway({
    ledger: {reserve: async () => { reserved = true; return {status: 'RESERVED'}; }},
    registry: {version: 1, provider: 'dataforseo', capabilities: ['keyword_overview','keyword_ideas','serp_standard'], markets: [{location_code: 2158, language_code: 'zh-TW'}], price_snapshot: {source:'https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api',captured_at:'2026-09-10T00:00:00Z',expires_at:'2026-09-17T00:00:00Z',keyword_overview_task_microusd:12000,keyword_overview_item_microusd:120}, activation: 'disabled', fallback: {automatic: false}},
    budget_policy: DEFAULT_BUDGET_POLICY,
    usage_reader: async () => usage({estimated_microusd: undefined}),
    clock: () => Date.parse('2026-09-10T00:00:00Z')
  });
  const result = await gateway.authorize({capability: 'keyword_overview', request: {keywords: ['seo'], location_code: 2158, language_code: 'zh-TW'}, estimated_microusd: 12120, project_id: 'shadow', day: '2026-09-10'});
  assert.equal(result.ok, false);
  assert.equal(reserved, false);
});

test('60-query calibration requires unique Taiwan zh-TW rows and coverage', () => {
  const rows = Array.from({length: 60}, (_, index) => ({query: `查詢 ${index}`, location_code: 2158, language_code: 'zh-TW', volume: index < 48 ? index : null, kd: index < 48 ? index : null, intent: 'unknown', observed_at: '2026-09-10T00:00:00Z'}));
  assert.equal(validateCalibrationDataset(rows).ok, true);
  rows[47].volume = null;
  assert.equal(validateCalibrationDataset(rows).ok, false);
});
