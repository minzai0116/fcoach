"use client";

import { useState } from "react";
import type { FeedCheck, FeedComparison, SquadFeedCoaching } from "../../types/squadFeed";
import { formatPercent, PercentageBar } from "./CoachingVisuals";
import { FeedPlayerSettings, SquadFeedSettings } from "./SquadFeedSettings";
import { FeedPlanCard, PLAN_STATUS } from "./FeedPlanCard";

function Check({ check }: { check: FeedCheck }) {
  return <div className="feed-check"><div className="coaching-section-heading"><strong>{check.label}</strong><b>{formatPercent(check.value)}</b></div>
    <PercentageBar value={check.value} /><small>{check.success}/{check.trials}회 · {check.setting_available ? "저장 설정과 함께 관찰" : "설정 확인 보류"}</small>
</div>;
}

function Record({ record }: { record: FeedComparison }) {
  return <details className="feed-record"><summary><span><strong>{record.position_name} · {record.player_name} +{record.sp_grade}</strong><small>해당 자리 {record.appearances}경기</small>{record.plans?.[0] && <small>{record.plans[0].title}</small>}</span><span className={`coaching-badge ${record.linked ? "feed-matched" : "muted-badge"}`}>{record.label}</span></summary>
    <div className="feed-record-content">
      {!record.linked && <><p>{record.status === "matched" ? "선수 기록은 같지만 작성자 또는 경기 모드를 확인할 수 없어 설정을 코칭에 연결하지 않았습니다." : "이 피드의 설정을 해당 선수의 경기 원인으로 사용하지 않았습니다."}</p>
        {record.candidates.map((candidate, index) => <p className="coaching-scope-note" key={index}>피드: {candidate.position ?? "자리 미제공"} · {candidate.name} +{candidate.grade ?? "강화 미제공"}</p>)}</>}
      {record.settings && <>
        {record.plans?.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
        {!record.plans?.length && <p className="coaching-scope-note">이전 분석의 관찰 기록입니다. 다시 진단하면 설정을 함께 해석한 교정 후보를 볼 수 있습니다.</p>}
        <details className="detail-block"><summary>저장 설정·전체 경기 지표 보기</summary>
          <FeedPlayerSettings player={record.settings} />
          <p className="coaching-scope-note">특성·코치 그림을 누르면 이름이 표시됩니다.</p>
          {record.checks.map(check => <Check key={check.metric} check={check} />)}
        </details>
      </>}
    </div>
  </details>;
}

export function FeedConnectionSummary({ context, onOpen }: { context?: SquadFeedCoaching; onOpen: () => void }) {
  if (!context) return null;
  const first = context.status === "available" ? context.priorities?.[0] : null;
  return <article className="panel span-3 feed-connection-summary"><div><strong>{context.status === "available" ? `연결한 공개 스쿼드 · ${context.snapshot.title}` : "공개 피드 연결 보류"}</strong>
    <p className="coaching-scope-note">{context.status === "available" ? `${context.summary.record_count}개 선수·자리 기록 중 ${context.summary.linked}개 설정 연결 · 과거 사용 여부 미확인` : context.message}</p>
    {first && <p><strong>{first.position_name} · {first.player_name}</strong> — {first.plan.title}<br />{first.plan.actions[0]?.label}</p>}
    </div><button className="btn secondary" onClick={onOpen}>피드 연결 코칭 보기</button></article>;
}

export function FeedCoachingPanel({ context, hidePlayerRecords = false }: { context?: SquadFeedCoaching; hidePlayerRecords?: boolean }) {
  const [view, setView] = useState("linked");
  const [showAll, setShowAll] = useState(false);
  if (!context) return null;
  if (context.status === "unavailable") return <section className="squad-feed-coaching"><h4>공개 피드 연결 보류</h4><p role="alert">{context.message}</p><p className="coaching-scope-note">이전 피드 설정을 대신 사용하지 않았습니다. 경기 기록 분석은 계속 제공됩니다. 검색/설정에서 선택을 바꾸거나 다시 진단하세요.</p></section>;
  const { snapshot, summary } = context;
  const currentView = summary.linked === 0 && view === "linked" ? "differences" : view;
  const records = context.comparisons.filter(record => currentView === "linked" ? record.linked : !record.linked);
  return <section className="squad-feed-coaching" aria-label="공개 피드 연결 코칭">
    <div className="coaching-section-heading"><div><span className="coaching-eyebrow">공개 피드의 저장 설정</span><h4>{snapshot.title}</h4></div><span className="coaching-scope">{snapshot.formation}</span></div>
    <p className="coaching-scope-note">{snapshot.author} · {snapshot.mode === 1 ? "1vs1" : snapshot.mode === 2 ? "감독 모드" : "모드 미제공"} · 생성 {snapshot.created_at?.slice(0, 10) ?? "날짜 미제공"} · 조회 {new Date(snapshot.fetched_at).toLocaleString("ko-KR")}</p>
    <p className="feed-reference-note">저장 피드 참고 · 과거 경기에서의 사용 여부 미확인</p>
    {context.mode_status !== "matched" && <p className="notice error" role="status">{context.mode_status === "mismatch" ? "피드의 활용 모드가 분석 경기 모드와 다릅니다." : "피드의 활용 모드를 확인할 수 없습니다."} 선수별 설정 연결을 보류했습니다.</p>}
    {context.author_status !== "matched" && <p className="notice error" role="status">{context.author_status === "mismatch" ? "피드 작성자와 경기 기록의 닉네임이 다릅니다." : "경기 기록에서 피드 작성자와 같은 닉네임인지 확인되지 않았습니다."} 선수별 설정 연결을 보류했습니다.</p>}
    {!summary.record_count && <p className="notice">선택한 분석 조건에서 대조할 선수 기록이 없습니다. 피드 설정만 참고할 수 있습니다.</p>}
    <div className="feed-match-stats"><div><small>설정 연결</small><strong>{summary.linked}<em>개</em></strong></div><div><small>차이·정보 부족</small><strong>{summary.different}<em>개</em></strong></div><div><small>피드에 없는 기록</small><strong>{summary.not_in_feed}<em>개</em></strong></div></div>
    {summary.withheld > 0 && <p className="coaching-scope-note">카드·강화·자리는 같지만 모드·작성자 확인 때문에 보류한 기록 {summary.withheld}개</p>}
    <p className="coaching-scope-note">같은 선수도 자리·강화가 다르면 별도 기록으로 셉니다. {context.note}</p>
    {!hidePlayerRecords && !!context.priorities?.length && <section className="feed-priority-plans" aria-label="자리별 우선 코칭">
      <h5>어느 자리부터 무엇을 바꿀까?</h5>
      <p className="coaching-scope-note">한 번에 한 가지를 시험하세요. 현재 설정과 경기 기록으로 만든 교정 후보이며, 바꾸면 좋아진다는 보장은 아닙니다.</p>
      {context.priorities.map((item, index) => <details className="feed-priority-record" key={`${item.sp_id}:${item.position_name}`} open={index === 0}>
        <summary><span><strong>{item.position_name} · {item.player_name}</strong><small>{item.plan.title}</small></span><span className="coaching-badge">{PLAN_STATUS[item.plan.status]}</span></summary>
        <FeedPlanCard plan={item.plan} />
      </details>)}
    </section>}
    {!!context.team_plans?.length && <details className="detail-block"><summary>팀 전술 교정 후보 · 선발 11명·자리 일치 {context.matched_roster_sample_count}경기 기준</summary>
      {context.team_plans.map(plan => <FeedPlanCard key={plan.id} plan={plan} />)}
    </details>}
    {!hidePlayerRecords && <><div className="coaching-view-toggle feed-view-toggle" aria-label="피드 연결 보기">
      <button type="button" aria-pressed={currentView === "linked"} disabled={!summary.linked} onClick={() => { setView("linked"); setShowAll(false); }}>연결된 기록 {summary.linked}</button>
      <button type="button" aria-pressed={currentView === "differences"} onClick={() => { setView("differences"); setShowAll(false); }}>차이·미연결 {summary.record_count - summary.linked}</button>
      <button type="button" aria-pressed={currentView === "settings"} onClick={() => setView("settings")}>피드 설정</button>
    </div>
    {currentView === "settings" ? <SquadFeedSettings snapshot={snapshot} /> : <div className="feed-record-list">
      {(showAll ? records : records.slice(0, 8)).map(record => <Record key={`${record.sp_id}:${record.sp_grade}:${record.sp_position}`} record={record} />)}
      {!records.length && <p className="coaching-scope-note">이 항목에 해당하는 기록이 없습니다.</p>}
      {records.length > 8 && <button className="btn secondary" onClick={() => setShowAll(value => !value)}>{showAll ? "접기" : `나머지 ${records.length - 8}개 보기`}</button>}
    </div>}</>}

    <details className="detail-block"><summary>피드에만 있는 선수와 출처 확인</summary><p className="coaching-scope-note">경기 표본의 같은 카드·강화·자리에서 확인되지 않은 피드 선수: {context.feed_only_players.map(p => `${p.position ?? "자리 미제공"} ${p.name} +${p.grade ?? "?"}`).join(" · ") || "없음"}</p><p className="coaching-scope-note">생성일은 최종 수정일이 아닙니다. 기본 전술을 누락 값에 대신 채우지 않으며, 해석되지 않는 코드는 그대로 표시합니다. 이름 표기 기준일 {snapshot.label_version}.</p><a href={snapshot.source_url} target="_blank" rel="noreferrer">공식 공개 피드에서 확인</a></details>
  </section>;
}
