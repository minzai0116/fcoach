type Anchor = { key: string; left: number; top: number; position?: string };
export type PitchCardLayout = {
  compact: boolean; cardWidth: number; cardHeight: number; photoSize: number;
  fontSize: number; badgeHeight: number; positions: Record<string, { x: number; y: number }>;
  traitHeight: number;
};

export function layoutPitchCards(players: Anchor[], width: number, height: number, mobile = false, traits = false): PitchCardLayout {
  const compact = mobile || width < 560;
  const rows: Anchor[][] = [];
  for (const player of [...players].sort((a, b) => a.top - b.top)) {
    const row = rows.at(-1);
    if (row && player.top - row[0].top < 5) row.push(player);
    else rows.push([player]);
  }
  const inset = 6, gap = 4;
  const minColumns = Math.max(1, Math.floor((width - inset * 2 + gap) / 64));
  const desiredRowHeight = compact ? (traits ? 96 : 80) : 100;
  while (rows.length * desiredRowHeight > height - inset * 2) {
    let merge = -1, closest = Infinity;
    for (let i = 0; i < rows.length - 1; i++) {
      const combined = [...rows[i], ...rows[i + 1]];
      const distance = Math.max(...combined.map(player => player.top)) - Math.min(...combined.map(player => player.top));
      if (combined.some(player => (player.position ?? player.key) === "GK") || combined.length > minColumns || distance > 24 ||
          (distance > 12 && rows.length * (traits ? 64 : 50) <= height - inset * 2)) continue;
      if (distance < closest) { merge = i; closest = distance; }
    }
    if (merge < 0) break;
    rows.splice(merge, 2, [...rows[merge], ...rows[merge + 1]]);
  }
  const columns = Math.max(1, ...rows.map(row => row.length));
  const rowHeight = (height - inset * 2) / Math.max(1, rows.length);
  const cardWidth = Math.min(compact ? 84 : 144, (width - inset * 2 - gap * (columns - 1)) / columns);
  const fontSize = compact ? (cardWidth < 68 ? 10 : 11) : (cardWidth < 120 ? 12 : 13);
  const badgeHeight = compact ? 14 : 17;
  const captionHeight = Math.max(badgeHeight, fontSize * 1.2) + 2;
  const traitHeight = traits ? (compact ? 14 : 22) : 0;
  const photoSize = Math.max(32, Math.min(compact ? 58 : 82, rowHeight - captionHeight - traitHeight - gap - 4));
  const cardHeight = photoSize + captionHeight + traitHeight + 4;
  const positions: PitchCardLayout["positions"] = {};
  rows.forEach((row, index) => {
    row.sort((a, b) => a.left - b.left);
    const min = inset + cardWidth / 2, max = width - min;
    const desired = row.map(player => Math.max(min, Math.min(max, player.left / 100 * width)));
    const centers = desired.map((x, i) => Math.max(min + i * (cardWidth + gap),
      Math.min(x, max - (row.length - 1 - i) * (cardWidth + gap))));
    for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + cardWidth + gap);
    const middle = row.reduce((sum, entry) => sum + entry.top, 0) / row.length;
    row.forEach((player, i) => {
      const stagger = Math.max(0, Math.min(3, (rowHeight - cardHeight - 1) / 2));
      positions[player.key] = { x: centers[i], y: inset + rowHeight * (index + .5) + Math.sign(player.top - middle) * stagger };
    });
  });
  return { compact, cardWidth, cardHeight, photoSize, fontSize, badgeHeight, traitHeight, positions };
}
