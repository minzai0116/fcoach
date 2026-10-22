import type { MatchType, ScreenKey } from "../types/analysis";

export const SCREEN_LABELS: Record<ScreenKey, string> = {
  search: "검색/설정",
  diagnosis: "진단 대시보드",
  players: "선수·플레이 분석",
  habits: "선수·플레이 분석",
  actions: "전술 처방",
  rankers: "랭커 분석",
  tracking: "개선 추적",
  guide: "이용 가이드",
};

export const SCREEN_FLOW: { key: ScreenKey; icon: string; hint: string }[] = [
  { key: "guide", icon: "📘", hint: "서비스 활용법" },
  { key: "search", icon: "🔎", hint: "대상/옵션 선택" },
  { key: "diagnosis", icon: "📊", hint: "핵심 지표 진단" },
  { key: "players", icon: "⚽", hint: "포메이션·경기 기록" },
  { key: "actions", icon: "🎯", hint: "바꿀 설정·플레이" },
  { key: "rankers", icon: "🏅", hint: "랭커 비교 분석" },
  { key: "tracking", icon: "📈", hint: "선택한 경기 전후 비교" },
];

export const MATCH_LABELS: Record<MatchType, string> = {
  50: "공식경기",
  60: "공식 친선",
  52: "감독모드",
};

export const MATCH_TYPE_OPTIONS: MatchType[] = [50, 60];

export const ISSUE_LABELS: Record<string, string> = {
  HIGH_LATE_CONCEDE: "후반 실점 리스크",
  LOW_FINISHING: "득점 전환율 하락",
  POOR_SHOT_SELECTION: "유효 슈팅 비율 하락",
  OFFSIDE_RISK: "오프사이드 빈도 리스크",
  BUILDUP_INEFFICIENCY: "패스 성공률 하락",
  DEFENSE_DUEL_WEAKNESS: "태클 성공률 하락",
  CHANCE_CREATION_LOW: "찬스 생성량 저하",
  POSSESSION_CONTROL_RISK: "점유 안정성 리스크",
  INSUFFICIENT_DATA: "기록 확인",
  MAINTAIN_PERFORMANCE: "유지 권장",
};

export const ISSUE_DETAIL: Record<string, string> = {
  HIGH_LATE_CONCEDE: "실점 시간대와 수비 간격을 함께 확인하세요.",
  LOW_FINISHING: "이전 정상 종료 경기보다 득점 전환율이 낮아졌습니다. 슈팅 위치와 종류를 함께 확인하세요.",
  POOR_SHOT_SELECTION: "이전 정상 종료 경기보다 유효 슈팅 비율이 낮아졌습니다. 슈팅 각도와 시도 수를 함께 확인하세요.",
  OFFSIDE_RISK: "오프사이드 발생 빈도가 높습니다. 침투/패스 시도 빈도 조정이 필요합니다.",
  BUILDUP_INEFFICIENCY: "이전 정상 종료 경기보다 패스 성공률이 낮아졌습니다. 패스 종류별 시도와 실패 수를 확인하세요.",
  DEFENSE_DUEL_WEAKNESS: "이전 정상 종료 경기보다 태클 성공률이 낮아졌습니다. 상대 슈팅과 실점도 함께 확인하세요.",
  CHANCE_CREATION_LOW: "경기당 슈팅·xG 생성량이 낮아 공격 전개 볼륨 보강이 필요합니다.",
  POSSESSION_CONTROL_RISK: "점유 안정성이 낮아 공격 전환 전에 볼 순환 품질 개선이 필요합니다.",
  INSUFFICIENT_DATA: "현재 경기 기록을 확인하세요.",
  MAINTAIN_PERFORMANCE: "현재 전술을 유지하면서 동일 조건에서 추가 표본을 수집하세요.",
};

export const TACTIC_DIRECTION_KO: Record<string, string> = {
  HIGH_LATE_CONCEDE: "후반 수비 라인 안정화",
  LOW_FINISHING: "페널티박스 내 고품질 슈팅 유도",
  POOR_SHOT_SELECTION: "빌드업 인내도 상승으로 저효율 슈팅 감소",
  OFFSIDE_RISK: "침투 타이밍 지연 및 무리한 스루패스 축소",
  BUILDUP_INEFFICIENCY: "전개 연결 안정화",
  DEFENSE_DUEL_WEAKNESS: "수비 블록 압축 및 경합 강화",
  CHANCE_CREATION_LOW: "공격 전개 볼륨 확대",
  POSSESSION_CONTROL_RISK: "점유 안정화 우선",
  INSUFFICIENT_DATA: "추가 표본 수집 우선",
  MAINTAIN_PERFORMANCE: "전술 유지 및 추적 관찰",
};

export const METRIC_LABEL_KO: Record<string, string> = {
  late_concede_ratio: "60분 이후 실점 비중",
  goals_per_sot: "유효슈팅 대비 득점률(높을수록 좋음)",
  in_box_shot_ratio: "박스 안 슈팅 비중(높을수록 좋음)",
  shot_on_target_rate: "유효슈팅 비율(높을수록 좋음)",
  pass_success_rate: "패스 성공률(높을수록 좋음)",
  through_pass_success_rate: "스루패스 성공률(높을수록 좋음)",
  tackle_success_rate: "태클 성공률(높을수록 좋음)",
  shots_per_match: "경기당 슈팅수(높을수록 좋음)",
  goals_against_per_match: "경기당 실점(낮을수록 좋음)",
  possession_avg: "평균 점유율(높을수록 좋음)",
  offside_avg: "오프사이드 평균(낮을수록 좋음)",
  overall: "전체 퍼포먼스",
  xg_for_per_match: "경기당 xG",
};

export const BENCHMARK_SOURCE_LABEL: Record<string, string> = {
  own_history_v1: "내 이전 정상 종료 경기",
  unavailable: "비교 기록 없음",
  official_rank_1vs1: "공식 랭킹(1vs1)",
  ranker_proxy_v1: "기본 기준(공식 랭커 매핑 전)",
  top_cohort_v1: "수집 데이터 상위권 코호트",
};
