import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authorizeEstimatedCost, requestFingerprint, validateKeywordOverviewRequest,validateKeywordIdeasRequest} from '../lib/dataforseo-contract.mjs';
import {classifyDataForSeoStatus, validateDataForSeoEnvelope} from '../lib/dataforseo-errors.mjs';
import {normalizeKeywordOverview} from '../lib/dataforseo-normalizer.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'keyword-overview-success.json'), 'utf8'));
const valid = {keywords:['台灣 seo 工具'], location_code:2158, language_code:'zh-TW', include_clickstream_data:false, tag:'calibration-001'};

test('valid request is canonical and stable', () => {
  const result = validateKeywordOverviewRequest(valid);
  assert.equal(result.ok, true);
  assert.equal(result.fingerprint, requestFingerprint({...valid}));
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('request contract fails closed on duplication and paid or unknown fields', () => {
  assert.equal(validateKeywordOverviewRequest({...valid, keywords:['SEO','seo']}).ok, false);
  assert.deepEqual(validateKeywordOverviewRequest({...valid, include_clickstream_data:true}).errors, ['CLICKSTREAM_DISABLED']);
  assert.equal(validateKeywordOverviewRequest({...valid, depth:100}).ok, false);
  assert.equal(validateKeywordOverviewRequest({...valid, surprise:true}).ok, false);
});

test('request and budget bounds are hard limits', () => {
  assert.equal(validateKeywordOverviewRequest({...valid, keywords:Array.from({length:61}, (_, index) => `詞${index}`)}).ok, false);
  assert.deepEqual(authorizeEstimatedCost(20_001), {ok:false, reason:'REQUEST_BUDGET_EXCEEDED'});
  assert.equal(authorizeEstimatedCost(20_000).ok, true);
});

test('keyword ideas permits one exact bounded discovery shape only',()=>{const request={keywords:['網站架設','SEO'],location_code:2158,language_code:'zh-TW',closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:60,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:'page-autodev-ideas-test'};assert.equal(validateKeywordIdeasRequest(request).ok,true);for(const mutation of [value=>value.limit=61,value=>value.include_serp_info=true,value=>value.include_clickstream_data=true,value=>value.filters=[],value=>value.offset=1,value=>value.location_code=2840]){const copy=structuredClone(request);mutation(copy);assert.equal(validateKeywordIdeasRequest(copy).ok,false);}});

test('HTTP success cannot hide task failure', () => {
  const failed = structuredClone(fixture);
  failed.tasks[0].status_code = 40203;
  assert.equal(validateDataForSeoEnvelope(failed).ok, false);
  assert.equal(classifyDataForSeoStatus(40203).retryable, false);
  assert.equal(classifyDataForSeoStatus(50301).retryable, true);
  assert.equal(classifyDataForSeoStatus(49999).class, 'unknown_fail_closed');
});

test('normalizer preserves provenance and provider null semantics', () => {
  const context = {request_fingerprint:requestFingerprint(valid), retrieved_at:'2026-09-10T00:00:00Z', location_code:2158, language_code:'zh-TW'};
  const [row] = normalizeKeywordOverview(fixture, context);
  assert.equal(row.search_volume_estimate, 90);
  assert.equal(row.organic_kd, 24);
  assert.equal(row.paid_competition, 0.31);
  assert.equal(row.provider_cost, 0.01212);
  assert.equal(row.intent_provider, 'commercial');
  assert.equal(row.confidence, 'unvalidated');
  const nullFixture = structuredClone(fixture);
  nullFixture.tasks[0].result[0].items[0].keyword_info.search_volume = null;
  nullFixture.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty = null;
  const [unknown] = normalizeKeywordOverview(nullFixture, context);
  assert.equal(unknown.search_volume_estimate, null);
  assert.equal(unknown.organic_kd, null);
  assert.equal(unknown.search_volume_null_reason, 'PROVIDER_NULL_OR_INVALID');
  assert.equal(unknown.confidence, 'low');
});

test('runtime has no repository credential path, shell credential, or fetch bypass', () => {
  const files = fs.readdirSync(path.join(root, 'lib')).map(name => fs.readFileSync(path.join(root, 'lib', name), 'utf8')).join('\n');
  assert.doesNotMatch(files, /\/etc\/page-autodev\/credentials|DFS_(?:LOGIN|PASSWORD)|fetch\s*\(|child_process|exec\s*\(|spawn\s*\(/);
  assert.match(files, /CREDENTIALS_DIRECTORY/);
  assert.match(files, /\/run\/credentials\//);
});
