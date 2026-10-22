type Anchor = { key: string; left: number; top: number };
export type PitchCardLayout = {
  compact: boolean; cardWidth: number; cardHeight: number; photoSize: number;
  fontSize: number; badgeHeight: number; positions: Record<string, { x: number; y: number }>;
};

export function layoutPitchCards(players: Anchor[], width: number, height: number, mobile = false): PitchCardLayout {
  const compact = mobile || width < 560;
  const rows: Anchor[][] = [];
  for (const player of [...players].sort((a, b) => a.top - b.top)) {
    const row = rows.at(-1);
    if (row && player.top - row[0].top < 5) row.push(player);
    else rows.push([player]);
  }
  const inset = 6, gap = 4;
  const columns = Math.max(1, ...rows.map(row => row.length));
  const rowHeight = (height - inset * 2) / Math.max(1, rows.length);
  const cardWidth = Math.min(compact ? 84 : 144, (width - inset * 2 - gap * (columns - 1)) / columns);
  const fontSize = compact ? (cardWidth < 68 ? 10 : 11) : (cardWidth < 120 ? 12 : 13);
  const badgeHeight = compact ? 14 : 17;
  const captionHeight = badgeHeight + fontSize * 1.2 + 2;
  const photoSize = Math.max(20, Math.min(compact ? 46 : 60, rowHeight - captionHeight - gap - 4));
  const cardHeight = photoSize + captionHeight + 4;
  const positions: PitchCardLayout["positions"] = {};
  rows.forEach((row, index) => {
    row.sort((a, b) => a.left - b.left);
    const min = inset + cardWidth / 2, max = width - min;
    const desired = row.map(player => Math.max(min, Math.min(max, player.left / 100 * width)));
    const centers = desired.map((x, i) => Math.max(x, min + i * (cardWidth + gap)));
    for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + cardWidth + gap);
    // 사진과 정보를 함께 배치하고, 좌우 순서를 유지하면서 행 전체의 쏠림을 줄인다.
    const offset = Math.max(centers.at(-1)! - max, Math.min(centers[0] - min,
      centers.reduce((sum, x, i) => sum + x - desired[i], 0) / centers.length));
    row.forEach((player, i) => { positions[player.key] = { x: centers[i] - offset, y: inset + rowHeight * (index + .5) }; });
  });
  return { compact, cardWidth, cardHeight, photoSize, fontSize, badgeHeight, positions };
}
