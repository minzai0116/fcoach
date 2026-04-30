"use client";

type GuideScreenProps = {
  hasActions: boolean;
  hasExperiment: boolean;
  onStartSearch: () => void;
  onOpenActions: () => void;
  onOpenTracking: () => void;
};

const experimentSteps = [
  {
    title: "1. 닉네임으로 진단",
    body: "공식/친선과 최근 5·10·30경기 기준을 고른 뒤 빠른 시작을 누릅니다.",
  },
  {
    title: "2. 전술 코칭 확인",
    body: "가장 우선순위가 높은 문제 1개를 보고, 추천 전술이 납득되는지 확인합니다.",
  },
  {
    title: "3. 실험 시작",
    body: "추천 카드의 실험 시작을 누르면 그 시각을 기준으로 적용 전/후가 나뉩니다.",
  },
  {
    title: "4. 5경기 고정 적용",
    body: "추천 전술을 경기 시작 전에 적용하고, 최소 5경기 동안 같은 조건으로 플레이합니다.",
  },
  {
    title: "5. 다시 진단 후 평가",
    body: "5경기 후 빠른 시작을 다시 누른 뒤 개선 추적에서 최신 실험 평가를 갱신합니다.",
  },
];

export function GuideScreen({
  hasActions,
  hasExperiment,
  onStartSearch,
  onOpenActions,
  onOpenTracking,
}: GuideScreenProps) {
  return (
    <section className="grid">
      <article className="panel guide-hero">
        <p className="eyebrow">처음 오셨다면 여기부터</p>
        <h2 className="section-title">FCOACH는 “진단 → 5경기 실험 → 개선 확인” 도구입니다</h2>
        <p className="muted">
          자동으로 승률을 올려주는 서비스가 아니라, 최근 경기 로그에서 문제를 찾고 한 번에 하나씩 검증하도록 도와주는 개인 코치입니다.
        </p>
        <div className="button-row">
          <button className="btn" onClick={onStartSearch}>
            닉네임 입력하고 시작
          </button>
          {hasActions && (
            <button className="btn secondary" onClick={onOpenActions}>
              전술 코칭 보기
            </button>
          )}
          {hasExperiment && (
            <button className="btn secondary" onClick={onOpenTracking}>
              진행 중 실험 보기
            </button>
          )}
        </div>
      </article>

      <article className="panel">
        <h3 className="section-title">가장 중요한 사용 흐름</h3>
        <div className="guide-step-grid">
          {experimentSteps.map((step) => (
            <div className="guide-step-card" key={step.title}>
              <div className="guide-title">{step.title}</div>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3 className="section-title">실험이 헷갈리는 이유</h3>
        <div className="guide-tips">
          <div className="guide-card">
            <div className="guide-title">자동 완료가 아닙니다</div>
            <p>실험 시작 후 실제로 플레이한 경기만 적용 후 데이터가 됩니다.</p>
          </div>
          <div className="guide-card">
            <div className="guide-title">다시 진단해야 합니다</div>
            <p>새 경기를 한 뒤 빠른 시작을 다시 눌러야 최신 경기 로그가 반영됩니다.</p>
          </div>
          <div className="guide-card">
            <div className="guide-title">한 번에 하나만 바꿉니다</div>
            <p>여러 전술을 동시에 바꾸면 어떤 변화가 효과였는지 해석하기 어렵습니다.</p>
          </div>
        </div>
      </article>

      <article className="panel guide-note">
        <h3 className="section-title">추천 사용 예시</h3>
        <ol className="list compact">
          <li>오늘 전술 코칭에서 액션 #1을 채택합니다.</li>
          <li>추천된 전술값을 경기 시작 전에 적용합니다.</li>
          <li>친선 또는 공식 중 같은 모드로 5경기를 진행합니다.</li>
          <li>다시 FCOACH에서 빠른 시작을 눌러 최신 경기를 동기화합니다.</li>
          <li>개선 추적에서 평가를 갱신하고, 유지/전환 여부를 확인합니다.</li>
        </ol>
      </article>
    </section>
  );
}
