#!/usr/bin/env bash
set -euo pipefail
root=/opt/page-autodev/integrations/dataforseo; policy=/etc/page-autodev/credentials/dataforseo-egress-policy.json
units=(dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket)
cleanup(){ prior=$?; trap - EXIT; systemctl stop "${units[@]}" || prior=1; install -o root -g root -m 0600 "$root/deploy/dataforseo-egress-policy.disabled.json" "$policy" || prior=1; exit "$prior"; }
trap cleanup EXIT HUP INT TERM
for unit in "${units[@]}"; do ! systemctl is-active --quiet "$unit" || exit 1; done
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-keyword-recovery.mjs" --prepare
install -o root -g root -m 0600 "$root/deploy/dataforseo-egress-policy.keyword-overview-canary.json" "$policy"
systemctl start dataforseo-tunnel.socket dataforseo-egress.socket dataforseo-tunnel.service dataforseo-egress.service
systemctl is-active --quiet dataforseo-tunnel.service dataforseo-egress.service
/usr/bin/node --jitless "$root/bin/page-autodev-dataforseo-dashcam-keyword-recovery.mjs"
