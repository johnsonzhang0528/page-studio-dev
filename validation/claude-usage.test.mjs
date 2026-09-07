import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeUsage, claudeUsageLines } from '../lib/claude-usage.mjs';

test('normalizes current limits response and reports remaining quota',()=>{
  const usage=normalizeClaudeUsage({limits:[{kind:'session',percent:81,resets_at:'2026-09-07T17:59:59Z',scope:null},{kind:'weekly_all',percent:73,resets_at:'2026-09-11T13:59:59Z',scope:null},{kind:'weekly_all',percent:90,resets_at:'2026-09-11T13:59:59Z',scope:{model:{display_name:'Opus'}}}]});
  assert.equal(usage.fiveHour.remaining,19); assert.equal(usage.sevenDay.remaining,27);
  assert.deepEqual(claudeUsageLines(usage),['Claude 5 小時額度：剩餘 19%（已用 81%）','Claude 7 天額度：剩餘 27%（已用 73%）']);
});
test('supports legacy response and never invents unavailable percentages',()=>{
  const usage=normalizeClaudeUsage({five_hour:{utilization:12.4,resets_at:null},seven_day:{utilization:42,resets_at:null}});
  assert.equal(usage.fiveHour.remaining,87.6); assert.equal(usage.sevenDay.remaining,58); assert.match(claudeUsageLines({available:false})[0],/暫時無法取得/);
});
