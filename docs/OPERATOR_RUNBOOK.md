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
