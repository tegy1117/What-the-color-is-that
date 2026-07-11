# Vultr 배포 가이드

이 구성은 Vultr Cloud Compute의 Ubuntu 24.04 단일 인스턴스를 기준으로 합니다.

- `app`: Node.js + Socket.IO + 빌드된 웹 앱
- `caddy`: HTTP/HTTPS, WebSocket 프록시, 압축, 정적 자산 캐시
- 도메인이 있으면 Caddy가 TLS 인증서를 자동 발급합니다.
- 도메인이 없으면 `DOMAIN=:80`으로 서버 IP에서 HTTP 테스트가 가능합니다.

> 방과 게임 상태는 메모리에만 있습니다. 컨테이너 재시작이나 재배포 시 진행 중인 방은 사라지며, 현재 구성은 복제본을 1개만 실행해야 합니다.

## Cloud-Init으로 빠른 배포 (권장)

Vultr의 **Cloud-Init User Data** 입력란에 `deploy/vultr/cloud-init.yaml` 전체를 붙여 넣으면 첫 부팅에 다음 작업이 자동으로 진행됩니다.

1. Ubuntu 패키지 업데이트
2. RAM이 2GB 미만이면 빌드용 2GB swap 생성
3. GitHub 저장소 clone
4. Docker 공식 apt 저장소 등록 및 Docker Compose 설치
5. 앱 이미지 빌드와 Caddy 실행
6. `wtcit-update`, `wtcit-status` 관리 명령 설치

Cloud-Init은 root 권한으로 첫 부팅에 한 번 실행됩니다. 자동 구성에는 몇 분이 걸릴 수 있습니다.

### 1. 템플릿 설정

`deploy/vultr/cloud-init.yaml`에서 `DOMAIN`만 환경에 맞게 수정합니다.

IP로 먼저 실행할 때:

```bash
DOMAIN=':80'
```

DNS의 `A` 레코드를 Vultr 서버 IP에 연결한 뒤 HTTPS로 실행할 때:

```bash
DOMAIN='game.example.com'
```

Vultr 인스턴스 생성 화면에서 다음과 같이 설정합니다.

- OS: Ubuntu 24.04 LTS
- 인증: SSH Key 권장
- Additional Features → **Enable Cloud-Init User-Data**
- User Data: `#cloud-config` 줄을 포함해 템플릿 전체 붙여 넣기
- Vultr Firewall: 아래의 22/80/443 규칙 적용

### 2. 첫 배포 확인

SSH 접속이 가능해진 뒤 Cloud-Init 완료를 기다립니다.

```bash
sudo cloud-init status --wait
sudo wtcit-status
```

IP 모드에서는 `http://<SERVER_IP>`, 도메인 모드에서는 `https://<DOMAIN>`으로 접속합니다.

진행 상황과 실패 원인은 다음 명령으로 확인할 수 있습니다.

```bash
sudo tail -f /var/log/cloud-init-output.log
sudo cloud-init status --long
sudo cloud-init analyze blame
```

