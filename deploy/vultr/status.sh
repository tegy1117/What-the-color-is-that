#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${WTCIT_CONFIG_FILE:-/etc/wtcit.env}"

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "$@"
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing configuration: ${CONFIG_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONFIG_FILE}"
: "${APP_DIR:?APP_DIR is required}"
: "${DOMAIN:?DOMAIN is required}"

check_public_endpoint() {
  if [[ "${DOMAIN}" == ":80" ]]; then
    curl -fsS --connect-timeout 5 --max-time 20 http://127.0.0.1/health >/dev/null
  else
    curl -fsS --connect-timeout 5 --max-time 20 "https://${DOMAIN}/health" >/dev/null
  fi
}

cd "${APP_DIR}"
checkout_commit="$(git rev-parse HEAD)"
deployed_commit="$(cat /var/lib/wtcit/deployed-commit 2>/dev/null || true)"
commit_match="true"
echo "Domain: ${DOMAIN}"
echo "Checkout: ${checkout_commit:0:7} ($(git log -1 --pretty=%s))"
echo "Deployed: ${deployed_commit:0:7}"
if [[ -z "${deployed_commit}" || "${checkout_commit}" != "${deployed_commit}" ]]; then
  echo "WARNING: checkout and deployed commit do not match." >&2
  commit_match="false"
fi
echo
docker compose ps
echo
if docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/health').then(async (response) => { console.log(await response.text()); if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"; then
  echo "Application healthcheck: OK"
else
  echo "Application healthcheck: FAILED" >&2
  exit 1
fi

if check_public_endpoint; then
  echo "Public endpoint healthcheck: OK"
else
  echo "Public endpoint healthcheck: FAILED" >&2
  exit 1
fi

if [[ "${commit_match}" != "true" ]]; then
  exit 1
fi
