import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../bin/page-autodev-dataforseo-dashcam-keyword-recovery.mjs',import.meta.url),'utf8'),shell=fs.readFileSync(new URL('../deploy/run-dashcam-keyword-recovery.sh',import.meta.url),'utf8');
test('recovery is keyword-only and requires completed prior phases',()=>{assert.match(source,/state\.keyword!==\'SETTLED\'/);assert.match(source,/state\.serp!==\'SETTLED\'/);assert.match(source,/requests\?\.\[0\]/);assert.doesNotMatch(source,/slice\(1\)/);});
test('recovery binds 12600 cap and cumulative cost',()=>{assert.match(source,/max_microusd:12600/);assert.match(source,/cumulative_research_cost_microusd/);assert.match(source,/18480\+known/);});
test('recovery keeps fail-closed cleanup and unknown hold',()=>{assert.match(shell,/trap cleanup EXIT HUP INT TERM/);assert.match(shell,/keyword-overview-canary/);assert.match(source,/markUnknown/);});