네트워크 문제 등으로 clone 또는 초기 빌드가 중단되었다면 원인을 해결한 뒤 같은 초기 배포 명령을 다시 실행할 수 있습니다. 불완전한 checkout은 삭제하지 않고 `/opt/wtcit.failed-<timestamp>`로 이동됩니다.

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
sudo wtcit-first-deploy
```

### 3. GitHub 변경 사항 업데이트

GitHub의 `main` 브랜치에 commit과 push를 완료한 뒤 서버에서 실행합니다.

```bash
sudo wtcit-update --check
sudo wtcit-update
sudo wtcit-status
```

`wtcit-update`는 로컬 변경이 있는 서버 checkout을 덮어쓰지 않으며, fast-forward 가능한 commit만 반영합니다. 실행할 때마다 앱 이미지를 다시 검증·빌드하므로 이전 빌드 실패 후 같은 명령으로 안전하게 재시도할 수 있습니다. 빌드가 실패하면 기존 컨테이너는 계속 실행되며, `wtcit-status`는 checkout commit과 실제 배포된 commit이 다르면 경고합니다.

배포 성공 조건에는 앱 컨테이너의 내부 healthcheck와 Caddy를 통과한 공개 HTTP/HTTPS healthcheck가 모두 포함됩니다.

자동 업데이트는 게임 중인 방을 예고 없이 종료할 수 있어 기본으로 설정하지 않았습니다. 나중에 GitHub Actions를 사용하더라도 서버에서 `sudo wtcit-update`만 호출하도록 구성하면 동일한 검증 절차를 재사용할 수 있습니다.

### 4. 도메인을 나중에 연결할 때

```bash
sudoedit /etc/wtcit.env
# DOMAIN='game.example.com'으로 변경
sudo wtcit-update
```

아래 1~7번은 Cloud-Init을 사용하지 않을 때의 수동 배포 절차입니다.

## 1. 배포 전 확인

1. 로컬 변경을 검토하고 커밋 또는 태그로 배포 버전을 고정합니다.
2. `.env`, SSH 키, 토큰 등 비밀 파일은 저장소나 업로드 묶음에 포함하지 않습니다.
3. 도메인을 사용할 경우 Vultr 서버 IP를 가리키는 `A` 레코드를 먼저 설정합니다.

권장 Vultr Firewall 인바운드 규칙:

| 포트 | 프로토콜 | 소스 | 용도 |
| --- | --- | --- | --- |
| 22 | TCP | 관리자 IP만 | SSH |
| 80 | TCP | 전체 | HTTP 및 인증서 발급 |
| 443 | TCP | 전체 | HTTPS 및 WebSocket |
| 443 | UDP | 전체 | HTTP/3, 선택 사항 |

앱의 3000번 포트는 외부에 열지 않습니다. Docker가 publish한 포트는 UFW 규칙을 우회할 수 있으므로 외부 접근 제어는 Vultr Firewall에서도 반드시 적용합니다.

## 2. Ubuntu에 Docker 설치

Vultr 서버에 SSH로 접속한 뒤 실행합니다.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

> `docker` 그룹은 컨테이너와 호스트 파일시스템을 제어할 수 있어 사실상 root와 동등한 권한입니다. 신뢰할 수 있는 단일 관리자 계정에서만 사용하고, 그룹 가입을 원하지 않으면 이후 명령에 `sudo`를 붙입니다.

SSH 연결을 종료하고 다시 접속한 다음 확인합니다.

```bash
docker --version
docker compose version
```

## 3. 소스 업로드

Git 저장소를 사용하는 방법을 권장합니다.

```bash
sudo mkdir -p /opt/wtcit
sudo chown "$USER":"$USER" /opt/wtcit
git clone <REPOSITORY_URL> /opt/wtcit
cd /opt/wtcit
```

저장소 접근이 어려우면 로컬에서 커밋된 파일만 묶어 전송할 수 있습니다.

```bash
git archive --format=tar.gz --output=wtcit.tar.gz HEAD
scp wtcit.tar.gz <USER>@<SERVER_IP>:/tmp/
```

서버에서 배포 디렉터리 권한을 설정한 뒤 압축을 풉니다.

```bash
sudo mkdir -p /opt/wtcit
sudo chown "$USER":"$USER" /opt/wtcit
cd /opt/wtcit
tar -xzf /tmp/wtcit.tar.gz
```

## 4. 도메인 설정

```bash
cd /opt/wtcit
cp .env.example .env
nano .env
```

IP로 먼저 확인할 때:

```dotenv
DOMAIN=:80
```

DNS 연결 후 자동 HTTPS를 사용할 때:

```dotenv
DOMAIN=game.example.com
```

## 5. 구성 검증 및 실행

```bash
cd /opt/wtcit
docker compose config
docker compose pull caddy
docker compose build --pull app
docker compose up -d
docker compose ps
```

`app`이 `healthy`, `caddy`가 `running` 상태인지 확인합니다.

IP 테스트:

```bash
curl -fsS http://<SERVER_IP>/health
```

도메인/HTTPS 테스트:

```bash
curl -fsS https://game.example.com/health
curl -i 'https://game.example.com/socket.io/?EIO=4&transport=polling'
```

두 번째 응답 본문이 `0{...}` 형태로 시작하면 Socket.IO 연결 경로가 정상입니다.

## 6. 로그 확인

```bash
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy
```

실시간으로 확인하려면 마지막에 `-f`를 붙이고, 종료할 때 `Ctrl+C`를 누릅니다.

## 7. 업데이트

Cloud-Init으로 설치했다면 관리 명령을 사용합니다.

```bash
sudo wtcit-update --check
sudo wtcit-update
sudo wtcit-status
```

수동으로 설치했다면 기존 명령을 사용합니다.

```bash
cd /opt/wtcit
git pull --ff-only
docker compose pull caddy
docker compose build --pull app
docker compose up -d --remove-orphans --wait
docker compose ps
```

업데이트 중 앱 컨테이너가 교체되므로 진행 중인 방은 종료됩니다. 친구들이 플레이하지 않는 시간에 배포하는 것이 안전합니다.

## 운영 참고

- Caddy 인증서와 설정 데이터는 Docker 볼륨에 보존됩니다.
- `/assets/*`에는 1년 immutable 캐시가 적용됩니다.
- Caddy가 Gzip/Zstandard 압축과 WebSocket 업그레이드를 처리합니다.
- 여러 서버로 확장하려면 Socket.IO Redis adapter, sticky session, 공유 게임 상태 저장소가 추가로 필요합니다.

## 참고한 공식 문서

- [Vultr Cloud-Init User Data](https://docs.vultr.com/how-to-deploy-a-vultr-server-with-cloudinit-userdata)
- [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [cloud-init module reference](https://cloudinit.readthedocs.io/en/latest/reference/modules.html)
