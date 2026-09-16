#!/usr/bin/env bash
set -euo pipefail

[[ "${EUID}" -eq 0 ]] || { echo ROOT_REQUIRED >&2; exit 1; }
source_root=/opt/page-autodev/integrations/dataforseo
policy=/etc/page-autodev/credentials/dataforseo-egress-policy.json
units=(dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket)
for unit in "${units[@]}"; do
  if systemctl is-active --quiet "${unit}"; then echo "SERVICE_ALREADY_ACTIVE:${unit}" >&2; exit 1; fi
done
[[ "$(stat -c '%U:%G:%a' "${policy}")" == 'root:root:600' ]] || { echo POLICY_PERMISSIONS_INVALID >&2; exit 1; }

cleanup() {
  local prior=$?
  trap - EXIT HUP INT TERM
  systemctl stop dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket || prior=1
  install -o root -g root -m 0600 "${source_root}/deploy/dataforseo-egress-policy.disabled.json" "${policy}" || prior=1
  for unit in "${units[@]}"; do
    if systemctl is-active --quiet "${unit}"; then echo "UNSAFE_ACTIVE_AFTER_RUN:${unit}" >&2; prior=1; fi
  done
  exit "${prior}"
}
trap cleanup EXIT HUP INT TERM

/usr/bin/node --jitless "${source_root}/bin/page-autodev-dataforseo-niche-serp.mjs" --prepare
systemctl start dataforseo-tunnel.socket dataforseo-egress.socket
systemctl start dataforseo-tunnel.service dataforseo-egress.service
systemctl is-active --quiet dataforseo-tunnel.service dataforseo-egress.service || { echo EGRESS_START_FAILED >&2; exit 1; }
/usr/bin/node --jitless "${source_root}/bin/page-autodev-dataforseo-niche-serp.mjs"
