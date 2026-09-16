#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "ROOT_REQUIRED" >&2
  exit 1
fi

source_root="${1:-}"
if [[ -z "${source_root}" || ! -d "${source_root}/bin" || ! -d "${source_root}/lib" ]]; then
  echo "SOURCE_ROOT_INVALID" >&2
  exit 1
fi
source_root="$(readlink -f -- "${source_root}")"
target_root="/opt/page-autodev/integrations/dataforseo"
credential_root="/etc/page-autodev/credentials"
unit_root="/etc/systemd/system"

for credential in dataforseo-login dataforseo-password; do
  path="${credential_root}/${credential}"
  [[ -f "${path}" && -s "${path}" ]] || { echo "MISSING_CREDENTIAL:${path}" >&2; exit 1; }
  [[ "$(stat -c '%U:%G:%a' "${path}")" == "root:root:600" ]] || { echo "UNSAFE_CREDENTIAL:${path}" >&2; exit 1; }
done

getent group page-autodev-egress >/dev/null || groupadd --system page-autodev-egress
getent group page-autodev-dataforseo-egress >/dev/null || groupadd --system page-autodev-dataforseo-egress
id page-autodev-dataforseo-egress >/dev/null 2>&1 || useradd --system --gid page-autodev-dataforseo-egress --home-dir /nonexistent --shell /usr/sbin/nologin page-autodev-dataforseo-egress

install -d -o root -g root -m 0755 /opt/page-autodev/integrations
if [[ -e "${target_root}" ]]; then
  backup_root="/var/backups/page-autodev-dataforseo/$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -o root -g root -m 0700 "${backup_root}"
  cp -a -- "${target_root}" "${backup_root}/dataforseo"
fi
install -d -o root -g root -m 0755 "${target_root}"
cp -a -- "${source_root}/." "${target_root}/"
chown -R root:root "${target_root}"
find "${target_root}" -type d -exec chmod 0755 {} +
find "${target_root}" -type f -exec chmod 0644 {} +
chmod 0755 "${target_root}/deploy/install-disabled.sh"
chmod 0755 "${target_root}/deploy/run-niche-keyword-canary.sh"

install -o root -g root -m 0600 "${source_root}/deploy/dataforseo-egress-policy.disabled.json" "${credential_root}/dataforseo-egress-policy.json"
if [[ ! -e "${credential_root}/gateway-assertion-secret" ]]; then
  umask 077
  openssl rand -base64 48 > "${credential_root}/gateway-assertion-secret"
fi
chown root:root "${credential_root}/gateway-assertion-secret"
chmod 0600 "${credential_root}/gateway-assertion-secret"

for unit in dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket; do
  install -o root -g root -m 0644 "${source_root}/deploy/${unit}.template" "${unit_root}/${unit}"
done
systemctl daemon-reload

for unit in dataforseo-egress.service dataforseo-egress.socket dataforseo-tunnel.service dataforseo-tunnel.socket; do
  systemctl is-active --quiet "${unit}" && { echo "UNEXPECTED_ACTIVE:${unit}" >&2; exit 1; }
  enablement="$(systemctl is-enabled "${unit}" 2>/dev/null || true)"
  [[ "${enablement}" == "enabled" || "${enablement}" == "enabled-runtime" ]] && { echo "UNEXPECTED_ENABLED:${unit}" >&2; exit 1; }
done
echo "DATAFORSEO_DISABLED_INSTALL_OK"
