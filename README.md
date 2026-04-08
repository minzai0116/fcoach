# FCOACH

FC Online 경기 로그를 기반으로 개인 플레이를 진단하고, 전술 액션을 제안하고, 적용 효과를 검증하는 데이터 분석 포트폴리오 프로젝트입니다.

- 서비스 URL: [https://fcoach.fun](https://fcoach.fun)
- API URL: [https://fcoach-api.vercel.app](https://fcoach-api.vercel.app)
- GitHub: [https://github.com/minzai0116/fcoach](https://github.com/minzai0116/fcoach)

## 1. 프로젝트 목표

기존 전적 조회 서비스는 "무엇이 문제인지"는 보여주지만 "그래서 무엇을 바꿔야 하는지"는 약한 경우가 많습니다.
FCOACH는 아래 3단계 루프를 제품 중심으로 구현했습니다.

1. 진단: 공식/친선 + 5/10/30경기 단위 KPI 계산
2. 개입: 우선순위 액션 카드 + 전술 변경 가이드 제시
3. 검증: 액션 채택 전/후 지표 비교

## 2. 핵심 기능

- 닉네임 검색 → OUID 조회 → 분석 실행 원클릭
- 모드(공식/친선), 구간(5/10/30경기) 분리 분석
- 이슈 점수 분해(후반 실점, 찬스 생성, 마무리, 오프사이드 등)
- 액션 플랜(왜 바꾸나/무엇을 바꾸나/검증 기준)
- 랭커 기준 비교 + 유사 성향 랭커 후보
- 선수 리포트(포지션 배치, 시즌/강화, 상세 성과표)
- 클릭/탭/실행 이벤트 로깅(운영용)

## 3. 기술 스택

- Web: Next.js 15, React 19, TypeScript
- API: FastAPI, Pydantic
- DB: SQLite (단일 파일)
- 데이터 소스: Nexon Open API, FC Online DataCenter(랭커)
- 배포: Vercel(Web/API)

## 4. 아키텍처

```text
[Browser]
  -> Next.js (apps/web)
  -> FastAPI (apps/api)
  -> SQLite (data/habit_lab.sqlite3)
  -> Nexon Open API / FC DataCenter
```

- Web은 API를 호출해 분석 결과를 렌더링합니다.
- API는 외부 데이터를 수집/정규화한 뒤 SQLite에 스냅샷과 실험 로그를 저장합니다.
- 읽기 경로와 동기화 경로를 분리해 사용자 체감 지연을 줄였습니다.

## 5. 디렉터리 구조

```text
fcoach/
├─ apps/
│  ├─ api/         # FastAPI 엔드포인트/분석 로직
│  └─ web/         # Next.js UI
├─ data/           # SQLite 파일
├─ docs/           # 배포/운영 문서
├─ LICENSE
└─ README.md
```

## 6. 로컬 실행

```bash
git clone https://github.com/minzai0116/fcoach.git
cd fcoach
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
make init
make init-db
```

필수 설정:

```bash
NEXON_OPEN_API_KEY=YOUR_NEXON_OPEN_API_KEY
```

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

실행(로컬):

```bash
make api
cd apps/web && npm install && npm run dev
```

## 7. 주요 API (요약)

- `GET /users/search?nickname=...`
- `POST /analysis/run`
- `GET /analysis/latest?ouid=...&match_type=52&window=30`
- `GET /actions/latest?ouid=...&match_type=52&window=30`
- `POST /experiments`
- `GET /experiments/evaluation?ouid=...&match_type=52`

## 8. 배포

- 배포 절차: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- 현재 공개 서비스는 `Vercel(Web/API)` 기준의 데모 배포입니다.
- API가 serverless 환경에서 로컬 SQLite를 사용하면 스냅샷, 실험 기록, 이벤트 로그는 지속 저장되지 않습니다.
- 장기 운영 기준에서는 관리형 DB 또는 persistent volume이 있는 환경으로 전환이 필요합니다.
- 루트 `render.yaml`은 상태 저장형 Python API 배포 구성을 검토할 때 참고하는 초안입니다.

## 9. 라이선스 및 고지

- 소스코드 라이선스: MIT ([LICENSE](LICENSE))
- FC Online 관련 데이터/상표/이미지 권리는 각 권리자에게 있습니다.
- 본 프로젝트는 비공식 팬/포트폴리오 프로젝트입니다.
