"use client";
import { useEffect, useRef, useState } from "react";
import type { DomainScores } from "../../types/comparison";
import { differenceTone } from "../../lib/comparisonInsights";
import { scorePoint } from "../../lib/domainScoreDisplay";
import { DomainScoreDetails } from "./DomainScoreDetails";
import { ShareImageButton } from "../share/ShareImageButton";
import type { ShareImageInput } from "../../lib/shareImage";

export function DomainScorePanel({ data, share }: { data?: DomainScores; share?: Omit<Extract<ShareImageInput, {kind: "score"}>, "kind" | "scores"> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (selected === null) trigger.current?.focus(); }, [selected]);
  if (!data || data.method !== "ranker_usage_weighted_p90_v6" || !data.areas.some(area => area.mine !== null)) return null;
  const area = data.areas.find(item => item.id === selected);
  return <section className="domain-score-panel span-3" aria-label="경기 지표 점수">
    <header><h3>경기 지표 점수</h3><span>랭커 상위 10% = 100점</span>{share && <ShareImageButton input={{ ...share, kind: "score", scores: data }} label="성적표 저장" />}</header>
    {data.scope && <div className="score-scope"><span>{[["공식", data.scope.official_matches], ["친선", data.scope.friendly_matches]].filter(([, count]) => Number(count) > 0).map(([label, count]) => `${label} ${count}경기`).join(" · ")}</span><span>횟수 점수 · 정상 종료 {data.scope.completed_matches}경기</span><span>기록 비교 점수 · 티어와 별개</span></div>}
    <div className="domain-score-grid">{data.areas.map(area => {
      const rounded = area.mine == null ? null : Math.round(area.mine);
      const reference = area.reference == null ? null : Math.round(area.reference);
      const tone = differenceTone(rounded, reference, "higher");
      return <button key={area.id} type="button" disabled={area.mine === null} aria-haspopup="dialog" aria-label={`${area.label} ${scorePoint(area.mine)}점 세부 지표 보기`} onClick={event => { trigger.current = event.currentTarget; setSelected(area.id); }}>
        <h4>{area.label}<span aria-hidden="true">›</span></h4>
        <div className="domain-score-values"><div><span className="score-placeholder" aria-hidden="true"> </span><strong className={`tone-${tone}`}>{scorePoint(area.mine)}</strong></div><div><span>랭커 평균</span><b>{scorePoint(area.reference)}</b></div></div>
        <div className="domain-score-bars" aria-hidden="true"><div>{area.mine != null && <i className={`score-mine score-${tone}`} style={{width:`${area.mine}%`}} />}</div><div>{area.reference != null && <i className="score-reference" style={{width:`${area.reference}%`}} />}</div></div>
      </button>;
    })}</div>
    {area && <DomainScoreDetails key={area.id} area={area} areas={data.areas} onSelect={setSelected} onClose={() => setSelected(null)} />}
  </section>;
}
