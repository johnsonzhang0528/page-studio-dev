#!/usr/bin/env node
import fs from "node:fs";
import { createBillingFirewall } from "../lib/billing-firewall.mjs";
import { reconcileProviderOutcome } from "../lib/billing-reconciler.mjs";
import { createPriceRegistry } from "../lib/price-registry.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((item) => {
    const separator = item.indexOf("=");
    if (!item.startsWith("--") || separator < 3)
      throw new Error("BILLING_RECONCILE_ARGUMENT_INVALID");
    return [item.slice(2, separator), item.slice(separator + 1)];
  }),
);
for (const required of ["root", "config", "lease", "evidence"])
  if (!args[required]) throw new Error(`BILLING_RECONCILE_${required.toUpperCase()}_REQUIRED`);

const config = JSON.parse(fs.readFileSync(args.config, "utf8"));
const evidence = JSON.parse(fs.readFileSync(args.evidence, "utf8"));
const firewall = createBillingFirewall({
  root: args.root,
  priceRegistry: createPriceRegistry(config.price_registry),
  policy: config.billing_policy,
});
const settlement = reconcileProviderOutcome(firewall, args.lease, evidence);
let hold_release = null;
if (firewall.snapshot().global_hold?.reason === "CONSECUTIVE_NO_PROGRESS") {
  hold_release = firewall.releaseConsecutiveNoProgressHold({
    evidence_sha256: evidence.evidence_sha256,
    operator_reason: "Reconciled accepted legacy requests after persistence repair",
  });
}
process.stdout.write(
  `${JSON.stringify({
    lease_id: args.lease,
    settlement_outcome: evidence.status,
    released_microusd: settlement.released_microusd,
    hold_released: hold_release !== null,
  })}\n`,
);
