# FCOACH 배포 가이드

이 문서는 `Web(Next.js)` + `API(FastAPI)`를 Vercel 기준으로 배포하는 최소 절차를 정리합니다.

## 1. 사전 검증

```bash
cd /Users/kmj/Desktop/fc-habit-lab
make test
cd apps/web && npm run build
```

검증 포인트:
- `.env`/키 파일이 커밋되지 않았는지 확인
- Open API 키가 로컬 파일이 아닌 플랫폼 환경변수로 주입되는지 확인

## 2. GitHub 업로드

```bash
cd /Users/kmj/Desktop/fc-habit-lab
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

권장:
- `HABIT_LAB_DB_PATH=/tmp/habit_lab.sqlite3`
- `POSTHOG_API_KEY` (선택)

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
- [ ] 429 급증 시 `users/search` 캐시 TTL 상향
- [ ] 랭커 동기화 배치 주기 점검(일 1회 권장)
- [ ] 장애 대응용 상태 점검: `/health`
- [ ] 배포 직후 모바일 동작(검색/탭/선수 리포트) 확인

## 7. 롤백 전략

- Web: Vercel에서 이전 배포로 즉시 롤백
- API: Vercel에서 직전 배포 Promote
- 데이터: SQLite 파일 백업본 기준 복구

