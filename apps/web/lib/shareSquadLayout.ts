import { layoutPitchPlayers, type PitchPlayer } from "./pitchLineup";

const ROWS: Record<string, number> = {
  LS: 0, RS: 0, ST: 0,
  LW: 1, LWF: 1, LF: 1, CF: 1, RF: 1, RWF: 1, RW: 1,
  LM: 2, LAM: 2, CAM: 2, RAM: 2, RM: 2,
  LCM: 3, CM: 3, RCM: 3,
  LDM: 4, CDM: 4, RDM: 4,
  LB: 5, LWB: 5, LCB: 5, CB: 5, RCB: 5, RB: 5, RWB: 5, SW: 5,
  GK: 6,
};
export function shareSquadLayout(players: PitchPlayer[]) {
  const lines = new Map<number, ReturnType<typeof layoutPitchPlayers>>();
  for (const player of layoutPitchPlayers(players)) {
    const key = ROWS[player.position] ?? Math.round(player.top / 16);
    lines.set(key, [...(lines.get(key) ?? []), player]);
  }
  const rows = [...lines].sort(([a], [b]) => a - b);
  return rows.flatMap(([, row], rowIndex) => {
    row.sort((a, b) => a.left - b.left);
    const width = row.length >= 4 ? Math.min(238, 960 / row.length - 16) : 300;
    const min = 36 + width / 2, max = 1044 - width / 2, gap = width + 16;
    const centers = row.map(p => Math.max(min, Math.min(max, p.left * 10.8)));
    for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + gap);
    centers[centers.length - 1] = Math.min(max, centers.at(-1)!);
    for (let i = centers.length - 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - gap);
    return row.map((player, i) => ({ ...player, x: centers[i], y: 290 + rowIndex * 830 / Math.max(1, rows.length - 1), nameWidth: width }));
  });
}
