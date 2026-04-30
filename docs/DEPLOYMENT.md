# FCOACH 배포 가이드

이 문서는 현재 공개 서비스 기준인 `Web(Next.js)` + `API(FastAPI)`의 Vercel 배포 절차를 정리합니다.
다만 API가 serverless + 로컬 SQLite로 동작하는 경우 데이터 지속성에 제약이 있습니다.

## 1. 사전 검증

```bash
cd <repo-root>
make test
cd apps/web && npm run build
```

검증 포인트:
- `.env`/키 파일이 커밋되지 않았는지 확인
- Open API 키가 로컬 파일이 아닌 플랫폼 환경변수로 주입되는지 확인

## 2. GitHub 업로드

```bash
cd <repo-root>
git add .
git commit -m "chore: release prep"
git push origin main
```

## 3. API 배포 (Vercel)

프로젝트: `fcoach-api`

필수 환경변수:
- `NEXON_OPEN_API_KEY`
- `HABIT_LAB_ENABLE_DEBUG_ENDPOINTS=0`
- `HABIT_LAB_AUTO_RANKER_SYNC=0`
- `HABIT_LAB_ENABLE_ANALYTICS_SUMMARY=0`
- `HABIT_LAB_ANALYTICS_ADMIN_KEY=<LONG_RANDOM_SECRET>`

데모/미리보기용:
- `HABIT_LAB_DB_PATH=/tmp/habit_lab.sqlite3`
- `POSTHOG_API_KEY` (선택)

주의:
- Vercel serverless 인스턴스의 로컬 파일은 지속 저장되지 않습니다.
- 따라서 `matches_raw`, `user_metrics_snapshot`, `experiment_eval`, `analytics_events`는 장기 운영 기준의 영속 저장소로 보기 어렵습니다.
- 공개 데모나 짧은 검증에는 사용할 수 있지만, 장기 운영 시에는 관리형 DB 또는 persistent volume 환경으로 전환해야 합니다.

헬스체크:
- `GET https://fcoach-api.vercel.app/health`

## 4. Web 배포 (Vercel)

프로젝트: `web`

필수 환경변수:
- `NEXT_PUBLIC_API_BASE_URL=https://fcoach-api.vercel.app`

주의:
- 웹 전역 Basic Auth는 제거된 상태입니다.
- 운영 로그는 API 관리자 키로만 조회됩니다.

## 5. 도메인 연결 (`fcoach.fun`)

- 메인: `fcoach.fun`
- 서브: `www.fcoach.fun`

현재 정책:
- `www.fcoach.fun` 요청은 `https://fcoach.fun`으로 308 영구 리다이렉트

검증 명령:

```bash
curl -I https://www.fcoach.fun
curl -I https://fcoach.fun
```

## 6. 운영 체크리스트

- [ ] `events/summary` 보호 키 주기적 교체
- [ ] 429 급증 시 `REDIS_URL` 연결 상태와 Nexon Open API 사용량 확인
- [ ] 랭커 동기화 배치 주기 점검(일 1회 권장)
- [ ] 장애 대응용 상태 점검: `/health`
- [ ] 배포 직후 모바일 동작(검색/탭/선수 리포트) 확인

## 7. 선택: Upstash Redis 캐시

Redis는 SQLite를 대체하지 않고, Vercel 인스턴스 사이에서 닉네임 조회/경기 데이터 캐시와 중복 분석 방지 락을 공유하는 용도입니다.

적용 절차:

1. Upstash Redis에서 무료 Redis DB를 생성합니다.
2. Connect 메뉴에서 `rediss://...` 형식의 Redis URL을 복사합니다.
3. API 프로젝트에 `REDIS_URL` 환경변수로 추가합니다.
4. API를 재배포합니다.

```bash
cd apps/api
pbpaste | npx vercel env add REDIS_URL production
npx vercel deploy --prod --yes
```

Redis가 없으면 기존처럼 메모리 캐시로 동작하지만, Vercel 인스턴스가 여러 개일 때 중복 Open API 호출을 막는 효과는 제한됩니다.

## 8. 롤백 전략

- Web: Vercel에서 이전 배포로 즉시 롤백
- API: Vercel에서 직전 배포 Promote
- 데이터: SQLite 파일 백업본 기준 복구

## 9. 참고: `render.yaml`

- 루트 `render.yaml`은 상태 저장형 Python API 배포 구성을 검토할 때 참고하는 초안입니다.
- 현재 공개 서비스의 기준 문서는 이 배포 가이드이며, `render.yaml`은 기본 배포 경로로 간주하지 않습니다.
- Render 등 컨테이너 기반 환경에서 SQLite를 유지하려면 별도 persistent disk 또는 외부 DB 구성이 필요합니다.
