"use client";

import { useState, type ReactNode } from "react";
import type { PositionCoaching } from "../../types/coaching";
import type { PlayerReportEntry } from "../../types/analysis";
import type { RankerCoaching } from "../../types/comparison";
import type { MetricGroup, RankerBenchmark } from "../../types/comparison";
import { PlayerComparisonPanel } from "./PlayerComparisonPanel";
import { AllMetricsCoachingPanel } from "./AllMetricsCoachingPanel";
import { PlayerPitch } from "./PlayerPitch";
import { SquadFeedSettings } from "./SquadFeedSettings";
import { FeedPlanCard } from "./FeedPlanCard";

type PositionCoachingPanelProps = {
  section: "team" | "players";
  rankerCoaching?: RankerCoaching;
  comparisonGroups?: MetricGroup[];
  benchmark?: RankerBenchmark;
  coaching?: PositionCoaching | null;
  reportPlayers?: PlayerReportEntry[];
  renderReport?: () => ReactNode;
  renderOverview?: () => ReactNode;
};

export function PositionCoachingPanel({ section, coaching, reportPlayers, renderReport, renderOverview, rankerCoaching, comparisonGroups, benchmark }: PositionCoachingPanelProps) {
  const [view, setView] = useState(section === "team" ? "overview" : "players");
  if (!coaching) return <article className="panel"><p>경기 검색에서 먼저 경기 분석을 시작하세요.</p></article>;
  const views = section === "team"
    ? [["overview", "요약"], ["team", "세부 지표"], ["tactics", "저장된 전술"]]
    : [["players", "포메이션"], ["compare", "선수 비교"], ...(renderReport ? [["report", "선수 성과"]] : [])];
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  return <article className="panel position-coaching-panel" data-view={view}>
    <div className="analysis-heading"><h3 className="section-title">{section === "team" ? "팀 분석" : "선수 분석"}</h3></div>
    {coaching.comparison_scope && <p className="comparison-scope">현재 정상 종료 {coaching.comparison_scope.current.matches}경기{coaching.comparison_scope.previous.matches > 0 ? ` · 이전 ${coaching.comparison_scope.previous.matches}경기와 비교` : ""}</p>}
    <nav className="analysis-section-nav" aria-label={section === "team" ? "팀 분석 보기" : "선수 분석 보기"}>{views.map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}><strong>{label}</strong></button>)}</nav>
    <div className="analysis-view-body">
    {view === "overview" && renderOverview?.()}
    {view === "players" && <PlayerPitch coaching={coaching} reportPlayers={reportPlayers} />}
    {view === "compare" && <PlayerComparisonPanel players={coaching.players} reports={reportPlayers} feed={feed} />}
    {view === "team" && <AllMetricsCoachingPanel coaching={coaching} comparisonGroups={comparisonGroups} benchmark={benchmark} rankerCoaching={rankerCoaching} />}
    {view === "report" && renderReport?.()}
    {view === "tactics" && (feed ? <section className="team-tactics-view"><div className="coaching-section-heading"><h4>{feed.snapshot.title}</h4><span className="coaching-badge">{feed.snapshot.formation}</span></div>
      {(feed.mode_status !== "matched" || feed.author_status !== "matched") && <p className="notice warn">피드 작성자 또는 경기 모드가 달라 설정을 코칭에 연결하지 않았습니다.</p>}
      {feed.team_plans?.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
      <h5>저장된 팀 전술</h5><SquadFeedSettings snapshot={feed.snapshot} teamOnly />
      <a href={feed.snapshot.source_url} target="_blank" rel="noreferrer">공식 피드 확인 ↗</a>
    </section> : <p className="notice">경기 검색에서 공개 피드를 연결하면 팀 전술을 확인할 수 있습니다.</p>)}
    </div>
  </article>;
}
