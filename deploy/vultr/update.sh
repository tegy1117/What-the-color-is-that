#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${WTCIT_CONFIG_FILE:-/etc/wtcit.env}"
MODE="deploy"
ORIGINAL_ARGS=("$@")

usage() {
  cat <<'EOF'
Usage: wtcit-update [--check]

  --check  Fetch origin and report whether the configured branch has updates.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ "${EUID}" -ne 0 ]]; then
  exec sudo -- "$0" "${ORIGINAL_ARGS[@]}"
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "Missing configuration: ${CONFIG_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONFIG_FILE}"
: "${APP_DIR:?APP_DIR is required}"
: "${REPOSITORY_URL:?REPOSITORY_URL is required}"
: "${BRANCH:?BRANCH is required}"
: "${DOMAIN:?DOMAIN is required}"

check_public_endpoint() {
  if [[ "${DOMAIN}" == ":80" ]]; then
    curl -fsS --retry 15 --retry-all-errors --retry-delay 2 \
      --connect-timeout 5 --max-time 20 http://127.0.0.1/health >/dev/null
  else
    curl -fsS --retry 15 --retry-all-errors --retry-delay 2 \
      --connect-timeout 5 --max-time 20 "https://${DOMAIN}/health" >/dev/null
  fi
}

exec 9>/run/lock/wtcit-update.lock
if ! flock -n 9; then
  echo "Another wtcit update is already running." >&2
  exit 1
fi

cd "${APP_DIR}"
if [[ "$(git remote get-url origin)" != "${REPOSITORY_URL}" ]]; then
  echo "Unexpected Git origin in ${APP_DIR}" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deployment checkout has local changes; refusing to overwrite them." >&2
  git status --short >&2
  exit 1
fi

current_commit="$(git rev-parse HEAD)"
git fetch --prune origin "${BRANCH}"
target_commit="$(git rev-parse "origin/${BRANCH}")"

if [[ "${MODE}" == "check" ]]; then
  if [[ "${current_commit}" == "${target_commit}" ]]; then
    echo "Already up to date: ${current_commit:0:7}"
  else
    echo "Update available: ${current_commit:0:7} -> ${target_commit:0:7}"
    git log --oneline --no-decorate "${current_commit}..${target_commit}"
  fi
  exit 0
fi

if [[ "${current_commit}" != "${target_commit}" ]]; then
  git switch "${BRANCH}"
  git merge --ff-only "origin/${BRANCH}"
fi

bash -n "${APP_DIR}/deploy/vultr/bootstrap.sh" \
  "${APP_DIR}/deploy/vultr/update.sh" \
  "${APP_DIR}/deploy/vultr/status.sh"
umask 077
printf 'DOMAIN=%s\n' "${DOMAIN}" > "${APP_DIR}/.env"

docker compose config --quiet
docker compose pull caddy
docker compose build --pull app
docker compose up -d --remove-orphans --wait
docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"
check_public_endpoint

install -m 0755 "${APP_DIR}/deploy/vultr/update.sh" /usr/local/sbin/wtcit-update
install -m 0755 "${APP_DIR}/deploy/vultr/status.sh" /usr/local/sbin/wtcit-status
deployed_commit="$(git rev-parse HEAD)"
install -d -m 0755 /var/lib/wtcit
printf '%s\n' "${deployed_commit}" > /var/lib/wtcit/deployed-commit
chmod 0644 /var/lib/wtcit/deployed-commit
logger -t wtcit-update "deployed ${deployed_commit}"
echo "Deployment complete: ${deployed_commit:0:7}"
