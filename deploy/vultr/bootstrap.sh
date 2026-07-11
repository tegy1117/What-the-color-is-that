#!/usr/bin/env bash
set -Eeuo pipefail

trap 'echo "[wtcit-bootstrap] failed at line ${LINENO}" >&2' ERR

CONFIG_FILE="${WTCIT_CONFIG_FILE:-/etc/wtcit.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root." >&2
  exit 1
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

ensure_swap() {
  local memory_kb
  memory_kb="$(awk '/MemTotal/ { print $2 }' /proc/meminfo)"

  if [[ "${ENABLE_SWAP:-auto}" == "false" ]] || swapon --show --noheadings | grep -q .; then
    return
  fi
  if [[ "${ENABLE_SWAP:-auto}" == "auto" && "${memory_kb}" -ge 2000000 ]]; then
    return
  fi

  local size_gb="${SWAP_SIZE_GB:-2}"
  echo "[wtcit-bootstrap] creating ${size_gb} GiB swap file"
  fallocate -l "${size_gb}G" /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
}

check_public_endpoint() {
  if [[ "${DOMAIN}" == ":80" ]]; then
    curl -fsS --retry 5 --retry-connrefused --retry-delay 2 \
      --connect-timeout 5 --max-time 20 http://127.0.0.1/health >/dev/null
  else
    curl -fsS --retry 5 --retry-connrefused --retry-delay 2 \
      --connect-timeout 5 --max-time 20 "https://${DOMAIN}/health" >/dev/null
  fi
}

install_docker() {
  echo "[wtcit-bootstrap] installing Docker Engine from the official apt repository"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl
  apt-get remove -y docker.io docker-compose docker-compose-v2 podman-docker containerd runc || true

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  # shellcheck disable=SC1091
  source /etc/os-release
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-${VERSION_CODENAME}}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

ensure_swap

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install_docker
fi
systemctl enable --now docker

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Expected a Git checkout at ${APP_DIR}" >&2
  exit 1
fi
if [[ "$(git -C "${APP_DIR}" remote get-url origin)" != "${REPOSITORY_URL}" ]]; then
  echo "Unexpected Git origin in ${APP_DIR}" >&2
  exit 1
fi

bash -n "${APP_DIR}/deploy/vultr/bootstrap.sh" \
  "${APP_DIR}/deploy/vultr/update.sh" \
  "${APP_DIR}/deploy/vultr/status.sh"
install -m 0755 "${APP_DIR}/deploy/vultr/update.sh" /usr/local/sbin/wtcit-update
install -m 0755 "${APP_DIR}/deploy/vultr/status.sh" /usr/local/sbin/wtcit-status

umask 077
printf 'DOMAIN=%s\n' "${DOMAIN}" > "${APP_DIR}/.env"

cd "${APP_DIR}"
docker compose config --quiet
docker compose pull caddy
docker compose build --pull app
docker compose up -d --remove-orphans --wait
docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"
check_public_endpoint

install -d -m 0755 /var/lib/wtcit
git rev-parse HEAD > /var/lib/wtcit/deployed-commit
chmod 0644 /var/lib/wtcit/deployed-commit

logger -t wtcit-bootstrap "deployed $(git rev-parse --short HEAD)"
echo "[wtcit-bootstrap] deployment complete: $(git rev-parse --short HEAD)"
