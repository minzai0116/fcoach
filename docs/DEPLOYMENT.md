# FCOACH 배포 가이드

## 1. 배포 전 체크

```bash
cd /Users/kmj/Desktop/fc-habit-lab
make test
cd apps/web && npm run build
```

- `.env` 파일은 커밋하지 않습니다.
- `HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0` 유지
- Open API 키는 배포 플랫폼 환경변수로만 주입

---

## 2. GitHub 업로드

```bash
cd /Users/kmj/Desktop/fc-habit-lab
git init
git add .
git commit -m "feat: initial FCOACH release"
git branch -M main
git remote add origin https://github.com/<YOUR_ID>/<YOUR_REPO>.git
git push -u origin main
```

---

## 3. API 배포 (Render)

### 3-1) 서비스 생성
- Render → New + → Web Service
- GitHub repo 연결
- Root Directory: `/` (저장소 루트)

### 3-2) Build / Start 명령
- Build Command
```bash
pip install -r apps/api/requirements.txt
```
- Start Command
```bash
cd apps/api && PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### 3-3) 환경변수
- `NEXON_OPEN_API_KEY=...`
- `HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0`
- `HABIT_LAB_AUTO_RANKER_SYNC=0`
- `HABIT_LAB_DB_PATH=/var/data/habit_lab.sqlite3` (Persistent Disk 마운트 시)

### 3-4) 스토리지
- SQLite 파일 유지가 필요하면 Render Persistent Disk를 연결합니다.
- 디스크 미연결 시 재배포/재시작에 따라 데이터가 유실될 수 있습니다.

---

## 4. Web 배포 (Vercel)

### 4-1) 프로젝트 생성
- Vercel → New Project → GitHub repo 선택
- Root Directory: `apps/web`

### 4-2) 환경변수
- `NEXT_PUBLIC_API_BASE_URL=https://<RENDER_API_URL>`

### 4-3) 배포
- Framework Preset은 Next.js 자동 인식
- Deploy 후 `/privacy`, `/terms`, `/license` 링크까지 확인

---

## 5. 운영 권장

- 랭커 동기화는 API 요청 경로에서 동기 실행하지 말고 배치로 실행:
```bash
cd /Users/kmj/Desktop/fc-habit-lab
make sync-rankers MODE=1vs1 MATCH_TYPE=50 PAGES=2 MAX_RANKERS=30 PER_RANKER_MATCHES=8
```
- 하루 1회 스케줄링 권장
- 429 보호를 위해 닉네임 조회 캐시를 유지(현재 SQLite cache 적용)
