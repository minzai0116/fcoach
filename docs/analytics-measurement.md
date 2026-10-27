# FCOACH 이용 집계 기준

계측 버전: 2026-10-23. 변경 이후 기록에 적용되며 과거 수치를 소급 수정하지 않습니다. 신규 기능 완료 이벤트가 없던 기간의 0은 미사용 근거로 해석하지 않습니다.

2026-10-27 보완: 분석 실패는 개인정보 없는 `reason_code`로 경기 범위 만료·역순·종료 유형 필터·경기 없음·동기화 불가·처리 오류를 구분합니다. 기존 HTTP 400 기록에는 상세 사유가 없어 소급 원인 판정이 불가능합니다. 원문 오류 메시지·닉네임·경기 ID는 계측에 보내지 않습니다.

공개 피드 목록 완료 외에 `squad_feed_list_empty`와 `squad_feed_list_with_results`가 조회 페이지별로 기록됩니다. `feed_list_results.empty_pages/nonempty_pages`는 각각 이벤트 수와 고유 브라우저 수이며, 기존 기록은 이 구분이 없습니다. 빈 페이지여도 `has_more=true`면 뒤 페이지에 결과가 있을 수 있고, 결과가 있는 페이지 조회도 피드 선택을 의미하지 않습니다. 새 분류가 없는 과거 구간을 빈 목록이나 미선택으로 판정하지 않습니다.

## 무엇을 완료로 기록하는가

| 기능 | 완료 이벤트 | 실패 이벤트 | 완료 기준 |
|---|---|---|---|
| 공개 피드 목록 | `squad_feed_list_completed` | `squad_feed_list_failed` | 목록 응답을 화면에 반영. 빈 목록도 조회 완료이며 `result_count=0` |
| 공개 피드 선택 | `squad_feed_selection_completed` | `squad_feed_selection_failed` | 상세 조회와 작성자 확인 후 선택 반영. 실제 분석 연결과 별개 |
| 분석 결과에 피드 연결 | `squad_feed_connection_completed` | `squad_feed_connection_failed` | 경기 분석 결과에 `coaching.squad_feed.status=available` 반환 |
| 전후 비교 경기 목록 | `before_after_match_list_completed` | `before_after_match_list_failed` | 닉네임·경기 목록 응답 반영. 빈 목록은 `result_count=0` |
| 전후 비교 | `before_after_completed` | `before_after_failed` | 사용자가 요청한 두 구간의 비교 결과를 화면에 반영 |

피드 연결 완료는 설정을 읽었다는 의미이며 선수 일치나 과거 사용을 보장하지 않습니다. `coaching_linked`, `linked_records`, `different_records`, `withheld_records`, 작성자·모드 상태를 함께 확인합니다. 피드가 삭제·비공개로 바뀌거나 분석 중 연결에 실패하면 실패로 기록하고 경기 기록 분석 완료와 구분합니다. 응답 전에 화면이 해제되거나 입력이 바뀌어 폐기한 결과는 완료·실패에 포함하지 않습니다.

전후 비교 완료의 `before_matches`, `after_matches`는 선택한 개수가 아니라 API가 실제 비교에 사용한 경기 수입니다. 실패에는 단계·`error_kind`·HTTP 상태만 기록하고 오류 메시지나 닉네임을 보내지 않습니다.

`adopt_action`, `view_evaluation`은 과거 실험 기능입니다. 현재 전후 비교 이용량으로 합산하지 않습니다. `search_user`도 분석 실행 흐름의 닉네임 조회이며 모든 경기 목록·피드 조회를 뜻하지 않습니다.

## 페이지뷰 범위와 중복 제거

