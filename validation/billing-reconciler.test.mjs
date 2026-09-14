import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInvocationSpec } from "../lib/provider-contract.mjs";
import { createPriceRegistry } from "../lib/price-registry.mjs";
import { createBillingFirewall } from "../lib/billing-firewall.mjs";
import { reconcileProviderOutcome } from "../lib/billing-reconciler.mjs";
const now = Date.parse("2026-09-08T01:00:00Z"),
  prices = createPriceRegistry({
    version: 1,
    effective_at: "2026-09-08T00:00:00Z",
    expires_at: "2026-09-09T00:00:00Z",
    source: "offline-fixture",
    models: [
      {
        provider: "openai",
        model: "offline-luna-fixture",
        uncached_input_microusd_per_million: 1_000_000,
        cached_input_microusd_per_million: 100_000,
        output_microusd_per_million: 2_000_000,
        reasoning_microusd_per_million: 3_000_000,
      },
    ],
  });
const policy = {
    work_unit_default: 500,
    project: {
      fixture: {
        minute: 1000,
        fifteen_minutes: 1000,
        hour: 1000,
        day: 1000,
        month: 1000,
      },
    },
    account: {
      minute: 1000,
      fifteen_minutes: 1000,
      hour: 1000,
      day: 1000,
      month: 1000,
    },
    canary: { wave: 1000 },
  },
  base = {
    schema_version: 1,
    run_id: "run",
    project: "fixture",
    phase: "requirements",
    attempt: 1,
    input_revision: 1,
    controller_sha: "controller",
    policy_fingerprint: "policy",
    objective: "fixture",
    context_manifest: { sha256: "context" },
    allowed_write_scope: [],
    tool_capabilities: ["filesystem_read"],
    network_policy: "billing_gateway_only",
    timeouts: {
      connect_ms: 20,
      first_token_ms: 20,
      idle_ms: 20,
      tool_ms: 20,
      invocation_deadline_ms: 1000,
      work_unit_deadline_ms: 2000,
    },
    budget: {
      max_input_tokens: 10,
      max_output_tokens: 10,
      max_reasoning_tokens: 10,
      max_tool_calls: 1,
      max_api_round_trips: 1,
      max_wall_ms: 1000,
      max_cost_microusd: 100,
    },
    output_schema: { type: "object" },
    receipt_schema: { type: "object" },
    risk_tier: "low",
    required_quality_tier: "standard",
    verification_mode: "read_only",
    provider: "openai",
    model: "offline-luna-fixture",
    reason_code: "FIXTURE",
    fallback_policy: [],
    parent_checkpoint: "checkpoint",
  },
  proof = "a".repeat(64);
const make = (root, index) => {
  const firewall = createBillingFirewall({
      root,
      priceRegistry: prices,
      policy,
      clock: () => now,
    }),
    spec = createInvocationSpec({
      ...base,
      invocation_id: `inv-${index}`,
      idempotency_key: `idem-${index}`,
      unit_id: `REQ-${index}`,
    }),
    lease = firewall.reserve(spec, {
      work_unit_budget_id: `wu-${index}`,
      canary_wave: "wave",
      priority: "P1",
    });
  firewall.authorizeDispatch(lease.lease_id, spec);
  firewall.markUnknownOutcome(lease.lease_id, { reason: "timeout" });
  return { firewall, lease };
};
const roots = [];
let root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-zero-"));
roots.push(root);
let { firewall, lease } = make(root, 1);
assert.equal(
  reconcileProviderOutcome(firewall, lease.lease_id, {
    status: "NOT_ACCEPTED",
    evidence_sha256: proof,
  }).released_microusd,
  lease.reserved_microusd,
);
assert.equal(firewall.snapshot().committed[0].cost_microusd, 0);
assert.equal(
  firewall.snapshot().committed[0].settlement_outcome,
  "NOT_ACCEPTED",
);
const legacyStatePath = path.join(root, "billing-state.json");
const legacyState = JSON.parse(fs.readFileSync(legacyStatePath, "utf8"));
delete legacyState.committed[0].settlement_outcome;
fs.writeFileSync(legacyStatePath, JSON.stringify(legacyState));
const retrySpec = createInvocationSpec({
  ...base,
  invocation_id: "inv-1-retry",
  idempotency_key: "idem-1",
  unit_id: "REQ-1",
});
assert.doesNotThrow(
  () =>
    firewall.reserve(retrySpec, {
      work_unit_budget_id: "wu-1",
      canary_wave: "wave",
      priority: "P1",
    }),
  "經證據確認 NOT_ACCEPTED 且零成本後，相同 idempotency key 必須可安全重試",
);
root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-final-"));
roots.push(root);
({ firewall, lease } = make(root, 2));
assert.equal(
  reconcileProviderOutcome(firewall, lease.lease_id, {
    status: "FINAL_USAGE",
    evidence_sha256: proof,
    provider_request_id: "req-final",
    final_cost_microusd: 12,
  }).released_microusd,
  lease.reserved_microusd - 12,
);
assert.equal(firewall.snapshot().committed[0].cost_microusd, 12);
root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-unknown-"));
roots.push(root);
({ firewall, lease } = make(root, 3));
assert.equal(
  reconcileProviderOutcome(firewall, lease.lease_id, {
    status: "PERMANENTLY_UNKNOWN",
    evidence_sha256: proof,
  }).released_microusd,
  0,
);
assert.equal(
  firewall.snapshot().committed[0].cost_microusd,
  lease.reserved_microusd,
  "永久未知必須按完整 exposure 記帳",
);
assert.throws(
  () =>
    reconcileProviderOutcome(firewall, lease.lease_id, {
      status: "FINAL_USAGE",
      evidence_sha256: proof,
      provider_request_id: "late",
      final_cost_microusd: 1,
    }),
  (error) => error.code === "BILLING_RECONCILIATION_INVALID",
  "已結算 lease 的晚到結果不得重複套用",
);
root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-invalid-"));
roots.push(root);
({ firewall, lease } = make(root, 4));
assert.throws(
  () =>
    reconcileProviderOutcome(firewall, lease.lease_id, {
      status: "NOT_ACCEPTED",
      evidence_sha256: "bad",
    }),
  (error) => error.code === "BILLING_RECONCILIATION_INVALID",
);
assert.throws(
  () =>
    reconcileProviderOutcome(firewall, lease.lease_id, {
      status: "FINAL_USAGE",
      evidence_sha256: proof,
      provider_request_id: "req-over",
      final_cost_microusd: lease.reserved_microusd + 1,
    }),
  (error) => error.code === "BILLING_RECONCILIATION_REQUIRED",
);
assert.ok(firewall.snapshot().reservations[lease.lease_id]);
for (const directory of roots)
  fs.rmSync(directory, { recursive: true, force: true });
console.log("BILLING_RECONCILER_TESTS_OK");
