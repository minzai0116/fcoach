import type { AvailableFeedCoaching, FeedFeature, FeedPlayer } from "../types/squadFeed";

export function feedTraitResolver(feed?: AvailableFeedCoaching) {
  const byGrade = new Map<string, FeedPlayer | null>(), byCard = new Map<number, FeedPlayer | null>();
  if (feed?.author_status === "matched" && feed.mode_status === "matched") {
    for (const player of feed.snapshot.players) {
      const key = `${player.sp_id}:${player.grade}`;
      byGrade.set(key, byGrade.has(key) ? null : player);
      byCard.set(player.sp_id, byCard.has(player.sp_id) ? null : player);
    }
  }
  // 포지션은 특성 표시 조건에서 제외한다. 다른 강화의 저장값은 UI에서 출처를 표시한다.
  return (spId: number, grade: number | null) => byGrade.get(`${spId}:${grade}`) ?? byCard.get(spId) ?? undefined;
}

export function traitSourceLabel(source: FeedPlayer | undefined, grade: number | null): string {
  return !source || source.grade === grade ? "" : source.grade == null ? "피드" : `피드 ${source.grade}강`;
}

export function savedPlayerSettings(source: FeedPlayer | undefined, spId: number, position: string): FeedPlayer | undefined {
  return source?.sp_id === spId && source.position === position ? source : undefined;
}

// 공식 스쿼드 피드의 신규 특성 코드만 사용하며, 미확인 코드는 포함하지 않는다.
const NEW_TRAIT_CODES = new Set([50, 51, 52, 53, 54, 55, 56, 57, 59, 60, 62, 63, 64, 65, 66, 67, 68]);

export function newPlayerTraits(player?: FeedPlayer): FeedFeature[] {
  const result: FeedFeature[] = [], seen = new Set<number>();
  for (const source of [player?.intrinsic_features, player?.acquired_traits]) {
    if (source?.status !== "present") continue;
    for (const feature of source.value ?? []) {
      if (feature.code == null || !feature.known || !feature.icon_url || !NEW_TRAIT_CODES.has(feature.code) || seen.has(feature.code)) continue;
      seen.add(feature.code);
      result.push(feature);
      if (result.length === 2) return result;
    }
  }
  return result;
}
