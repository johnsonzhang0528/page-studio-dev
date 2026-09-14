import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../lib/autodev.mjs',import.meta.url),'utf8');
assert.match(source,/const providerDenied=batch\.find\(item=>item\.result\.provider_dispatch_denied\)/,'parallel provider denial must have a dedicated recovery path');
assert.match(source,/for\(const item of batch\)if\(item\.unit\.status==='running'\).*item\.unit\.status='pending'/s,'parallel provider denial must restore the whole batch to pending');
assert.match(source,/for\(const candidate of plan\?\.units\?\?\[\]\)if\(candidate\.status==='running'\)/,'operator resume must recover orphan running units from a terminal controller state');
assert.match(source,/【孤立工作單元復原】/);
assert.match(source,/cmd==='recover-state'[\s\S]*clearHold\(checked\);[\s\S]*timer\(checked,false\)/,'controlled state recovery must not launch the project timer');
assert.match(source,/未啟動服務，也未派發任何模型請求/,'state recovery must state its non-dispatch guarantee');
console.log('PROVIDER_DISPATCH_STATE_RECOVERY_TESTS_OK');
