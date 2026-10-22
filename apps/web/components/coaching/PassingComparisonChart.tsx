import type { PassingCoaching } from "../../types/coaching";
import { formatPercent, PercentageBar } from "./CoachingVisuals";

export function PassingComparisonChart({ passing, selected, mode, onSelect }: {
  passing: PassingCoaching;
  selected: string;
  mode: "share" | "success";
  onSelect: (metric: string) => void;
}) {
  const priorities = new Map(passing.priorities.map((item, index) => [item.metric, index + 1]));
  return (
    <div className="passing-chart" aria-label={mode === "share" ? "패스 유형별 사용 비중과 실패 비중 비교" : "패스 유형별 성공률 비교"}>
      <div className="passing-chart-legend">
        <span><i className="blue" />{mode === "share" ? "전체 시도 중 비중" : "해당 유형 성공률"}</span>
        {mode === "share" && <span><i className="amber" />전체 실패 중 비중</span>}
      </div>
      <div className="passing-chart-scale"><span>0%</span><span>50%</span><span>100%</span></div>
      {passing.types.map((item) => {
        const rank = priorities.get(item.metric);
        const value = mode === "share" ? item.usage_share : item.success_rate;
        return (
          <button className={`passing-chart-row${selected === item.metric ? " selected" : ""}`} key={item.metric} aria-pressed={selected === item.metric} aria-label={`${item.label}, ${item.trials}회 시도, ${mode === "share" ? `사용 비중 ${formatPercent(value)}, 전체 실패 중 비중 ${formatPercent(item.failure_share)}` : `성공률 ${formatPercent(value)}`}${rank ? `, 점검 ${rank}` : ""}`} onClick={() => onSelect(item.metric)}>
            <span className="passing-chart-label"><strong>{item.label}</strong><small>{item.trials}회 시도</small>
              {!!rank && <span className="coaching-badge">점검 {rank}</span>}
            </span>
            <span className="passing-chart-bars">
              <span className="passing-chart-line"><PercentageBar value={value} /><b>{formatPercent(value)}</b></span>
              {mode === "share" && <span className="passing-chart-line"><PercentageBar value={item.failure_share} tone="amber" /><b>{formatPercent(item.failure_share)}</b></span>}
            </span>
          </button>
        );
      })}
      <p className="passing-chart-caption">막대는 모두 0~100% 척도입니다. 유형을 누르면 아래 카드가 바뀝니다.</p>
    </div>
  );
}
