type Tier = { status: string; name: string | null; as_of: string | null; icon_url?: string | null };
export type UserDivisions = { current: Tier; highest: Tier };

export function currentTierLabel(tier?: Tier) {
  return tier?.status === "no_current_season_match" ? "경기 기록 없음" : tier?.name ?? "확인 안 됨";
}

export function tierDateLabel(value?: string | null, includeYear = false) {
  if (!value) return "";
  const date = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: includeYear ? "numeric" : undefined, month: "numeric", day: "numeric" });
}
