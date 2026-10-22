import type { PlayerGuidance } from "../../types/coaching";

export function PlayerCoachingSummary({ guidance }: { guidance?: PlayerGuidance }) {
  if (!guidance) return <p>경기 진단을 다시 실행하면 현재 기록에 맞춘 코칭을 볼 수 있습니다.</p>;
  return <div className="player-guidance">
    {!!guidance.strengths.length && <section className="guidance-strengths"><h5>좋았던 점 · 이전 경기 대비</h5>{guidance.strengths.map(item => <div key={item.title}><strong>{item.title}</strong><p>{item.evidence}</p></div>)}</section>}
    {!!guidance.improvements.length && <section className="guidance-improvements"><h5>개선할 점 · 이전 경기 대비</h5>{guidance.improvements.map(item => <div key={item.title}><strong>{item.title}</strong><p>{item.evidence}</p></div>)}</section>}
    {!guidance.strengths.length && !guidance.improvements.length && <section className="guidance-records"><h5>현재 경기에서 확인한 기록</h5>{guidance.observations.map(item => <p key={item}>{item}</p>)}</section>}
    <section className="guidance-actions"><h5>이렇게 플레이하세요</h5>{guidance.recommendations.map((item, index) => <article key={`${item.kind}:${index}`}><span className="guidance-kind">{item.kind === "play" ? "플레이" : item.kind === "coach" ? "훈련코치" : "설정"}</span><strong>{item.title}</strong><p>{item.description}</p><details className="guidance-basis"><summary>근거</summary><p>{item.basis}</p></details></article>)}</section>
  </div>;
}
