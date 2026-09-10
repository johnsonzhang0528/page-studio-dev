# Page Studio Controller Operator Runbook

## Release order

1. Run `npm test` in the isolated controller candidate.
2. Run `page-autodev migration-report <project>` for every controlled Project and preserve each `inventory_sha256`.
3. Run `page-autodev migrate-workflow <project>` and review the dry-run actions. This command must not write files.
4. Stop only the selected canary Project and wait until its leases and pending transactions are zero.
5. Run `page-autodev migrate-workflow-apply <project>`. Preserve the returned migration ID and rollback command.
6. Keep rollout mode at `shadow`; verify that dispatch and writes remain disabled.
7. Run the disposable fixtures, one non-production canary, three clean end-to-end cycles, and the 24-hour soak.
8. Promote projects gradually only when every release gate is green. Deployment remains disabled until explicit operator approval.

## Fail-closed stop conditions

Stop rollout for any Gate, quality, approval, source-identity or cache bypass; corrupt state; stale fencing token; duplicate writer; orphan transaction/worktree; migration mismatch; secret scan finding; or test regression. Do not close these conditions with an exception.

## Rollback

Run the exact command returned by migration apply:

```text
page-autodev rollback-workflow-migration <project> <migration-id>
```

Rollback restores only controller-owned state whose backup hashes verify. It does not reset product commits or overwrite product files. If a lease or non-terminal transaction exists, rollback must stop and wait for safe quiescence.

For controller code, switch back to the previous reviewed controller commit and restore shadow feature flags. Never use a hard reset on a Project repository.

## Evidence to retain

- candidate controller commit and test output
- migration inventory SHA and apply/rollback manifest
- canary Project HEAD and dirty baseline
- crash, mutation, property and soak receipts
- secret-scan result and systemd security snapshot
- three end-to-end canary receipts

## Candidate-bound soak and final evidence

The soak receipt is an append-only SHA-256 chain. Every record must contain a monotonic `chain_sequence`, the preceding record hash, and its own hash. The runner must fsync each record and the containing directory. Never repair, truncate, reorder, concatenate, or hand-edit a soak receipt.

Start the candidate with explicit `SHADOW_SOAK_EXPECTED_BRANCH` and `SHADOW_SOAK_EXPECTED_HEAD`. Use the approved two-project set (`test-project`, `seo-empire`), all eight resilience scenarios, a five-minute interval, a 24-hour active runtime, and a restart policy that resumes only after an abnormal process exit. Planned stops must append `interrupted`; offline time is not counted toward the 24 hours. A torn tail, changed candidate/configuration, terminal `failed`, excessive resource growth, missing scenario, missing project decision, or broken chain requires a new candidate review and must never be repaired in place.

Before the soak, retain candidate-bound receipts for the 89 named death cases, the release preflight, the three offline canary cases, every controlled Project migration inventory, and the systemd security artifact. Finalization consumes all five evidence sources plus the completed soak chain. Its only successful decision is `ELIGIBLE_FOR_OPERATOR_REVIEW` with `deploy_authorized=false`; it never deploys or grants deployment approval.

## Billing Gateway activation (non-production canary only)

1. Keep `allow_deploy=false` and the egress policy `activation=disabled` while preparing credentials.
2. Build `gateway-runtime.json` from an operator-reviewed price source. Every enabled model snapshot must have a currently effective price entry; never use fixture, guessed, zero, or expired rates.
3. Run `npm run validate:billing-config -- /path/to/gateway-runtime.json`. A failure blocks activation.
4. Install the API key only as the `openai_api_key` systemd credential for the egress service. The controller and Billing Gateway must never receive or read it.
5. Start sockets before services in this order: `page-autodev-openai-tunnel.socket`, `page-autodev-openai-egress.socket`, then `page-autodev-billing-gateway.socket`. Validate isolation before enabling any canary request.
6. Activate only an approved model snapshot and one low-risk, read-only canary route. Redirects, retries, fallback destinations, shell, writes and direct network access remain disabled.

### Controller credential rotation

Generate a reusable controller admission credential offline with `page-autodev-issue-controller-credential`. The active generation must appear in `controller_credential_policy.accepted_generations`; `max_ttl_ms` may not exceed 30 days.

For overlap rotation, add the next generation to `accepted_generations`, validate and restart only the Billing Gateway, issue and atomically install the new controller credential, then restart the selected canary controller. After confirmation, remove the old generation and restart only the Billing Gateway. Normal rotation does not require the egress API key to move or change.

For emergency revocation, first disable the canary route and egress activation. Set `revoked_before_ms` to the incident cutoff and replace `accepted_generations` with a new generation. Restart the Billing Gateway, issue a new controller credential, and do not restart the controller until the incident scope, pending leases and reconciliation state have been reviewed. Never clear a global billing hold merely to resume traffic.

### Stop and recovery order

Stop controllers first, then Billing Gateway, egress broker and fixed tunnel. Preserve billing state, pending outbox records, request IDs and reconciliation evidence. A request with unknown provider outcome remains charged/reserved and must not be replayed under a new identity.
