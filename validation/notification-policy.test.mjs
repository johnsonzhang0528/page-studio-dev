import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../lib/autodev.mjs',import.meta.url),'utf8');
const start=source.indexOf("if(result.quota_admission?.reason==='usage_unavailable_fail_closed')");
const end=source.indexOf('if(authenticationError(combined))',start);
assert(start>=0&&end>start,'必須保留額度可見性失敗的獨立處理分支');
const branch=source.slice(start,end);
assert(branch.includes('scheduleServiceRetry'),'額度資訊不可用時仍須自動重試');
assert(!branch.includes('notifyTelegram'),'額度資訊暫時不可用不得發送 Telegram');
assert(branch.includes('usage_visibility_paused'),'額度資訊不可用仍須保留稽核歷史');
console.log('NOTIFICATION_POLICY_TESTS_OK');
