import assert from 'node:assert/strict';
import { detectMachineOwnedViolations } from '../lib/machine-owned.mjs';

const lease='.ai/runtime/work-unit-leases/abc/lease.json';
assert.deepEqual(detectMachineOwnedViolations({[lease]:'before'},{}),[],'控制器正常釋放 work-unit lease 不得誤判為 Agent 竄改');
assert.equal(detectMachineOwnedViolations({[lease]:'before'},{[lease]:'tampered'}).length,1,'lease 內容遭修改仍必須攔截');
assert.equal(detectMachineOwnedViolations({},{[lease]:'forged'}).length,1,'新增偽造 lease 仍必須攔截');
console.log('DEATH_EVIDENCE DT-113 controller_lease_release_not_agent_tamper');
console.log('MACHINE_OWNED_RUNTIME_TESTS_OK');
