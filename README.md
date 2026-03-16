# FCOACH

FC Online 전적 데이터를 기반으로 **진단 → 액션 추천 → 개선 검증** 루프를 제공하는 개인 코치 서비스입니다.

## 1) 프로젝트 구조

```text
fc-habit-lab/
├─ apps/
│  ├─ api/         # FastAPI, 분석/랭커/실험 로직
│  └─ web/         # Next.js 대시보드
├─ data/           # SQLite 파일 (기본: habit_lab.sqlite3)
├─ docs/           # PRD / API / 데이터 스펙
├─ LICENSE
└─ README.md
```

## 2) 기술 스택

- API: FastAPI + SQLite (옵션: Redis 캐시)
- Web: Next.js 15 + React 19
- Data Source: Nexon Open API, FC Online DataCenter(랭커)

## 3) 빠른 시작 (로컬)

```bash
cd /Users/kmj/Desktop/fc-habit-lab
make init
make init-db
```

`.env` 예시:

```bash
NEXON_OPEN_API_KEY=YOUR_KEY
HABIT_LAB_AUTO_RANKER_SYNC=0
HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0
```

서버 실행:

```bash
make api
cd apps/web && npm install && npm run dev
```

## 4) 주요 엔드포인트

- `GET /users/search?nickname=...`
- `POST /analysis/run`
- `GET /analysis/latest?ouid=...&match_type=50&window=30`
- `GET /actions/latest?ouid=...&match_type=50&window=30`
- `POST /experiments`
- `GET /experiments/evaluation?ouid=...&match_type=50`
- `GET /rankers/latest?mode=1vs1&limit=20`
- `POST /rankers/refresh?...` (관리 목적)
- `POST /events/track` (사용자 클릭/방문 이벤트 수집)
- `GET /events/summary?hours=24&limit=10` (최근 사용 로그 요약)

## 5) 랭커 동기화 운영 권장 방식

분석 요청 경로에서 동기화를 직접 수행하지 않고, 배치로 분리하는 것을 권장합니다.

```bash
make sync-rankers MODE=1vs1 MATCH_TYPE=50 PAGES=2 MAX_RANKERS=30 PER_RANKER_MATCHES=8
```

운영에서는 이 명령을 **하루 1회 크론**으로 등록하세요.

## 6) 성능/트래픽 주의사항

- SQLite 단일 파일 구조라 동시 쓰기 트래픽이 커지면 lock 대기가 발생할 수 있습니다.
- 트래픽 증가 시 우선순위:
  1. 요청 경로는 “조회+계산”만 유지
  2. 수집/랭커 동기화는 배치/큐로 분리
  3. SQLite WAL/timeout 적용, 이후 Postgres 전환 검토
  4. API rate limit + 캐시 TTL 튜닝

## 6-1) 클릭/방문 로그(분석 이벤트)

- Web에서 주요 이벤트(`page_view`, `run_analysis`, `adopt_action`, `tab_click`)를 자동 수집합니다.
- 기본 저장소: SQLite `analytics_events`
- 선택 연동: `POSTHOG_API_KEY` 설정 시 PostHog로도 이벤트 포워딩
- 대시보드 확인:
  - Web `이용 가이드` 탭의 `최근 24시간 사용 로그 보기`
  - 또는 API `GET /events/summary?hours=24`

## 7) 배포 전 체크리스트

- [ ] `.env`, API 키, DB 파일 미노출 확인
- [ ] `HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0` 확인
- [ ] `npm run build` / API 테스트 통과
- [ ] `개인정보처리방침`, `이용약관`, `라이선스 고지` 페이지 링크 점검
- [ ] 문의 이메일/운영자 정보 최신화
- [ ] 랭커 배치 동기화 스케줄 설정

## 8) 라이선스

본 저장소의 소스코드는 루트 `LICENSE`(MIT)를 따릅니다.  
FC Online 관련 데이터/이미지/상표 권리는 각 권리자에게 있습니다.

## 9) 개발 서버 오류(Next 청크 오류) 대응

`Cannot find module './xxx.js'` 같은 Next 개발 서버 청크 오류가 나오면 캐시를 지우고 재시작하세요.

```bash
cd /Users/kmj/Desktop/fc-habit-lab
make web-clean
```

## 10) GitHub 업로드 순서

아직 로컬 저장소가 없다면 아래 순서로 1회 설정합니다.

```bash
cd /Users/kmj/Desktop/fc-habit-lab
git init
git add .
git commit -m "feat: initial FCOACH release"
git branch -M main
git remote add origin https://github.com/<YOUR_ID>/<YOUR_REPO>.git
git push -u origin main
```

이미 원격 저장소가 있으면 `git remote add origin ...`부터 시작하세요.

## 11) 배포 가이드(권장: API=Render, Web=Vercel)

자세한 절차는 `/Users/kmj/Desktop/fc-habit-lab/docs/DEPLOYMENT.md`를 참고하세요.

- API(FastAPI): Render Web Service
  - Start: `cd apps/api && PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - 필수 환경변수: `NEXON_OPEN_API_KEY`, `HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0`
  - 권장 환경변수: `HABIT_LAB_DB_PATH=/var/data/habit_lab.sqlite3` (Persistent Disk 연결)
- Web(Next.js): Vercel
  - Root Directory: `apps/web`
  - Env: `NEXT_PUBLIC_API_BASE_URL=https://<RENDER_API_URL>`

주의: SQLite는 파일 기반이므로 **지속 스토리지 없는 배포 환경**에서는 데이터가 초기화될 수 있습니다.
