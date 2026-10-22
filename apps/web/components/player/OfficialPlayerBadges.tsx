export function OfficialPlayerBadges({ seasonImg, seasonName, grade }: { seasonImg?: string; seasonName?: string; grade: number | null }) {
  const tone = grade == null ? "unknown" : grade >= 11 ? "platinum" : grade >= 8 ? "gold" : grade >= 5 ? "silver" : grade >= 2 ? "bronze" : "base";
  return <span className="official-player-badges">
    {seasonImg && <img src={seasonImg} alt={`${seasonName || "선수"} 시즌`} title={seasonName} loading="lazy" />}
    <span className={`official-enhancement ${tone}`} aria-label={grade == null ? "강화 정보 미제공" : `${grade}강`} title={grade == null ? "강화 정보 미제공" : `${grade}강`}>{grade ?? "?"}</span>
  </span>;
}
