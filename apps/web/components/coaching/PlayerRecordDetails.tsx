import type { PositionFinding, PositionPlayer } from "../../types/coaching";
import { metres } from "../../lib/footballDisplay";
import { formatPercent, PercentageBar } from "./CoachingVisuals";

const OBSERVATIONS: Record<string, [string, string]> = {
  goals: ["득점", "골"], assists: ["도움", "회"], intercept: ["인터셉트", "회"],
  defending_actions: ["골 차단", "회"], dribble_distance: ["드리블 거리", "m"],
  yellow_cards: ["옐로카드", "회"], red_cards: ["레드카드", "회"], rating: ["평점", "점"],
};

function Finding({ finding, observation }: { finding: PositionFinding; observation: boolean }) {
  return (
    <div className="position-finding">
      <div className="coaching-section-heading"><strong>{finding.label}</strong><span className="coaching-badge">이전 기록 대비 하락</span></div>
      <div className="position-goal-stats"><div><small>현재 정상 종료 {finding.comparison?.current.matches}경기</small><strong>{formatPercent(finding.current)}</strong><small>{finding.comparison?.current.success}/{finding.comparison?.current.trials}회</small></div><div><small>이전 정상 종료 {finding.comparison?.previous.matches}경기</small><strong>{formatPercent(finding.reference)}</strong><small>{finding.comparison?.previous.success}/{finding.comparison?.previous.trials}회</small></div></div>
      <PercentageBar value={finding.current} reference={finding.reference} />

      <div className="position-adjustment">
        <strong>{observation ? "자동 경기 설정 제안" : "플레이 개선 제안"}</strong>
        <p>{finding.adjustment}</p>
      </div>
      <div className="coaching-recheck"><span className="coaching-step-number">↻</span><div><strong>같은 선수·같은 자리로 5경기 이상</strong><small>성공률과 시도 수를 함께 비교</small></div></div>
      <details className="detail-block"><summary>비교 근거와 확인 방법</summary><p>{finding.evidence}</p><p className="muted">{finding.hypothesis}</p><p className="muted">{finding.verification}</p></details>
    </div>
  );
}

type Measurement = PositionPlayer["measurements"][number];

function MeasurementCard({ metric }: { metric: Measurement }) {
  const prior = metric.comparison?.previous;
  return <div className="player-metric-card"><dt>{metric.label}</dt>
    <dd>{formatPercent(metric.value)}</dd><span className="metric-count">{metric.success}/{metric.trials}회 성공</span>
    <PercentageBar value={metric.value} />
    {prior?.value != null && <small>이전 {formatPercent(prior.value)} · {prior.success}/{prior.trials}회</small>}
  </div>;
}

function KeeperCard({ metric }: { metric: NonNullable<PositionPlayer["goalkeeper_metrics"]>[number] }) {
  const { current, previous } = metric;
  const display = (value: number | null) => value === null ? "—" : value.toFixed(metric.metric === "clean_sheets" ? 0 : 1);
  return <div className="player-metric-card keeper-metric"><dt>{metric.label}</dt>
    <dd>{display(current.value)}<em>{metric.unit}</em></dd>
    <span className="metric-count">{current.matches ? metric.metric === "rating" ? `${current.matches}경기 평균` : `${current.matches}경기 · 합계 ${current.total}${metric.unit}` : "제공된 기록 없음"}</span>
    {previous.value !== null && <small>이전 {display(previous.value)}{metric.unit} · {previous.matches}경기</small>}
  </div>;
}

export function PlayerRecordDetails({ player, observation }: { player: PositionPlayer; observation: boolean }) {
  const keeper = player.sp_position === 0;
  const preferred = keeper ? ["pass"] : /^(GK|LB|RB|LWB|RWB|LCB|RCB|CB|SW)$/.test(player.position_name)
    ? ["tackle", "pass", "block", "aerial"] : /^(ST|LS|RS|CF|LF|RF|LW|RW)$/.test(player.position_name)
      ? ["shot", "finishing", "pass", "ball_possession"] : ["pass", "ball_possession", "dribble", "tackle"];
  const byMetric = new Map(player.measurements.map(metric => [metric.metric, metric]));
  const main = preferred.flatMap(key => byMetric.has(key) ? [byMetric.get(key)!] : []);
  const other = player.measurements.filter(metric => !preferred.includes(metric.metric));
  const findings = player.findings.filter(finding => finding.comparison?.source === "own_history" && finding.comparison.status === "lower");
  const keeperMain = player.goalkeeper_metrics?.filter(metric => metric.metric !== "clean_sheets") ?? [];
  return <div className="position-coaching-content compact-records">
    <dl className="position-measurements">
      {keeper && keeperMain.slice(0, 1).map(metric => <KeeperCard key={metric.metric} metric={metric} />)}
      {main.map(metric => <MeasurementCard key={metric.metric} metric={metric} />)}
      {keeper && keeperMain.slice(1).map(metric => <KeeperCard key={metric.metric} metric={metric} />)}
    </dl>
    {findings.length > 0 && <details className="detail-block"><summary>이전 기록 대비 변화 {findings.length}개</summary>{findings.map(finding => <Finding key={finding.metric} finding={finding} observation={observation} />)}</details>}
    <details className="detail-block player-extra-metrics"><summary>{keeper ? "무실점 기록·집계 기준" : "전체 경기 기록"}</summary>
      {!keeper && <><dl className="position-measurements">{other.map(metric => <MeasurementCard key={metric.metric} metric={metric} />)}</dl>
        {!!player.observations?.length && <dl className="position-observations">{player.observations.map(metric => <div key={metric.metric}>
          <dt>{OBSERVATIONS[metric.metric]?.[0] ?? metric.metric}</dt><dd>{(metric.metric === "dribble_distance" ? metres(metric.per_match) : metric.per_match).toFixed(metric.metric === "rating" ? 2 : 1)}{OBSERVATIONS[metric.metric]?.[1]} / 경기</dd>
        </div>)}</dl>}
        {!!player.shot_types?.length && <div className="player-shot-types">{player.shot_types.map(metric => <div key={metric.metric}><strong>{metric.label}</strong><PercentageBar value={metric.conversion} /><small>득점 {metric.goals}/{metric.trials}회 · 유효 {metric.on_target}회</small></div>)}</div>}
      </>}
      {keeper && <><dl className="position-measurements">{player.goalkeeper_metrics?.filter(metric => metric.metric === "clean_sheets").map(metric => <KeeperCard key={metric.metric} metric={metric} />)}</dl>
        <p className="record-method">선방은 공식 선수 기록의 ‘선방(골 차단)’ 횟수입니다. 개인 선방률은 제공된 시도 분모가 없어 계산하지 않습니다. 팀 실점·무실점은 해당 골키퍼가 출전한 정상 종료 경기의 팀 기록입니다.</p>
        <a href="https://fconline.nexon.com/DataCenter/PlayerStat" target="_blank" rel="noreferrer">공식 기록 기준 ↗</a>
      </>}
      <p className="record-method">이전 값은 같은 카드·강화·자리의 앞선 정상 종료 경기 기록입니다. 비교할 근거가 없으면 문제로 판단하지 않습니다.</p>
    </details>
  </div>;
}
