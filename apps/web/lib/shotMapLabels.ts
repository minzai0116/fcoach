type Position = { x: number; y: number };
type Label = { point: Position; role: string; name: string };
type Bounds = { x: number; y: number; width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function placeShotMapLabels(labels: Label[], bottom: number, counters: Bounds[]) {
  const markers = labels.map(({ point }) => ({ x: point.x - 6, y: point.y - 6, width: 12, height: 12 }));
  const candidates = labels.map(({ point, name }) => {
    const height = 24;
    const width = clamp(27 + Array.from(name).reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? 6 : 10), 0), 47, 120);
    const position = (x: number, y: number): Bounds => ({
      x: clamp(x, 20, 220 - width), y: clamp(y, 20, bottom - height - 2), width, height,
    });
    return [
      position(point.x - width / 2, point.y - height - 8),
      position(point.x - width / 2, point.y + 8),
      position(point.x - width - 8, point.y - height / 2),
      position(point.x + 8, point.y - height / 2),
      position(point.x - width / 2, point.y - height - 24),
      position(point.x - width / 2, point.y + 24),
      position(point.x - width / 2, point.y + 40),
      position(point.x - width / 2, 20),
      position(point.x - width / 2, bottom - height - 2),
    ];
  });
  const cost = (bounds: Bounds, index: number) => {
    const { point } = labels[index];
    const dx = clamp(point.x, bounds.x, bounds.x + bounds.width) - point.x;
    const dy = clamp(point.y, bounds.y, bounds.y + bounds.height) - point.y;
    return Math.hypot(dx, dy) + markers.filter(marker => overlaps(bounds, marker)).length * 300
      + counters.filter(counter => overlaps(bounds, counter)).length * 120;
  };

  let best: Bounds[] = [], bestCost = Infinity;
  for (const first of candidates[0] ?? []) {
    for (const second of candidates[1] ?? [null]) {
      if (second && overlaps(first, second)) continue;
      const score = cost(first, 0) + (second ? cost(second, 1) : 0);
      if (score >= bestCost) continue;
      bestCost = score;
      best = second ? [first, second] : [first];
    }
  }
  return best.map((bounds, index) => ({ ...labels[index], ...bounds }));
}
