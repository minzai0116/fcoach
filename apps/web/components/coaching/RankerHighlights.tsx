import type { RankerCoaching } from "../../types/comparison";
import { MetricComparisonCards } from "./MetricComparisonCards";
import { ComparisonFindingGroups } from "./ComparisonFindingGroups";

export function RankerHighlights({ data, group }: { data?: RankerCoaching; group?: string }) {
  const findings = group ? data?.by_group?.[group] : data;
  if (!data || !findings || (!findings.strengths.length && !findings.weaknesses.length)) return null;
  return <section className="ranker-highlights" aria-label="랭커 대비 강점과 보완점"><div className="coaching-section-heading"><h3>랭커 대비 강점·보완점</h3><span className="comparison-sample">랭커 {data.ranker_count}명 평균</span></div>
    <ComparisonFindingGroups referenceLabel="랭커 평균" groups={[
      { title: "강점 지표", tone: "better", metrics: findings.strengths.slice(0, 2).map(finding => ({ mine: finding.mine, reference: finding.reference })) },
      { title: "보완 지표", tone: "worse", metrics: findings.weaknesses.slice(0, 2).map(finding => ({ mine: finding.mine, reference: finding.reference })) },
    ]} />
  </section>;
}
export function RankerAdvicePanel({ data }: { data?: RankerCoaching }) {
  if (!data || !data.advice.length) return <RankerHighlights data={data} />;
  return <section className="ranker-advice-panel" aria-label="랭커 평균을 반영한 맞춤 코칭">
    <RankerHighlights data={data} />
    <div className="ranker-advice-grid">{data.advice.map((item, index) => <article key={item.metric_id} className="ranker-advice-card"><header><span>우선 {index + 1}</span><h3>{item.title}</h3></header>
      <MetricComparisonCards compact referenceLabel="랭커 평균" tone="purple" metrics={[{ mine: item.comparison.mine, reference: item.comparison.reference }]} />
      {item.context && <p className="ranker-context">{item.context}</p>}
      {!!item.players.length && <div className="ranker-focus-players"><h4>먼저 확인할 자리</h4>{item.players.map(player => <div key={`${player.position}:${player.name}`}><strong>{player.position} · {player.name}</strong><span>전체 {player.label} · {player.success}/{player.trials}회 · 실패 {player.trials - player.success}회</span></div>)}</div>}
      <section><h4>바꿔 볼 플레이</h4><p>{item.play}</p></section><section><h4>전술·역할 제안</h4>{item.setting && <span className="saved-setting">피드 저장값 · {item.setting.label} {item.setting.value}</span>}<p>{item.tactic}</p></section>

    </article>)}</div>
  </section>;
}
