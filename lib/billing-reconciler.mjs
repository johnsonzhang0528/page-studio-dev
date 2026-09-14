const sha256 = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const fail = (message) => {
  throw Object.assign(new Error(message), {
    code: "BILLING_RECONCILIATION_INVALID",
  });
};

export function reconcileProviderOutcome(firewall, lease_id, evidence) {
  if (
    !firewall ||
    typeof firewall.snapshot !== "function" ||
    typeof firewall.settle !== "function" ||
    typeof lease_id !== "string" ||
    !lease_id
  )
    fail("BILLING_RECONCILER_INPUT_INVALID");
  if (
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    !sha256(evidence.evidence_sha256)
  )
    fail("BILLING_RECONCILIATION_EVIDENCE_REQUIRED");
  const allowed = new Set([
    "NOT_ACCEPTED",
    "FINAL_USAGE",
    "PERMANENTLY_UNKNOWN",
  ]);
  if (!allowed.has(evidence.status))
    fail("BILLING_RECONCILIATION_STATUS_INVALID");
  const lease = firewall.snapshot().reservations[lease_id];
  if (!lease) fail("BILLING_RECONCILIATION_LEASE_UNKNOWN");
  if (
    !["RECONCILIATION_REQUIRED", "DISPATCH_AUTHORIZED", "ACTIVE"].includes(
      lease.status,
    )
  )
    fail("BILLING_RECONCILIATION_STATE_INVALID");
  let providerRequestId, finalCost;
  if (evidence.status === "NOT_ACCEPTED") {
    if (
      evidence.provider_request_id !== null &&
      evidence.provider_request_id !== undefined
    )
      fail("BILLING_NOT_ACCEPTED_REQUEST_ID_FORBIDDEN");
    providerRequestId = `not-accepted:${lease_id}:${evidence.evidence_sha256}`;
    finalCost = 0;
  } else if (evidence.status === "FINAL_USAGE") {
    if (
      typeof evidence.provider_request_id !== "string" ||
      !evidence.provider_request_id ||
      !Number.isSafeInteger(evidence.final_cost_microusd) ||
      evidence.final_cost_microusd < 0
    )
      fail("BILLING_FINAL_USAGE_INVALID");
    providerRequestId = evidence.provider_request_id;
    finalCost = evidence.final_cost_microusd;
  } else {
    if (
      evidence.final_cost_microusd !== undefined ||
      evidence.final_cost_microusd === 0
    )
      fail("BILLING_UNKNOWN_COST_OVERRIDE_FORBIDDEN");
    providerRequestId =
      typeof evidence.provider_request_id === "string" &&
      evidence.provider_request_id
        ? evidence.provider_request_id
        : `permanently-unknown:${lease_id}`;
    finalCost = lease.reserved_microusd;
  }
  return firewall.settle(lease_id, {
    provider_request_id: providerRequestId,
    final_cost_microusd: finalCost,
    outcome_proven: true,
    reconciliation_evidence_sha256: evidence.evidence_sha256,
    settlement_outcome: evidence.status,
    progress_proof: evidence.progress_proof ?? null,
    material_fingerprint: evidence.material_fingerprint ?? null,
  });
}
