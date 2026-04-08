<div align="center">

# FCOACH

FC Online 경기 데이터를 바탕으로 플레이를 진단하고, 전술 액션을 제안하고, 적용 효과까지 검증하는 데이터 기반 코칭 서비스

[서비스](https://fcoach.fun) · [API](https://fcoach-api.vercel.app) · [GitHub](https://github.com/minzai0116/fcoach)

</div>

## 프로젝트 개요

| 항목 | 내용 |
| --- | --- |
| 한줄 요약 | 경기 로그를 분석해 플레이 문제를 진단하고, 개선 액션과 검증 기준을 함께 제시하는 코칭 서비스 |
| 대상 도메인 | FC Online 경기 분석 |
| 핵심 가치 | 단순 전적 조회를 넘어, 무엇을 바꿔야 하는지까지 제안 |
| 주요 데이터 | Nexon Open API, FC Online DataCenter(랭커) |
| 서비스 구성 | Next.js 웹, FastAPI 분석 API, SQLite 기반 스냅샷 저장 |
| 배포 환경 | Vercel(Web/API) |

## 문제 인식

기존 전적 조회 서비스는 승률, 득점, 실점 같은 결과 지표를 보여주는 데는 강하지만, 실제로 플레이어가 다음 경기에서 무엇을 바꿔야 하는지까지 연결해 주는 경우는 드뭅니다.

FCOACH는 이 공백을 메우기 위해 `진단 -> 개입 -> 검증` 흐름을 하나의 제품 경험으로 묶었습니다. 사용자는 닉네임만 입력하면 최근 경기 데이터를 기준으로 문제 유형을 확인하고, 액션 카드와 검증 지표를 통해 다음 플레이 방향까지 바로 확인할 수 있습니다.

## 핵심 흐름

```mermaid
flowchart LR
    A["닉네임 입력"] --> B["경기 데이터 수집"]
    B --> C["KPI 계산 및 이슈 진단"]
    C --> D["우선순위 액션 제안"]
    D --> E["전후 지표 비교로 효과 검증"]
```

## 핵심 기능

- 닉네임 검색 후 OUID 조회와 분석 실행을 한 번에 처리합니다.
- 공식전/친선전, 최근 5·10·30경기 구간을 나눠 플레이 패턴을 비교합니다.
- 후반 실점, 찬스 생성, 마무리, 오프사이드 등 이슈 점수를 세부 항목으로 분해합니다.
- 문제 원인에 따라 액션 카드와 전술 변경 가이드를 제시합니다.
- 랭커 기준 비교와 유사 성향 랭커 후보를 함께 보여줍니다.
- 선수 리포트에서 포지션 배치, 시즌/강화, 상세 성과표를 제공합니다.
- 클릭, 탭, 실행 이벤트를 기록해 운영 지표를 추적합니다.

## 시스템 구조

```mermaid
flowchart TD
    A["Next.js Web"] --> B["FastAPI API"]
    B --> C["SQLite Snapshot Store"]
    B --> D["Nexon Open API"]
    B --> E["FC Online DataCenter"]
```

- Web은 분석 요청과 결과 렌더링을 담당합니다.
- API는 외부 데이터를 수집하고 정규화한 뒤 분석 결과와 실험 로그를 생성합니다.
- 저장 계층은 스냅샷, 실험 기록, 이벤트 로그를 관리합니다.
- 읽기 경로와 동기화 경로를 분리해 사용자 체감 지연을 줄였습니다.

## 기술 스택

- Web: `Next.js 15`, `React 19`, `TypeScript`
- API: `FastAPI`, `Pydantic`
- DB: `SQLite`
- Data Source: `Nexon Open API`, `FC Online DataCenter`
- Deploy: `Vercel`

## 디렉터리 구조

```text
fcoach/
├─ apps/
│  ├─ api/               # FastAPI 엔드포인트와 분석 로직
│  └─ web/               # Next.js 사용자 인터페이스
├─ data/                 # SQLite 파일과 로컬 데이터
├─ docs/                 # 배포, API, 제품 문서
├─ render.yaml           # 대안 배포 초안
└─ README.md
```

## 로컬 실행

```bash
git clone https://github.com/minzai0116/fcoach.git
cd fcoach
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
make init
make init-db
```

필수 환경 변수:

```bash
NEXON_OPEN_API_KEY=YOUR_NEXON_OPEN_API_KEY
```

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

실행:

```bash
make api
cd apps/web && npm install && npm run dev
```

## 주요 API

- `GET /users/search?nickname=...`
- `POST /analysis/run`
- `GET /analysis/latest?ouid=...&match_type=52&window=30`
- `GET /actions/latest?ouid=...&match_type=52&window=30`
- `POST /experiments`
- `GET /experiments/evaluation?ouid=...&match_type=52`

## 배포 메모

- 배포 절차는 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)에 정리했습니다.
- 현재 공개 서비스는 `Vercel(Web/API)` 기준의 데모 배포입니다.
- API가 serverless 환경에서 로컬 SQLite를 사용하면 스냅샷, 실험 기록, 이벤트 로그는 지속 저장되지 않습니다.
- 장기 운영 기준에서는 관리형 DB 또는 persistent volume이 있는 환경으로 전환이 필요합니다.
- 루트 [render.yaml](render.yaml)은 상태 저장형 Python API 배포 구성을 검토할 때 참고하는 초안입니다.

## 라이선스 및 고지

- 소스코드 라이선스: MIT ([LICENSE](LICENSE))
- FC Online 관련 데이터, 상표, 이미지 권리는 각 권리자에게 있습니다.
- 본 프로젝트는 비공식 팬 프로젝트이자 포트폴리오 용도로 제작했습니다.