- 최초 화면과 실제 경로 변경만 각각 1회입니다. 경기 모드 변경, 같은 화면 재선택, 쿼리·해시 변경, 동일 주소의 history 상태 갱신은 추가 방문이 아닙니다. 다른 화면을 방문했다가 돌아오면 다시 1회입니다.
- `/`는 `/guide`, `/habits`는 `/players`로 정규화합니다. 경기·닉네임 등이 URL에 있어도 쿼리·해시는 전송하지 않습니다.
- 사이트 전체의 공통 계측이 개인정보처리방침·이용약관·라이선스 화면도 포함합니다. 특정 컴포넌트의 상태 변경으로 방문을 추가하지 않습니다.
- 운영 빌드의 HTTPS `fcoach.fun`, `www.fcoach.fun`에서만 수집합니다. localhost·127.0.0.1·Vercel 미리보기·다른 배포 별칭은 제외합니다. `NEXT_PUBLIC_ANALYTICS_DISABLED=true` 빌드도 제외합니다. API도 Origin을 확인해 이전 로컬 클라이언트의 전송을 차단합니다.
- 실제 운영 주소에서 진행한 검수는 별도 제외 빌드가 아니면 포함될 수 있습니다. 실제 사람 수와 익명 브라우저 수를 동일시하지 않습니다.

기존 서비스는 경기 모드 변경도 페이지뷰로 세고 있었습니다. Nexon 공식 스크립트는 최초 로드 및 모든 `pushState`·`replaceState`·`popstate`에서 수집하며 동일 URL인지 확인하지 않습니다. Next.js의 상태 갱신과 결합하면 중복될 수 있고 기존 로컬 화면에서도 실행됐습니다.

현재는 공통 경로 계측에서 서비스와 Nexon에 각각 1회 전송합니다. Nexon 어댑터는 [공식 스크립트](https://openapi.nexon.com/js/analytics.js?app_id=289946)의 `analytics/collect` 요청 형식(공개 app_id, href, hostname, referrer, 화면 크기)을 사용합니다. 자동 스크립트를 동시에 로드하지 않습니다. 이 수집 형식은 2026-10-23 확인한 공식 코드에 근거하며 별도 안정 버전 API 문서는 없으므로 Nexon 스크립트 변경 시 재확인해야 합니다. 실제 수집 요청을 생성하지 않는 OPTIONS 검사에서 운영 Origin의 CORS 허용을 확인했습니다.

Vercel은 공식 `Analytics` 컴포넌트를 유지하고 `beforeSend`에 같은 운영 범위와 URL 정규화를 적용합니다. 공급자별 차단·전송 실패·업데이트 지연·고유 방문자 계산이 달라 세 출처의 숫자가 반드시 같아지지는 않습니다.

## 보고할 때 지킬 기준

- 출처·조회 시각·응답의 시작/종료 경계·시간대를 함께 기록하고 방문자·페이지뷰를 출처 간 합산하지 않습니다.
- Redis의 `since`는 요청한 최근 시간의 시작, `bucket_since`는 실제 포함된 첫 시간 버킷입니다. `until`은 조회 기준 시각입니다. 이를 전날 KST 0~24시로 바꾸어 표현하지 않습니다.
- `feature_usage`의 이벤트 횟수와 고유 브라우저 수를 구분합니다. 같은 브라우저가 반복 실행할 수 있습니다. 신규/재방문도 횟수와 고유 수를 구분하며 두 고유 그룹은 중복될 수 있습니다.
- 이벤트 교집합은 순서를 보장하지 않습니다. 기존 `funnel_users` 호환 필드의 비율을 순차 전환율로 해석하지 않습니다.
- `page_view_hosts`의 `unknown`은 호스트 정보가 없던 과거 기록입니다. 운영 트래픽으로 임의 분류하지 않습니다. 새 계측 적용 전·후의 추세는 집계 정의가 바뀌었다는 점을 표시합니다.
- Vercel API의 지원하지 않는 `requestHostname` 그룹을 재시도하지 않습니다. production 프로젝트 범위와 서비스의 호스트별 집계를 구분해서 사용합니다.

Redis 조회의 집계 연산량은 `O(H×E+U)`로 유지합니다(H: 시간 버킷, E: 집계 이벤트 종류, U: 반환된 고유 집합 원소). 네트워크 왕복은 시간별 순차 요청에서 24시간씩 묶은 파이프라인 `O(ceil(H/24))`로 줄이고 한 묶음의 응답만 처리합니다.
