# Vultr 배포 가이드

이 구성은 Vultr Cloud Compute의 Ubuntu 24.04 단일 인스턴스를 기준으로 합니다.

- `app`: Node.js + Socket.IO + 빌드된 웹 앱
- `caddy`: HTTP/HTTPS, WebSocket 프록시, 압축, 정적 자산 캐시
- 도메인이 있으면 Caddy가 TLS 인증서를 자동 발급합니다.
- 도메인이 없으면 `DOMAIN=:80`으로 서버 IP에서 HTTP 테스트가 가능합니다.

> 방과 게임 상태는 메모리에만 있습니다. 컨테이너 재시작이나 재배포 시 진행 중인 방은 사라지며, 현재 구성은 복제본을 1개만 실행해야 합니다.

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

앱의 3000번 포트는 외부에 열지 않습니다.

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
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

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

배포할 커밋을 확인한 뒤 서버에서 실행합니다.

```bash
cd /opt/wtcit
git pull --ff-only
docker compose pull caddy
docker compose build --pull app
docker compose up -d --remove-orphans
docker compose ps
```

업데이트 중 앱 컨테이너가 교체되므로 진행 중인 방은 종료됩니다. 친구들이 플레이하지 않는 시간에 배포하는 것이 안전합니다.

## 운영 참고

- Caddy 인증서와 설정 데이터는 Docker 볼륨에 보존됩니다.
- `/assets/*`에는 1년 immutable 캐시가 적용됩니다.
- Caddy가 Gzip/Zstandard 압축과 WebSocket 업그레이드를 처리합니다.
- 여러 서버로 확장하려면 Socket.IO Redis adapter, sticky session, 공유 게임 상태 저장소가 추가로 필요합니다.
