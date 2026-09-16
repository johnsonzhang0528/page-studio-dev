import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const runner=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-niche-serp.mjs',import.meta.url),'utf8');
const wrapper=fs.readFileSync(new URL('../deploy/run-niche-serp-canary.sh',import.meta.url),'utf8');
test('niche SERP runner is source-bound to exact eight tasks and $0.016',()=>{assert.match(runner,/sourceSha!==['"]8a1ad5ff/);assert.match(runner,/selected\.length!==8/);assert.match(runner,/task_count:8,max_microusd:16000/);assert.match(runner,/daily_cap_microusd:16000/);assert.match(runner,/receipts\.length===8/);});
test('niche SERP runner is single attempt and never authorizes business state',()=>{assert.match(runner,/automatic_retry_allowed:false/);assert.doesNotMatch(runner,/automatic_enter:true|serp_dispatch_authorized:true|retries:[1-9]/);assert.match(wrapper,/trap cleanup EXIT HUP INT TERM/);assert.match(wrapper,/dataforseo-egress-policy\.disabled\.json/);});
