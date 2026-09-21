#!/usr/bin/env bash
set -euo pipefail
[[ ${EUID} -eq 0 ]] || exit 1
root=/opt/page-autodev/integrations/dataforseo; policy=/etc/page-autodev/credentials/dataforseo-egress-policy.json
units=(dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket)
stop_all(){ systemctl stop "${units[@]}" || true; install -o root -g root -m 0600 "$root/deploy/dataforseo-egress-policy.disabled.json" "$policy"; }
trap stop_all EXIT HUP INT TERM
for unit in "${units[@]}"; do ! systemctl is-active --quiet "$unit" || { echo SERVICE_ALREADY_ACTIVE >&2; exit 1; }; done
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-demand.mjs" --prepare
install -o root -g root -m 0600 "$root/deploy/dataforseo-egress-policy.canary.json" "$policy"
systemctl start dataforseo-tunnel.socket dataforseo-egress.socket dataforseo-tunnel.service dataforseo-egress.service
systemctl is-active --quiet dataforseo-tunnel.service dataforseo-egress.service
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-demand.mjs" --keyword
stop_all
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-demand.mjs" --activate-serp
systemctl start dataforseo-tunnel.socket dataforseo-egress.socket dataforseo-tunnel.service dataforseo-egress.service
systemctl is-active --quiet dataforseo-tunnel.service dataforseo-egress.service
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-demand.mjs" --serp
