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
    title: "1. 진단",
    body: "닉네임과 경기 기준을 고르고 최근 경기 문제를 확인합니다.",
  },
  {
    title: "2. 코칭 선택",
    body: "전술 코칭에서 가장 납득되는 추천 1개로 실험을 시작합니다.",
  },
  {
    title: "3. 같은 전술로 플레이",
    body: "같은 모드에서 추천 전술을 유지하고 최소 3경기, 가능하면 5경기 이상 플레이합니다.",
  },
  {
    title: "4. 다시 진단/평가",
    body: "플레이 후 빠른 시작을 다시 누르고 개선 추적에서 적용 전/후를 비교합니다.",
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
        <h2 className="section-title">FCOACH는 “진단 → 전술 실험 → 개선 확인” 도구입니다</h2>
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

      <article className="panel guide-flow-panel">
        <h3 className="section-title">이렇게 사용하세요</h3>
        <div className="guide-step-grid">
          {experimentSteps.map((step) => (
            <div className="guide-step-card" key={step.title}>
              <div className="guide-title">{step.title}</div>
              <p>{step.body}</p>
            </div>
          ))}
        </div>
        <p className="guide-mini-note">
          전술은 한 번에 하나만 바꾸세요. 1~2경기는 참고용, 3~4경기는 초기 신호, 5경기 이상이면 더 안정적으로 해석합니다.
        </p>
      </article>
    </section>
  );
}
