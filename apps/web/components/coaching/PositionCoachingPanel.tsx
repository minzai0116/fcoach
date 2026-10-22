"use client";

import { useState, type ReactNode } from "react";
import type { PositionCoaching } from "../../types/coaching";
import type { AnalysisPayload, PlayerReportEntry } from "../../types/analysis";
import { AllMetricsCoachingPanel } from "./AllMetricsCoachingPanel";
import { MatchReviewPanel } from "./MatchReviewPanel";
import { PlayerPitch } from "./PlayerPitch";
import { SquadFeedSettings } from "./SquadFeedSettings";
import { FeedPlanCard } from "./FeedPlanCard";

export function PositionCoachingPanel({ coaching, reportPlayers, renderReport, analysis }: { coaching?: PositionCoaching | null; reportPlayers?: PlayerReportEntry[]; renderReport?: () => ReactNode; analysis?: AnalysisPayload | null }) {
  const [view, setView] = useState("players");
  if (!coaching) return <article className="panel"><p>검색/설정에서 먼저 경기 진단을 실행하세요.</p></article>;
  const feed = coaching.squad_feed?.status === "available" ? coaching.squad_feed : undefined;
  return <article className="panel position-coaching-panel" data-view={view}>
    <div className="analysis-heading"><h3 className="section-title">경기 분석</h3><details className="analysis-info"><summary>ⓘ 분석 안내</summary><div>
      <p>피드의 저장 위치와 경기 기록의 등록 포지션을 구분합니다. 피드는 현재 저장된 설정이며, 과거 경기에서 같은 설정을 썼는지와 경기 중 이동·특성 발동 여부는 확인되지 않습니다.</p>
      <p>{coaching.reference_note}</p><p>팀 지표는 성공 합계 ÷ 시도 합계로 계산합니다. 점유율·평점은 경기별 값의 평균입니다. 누락·모순 수치는 제외하고 시도 0회는 0%로 표시하지 않습니다.</p>
      {coaching.comparison_scope && <p>현재 정상 종료 {coaching.comparison_scope.current.matches}경기 · 이전 정상 종료 {coaching.comparison_scope.previous.matches}경기 ({coaching.comparison_scope.previous.from?.slice(0, 10) ?? "—"} ~ {coaching.comparison_scope.previous.to?.slice(0, 10) ?? "—"}). 성공률은 성공 합계 ÷ 시도 합계로 계산합니다.</p>}
    </div></details></div>
    {coaching.comparison_scope && <p className="comparison-scope">현재 정상 종료 {coaching.comparison_scope.current.matches}경기{coaching.comparison_scope.previous.matches > 0 ? ` · 이전 ${coaching.comparison_scope.previous.matches}경기와 비교` : ""}</p>}
    <nav className={`analysis-section-nav${renderReport ? " has-report" : ""}${analysis ? " has-matches" : ""}`} aria-label="경기 분석 보기">{[["players", "선수 분석", "선수별 기록과 코칭"], ["team", "팀 기록", "패스 · 슈팅 · 수비"], ["tactics", "팀 전술", "전술 설정과 교정"], ...(renderReport ? [["report", "선수 성과", "전체 성과표 · 콤비"]] : []), ...(analysis ? [["matches", "경기별 분석", "상대 순위 · 한 경기 비교"]] : [])].map(([key, label, hint]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}><strong>{label}</strong><span>{hint}</span></button>)}</nav>
    <div className="analysis-view-body">
    {view === "players" && <PlayerPitch coaching={coaching} reportPlayers={reportPlayers} />}
    {view === "team" && <AllMetricsCoachingPanel coaching={coaching} />}
    {view === "report" && renderReport?.()}
    {view === "matches" && analysis && <MatchReviewPanel key={`${analysis.ouid}:${analysis.created_at}`} analysis={analysis} />}
    {view === "tactics" && (feed ? <section className="team-tactics-view"><div className="coaching-section-heading"><h4>{feed.snapshot.title}</h4><span className="coaching-badge">{feed.snapshot.formation}</span></div>
      {(feed.mode_status !== "matched" || feed.author_status !== "matched") && <p className="notice warn">피드 작성자 또는 경기 모드가 달라 설정을 코칭에 연결하지 않았습니다.</p>}
      {feed.team_plans?.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
      <h5>저장된 팀 전술</h5><SquadFeedSettings snapshot={feed.snapshot} teamOnly />
      <a href={feed.snapshot.source_url} target="_blank" rel="noreferrer">공식 피드 확인 ↗</a>
    </section> : <p className="notice">검색/설정에서 공개 피드를 연결하면 팀 전술을 확인할 수 있습니다.</p>)}
    </div>
  </article>;
}
