import type { DomainScores, MatchTrends } from "../types/comparison";
import type { PlayerReportEntry } from "../types/analysis";
import type { PitchPlayer } from "./pitchLineup";
import type { SquadFeedSnapshot } from "../types/squadFeed";
import { shareSquadLayout } from "./shareSquadLayout";
import { shareComparisonMetrics } from "./shareComparison";
import { trendChangePresentation } from "./comparisonInsights";
import { allowedShareAsset } from "./shareAssetPolicy";
import { trendEndpointIndices } from "./trendPeriods";

type Context = { nickname: string; period: string; matches: number };
export type ShareImageInput = Context & (
  { kind: "score"; scores: DomainScores }
  | { kind: "comparison"; trends: MatchTrends; baseline: number | null }
  | { kind: "squad"; players: PitchPlayer[]; reports: PlayerReportEntry[]; feed?: SquadFeedSnapshot }
);
export function shareImageTitle(input: ShareImageInput) {
  return input.kind === "comparison" ? input.baseline === null ? "초반·최근 기록 비교" : "기준 경기 전후 비교" : input.kind === "score" ? "플레이 성적표" : "스쿼드";
}
const C = { ink: "#16304e", secondary: "#536881", blue: "#245be0", reference: "#8394ad", red: "#d23c47", pale: "#f1f5fc", line: "#dce5f1", green: "#174c42" };
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const text = (x: number, y: number, value: unknown, size = 32, color = C.ink, weight = 500, anchor = "start") => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escape(value)}</text>`;
const box = (x: number, y: number, w: number, h: number, fill = C.pale, r = 26) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const image = (src: string, x: number, y: number, w: number, h: number) => src ? `<image href="${escape(src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMax meet"/>` : "";
const scale = (unit: string) => ["rate", "percent"].includes(unit) ? 100 : 1;
const suffix = (unit: string) => ({ rate: "%", percent: "%", goals: "골", rating: "점", meters: "m", average: "회" }[unit] ?? "");
const value = (n: number, unit: string) => (n * scale(unit)).toFixed(1) + suffix(unit);
const date = (raw: string) => new Date(raw).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export function sharePeriod(dates: string[]) {
  const valid = dates.map(d => Date.parse(d)).filter(Number.isFinite);
  const format = (d: number) => new Date(d).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" });
  return valid.length ? `${format(Math.min(...valid))} ~ ${format(Math.max(...valid))}` : "최근 경기";
}
function fit(context: CanvasRenderingContext2D, label: string, width: number, size: number) {
  context.font = `700 ${size}px "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  return Math.min(size, size * width / Math.max(1, context.measureText(label).width));
}
function frame(input: ShareImageInput, title: string, subtitle: string, body: string, height: number, showNickname: boolean) {
  const footer = height - (input.kind === "squad" ? 62 : 92);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}" font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif"><title>${escape(title)}</title><rect width="1080" height="${height}" fill="#fff"/>${text(72, 82, "FCOACH", 36, C.blue, 800)}${showNickname ? text(1008, 82, input.nickname, 32, C.secondary, 600, "end") : ""}${text(72, 174, title, 64, C.ink, 800)}${text(72, 232, subtitle, 30, C.secondary)}${body}<path d="M72 ${footer}H1008" stroke="${C.line}" stroke-width="2"/>${text(72, footer + 44, "기록으로 보는 플레이", 28, C.secondary)}${text(1008, footer + 44, "fcoach.fun", 36, C.blue, 700, "end")}</svg>`;
}
function score(input: Extract<ShareImageInput, { kind: "score" }>) {
  let body = text(72, 310, "경기 기록", 30, C.blue, 700) + text(286, 310, "랭커 평균", 30, C.reference, 600) + text(1008, 310, "100점 기준", 28, C.secondary, 500, "end");
  if (input.scores.scope) body += text(72, 272, `횟수 점수 · 정상 종료 ${input.scores.scope.completed_matches}경기 기준`, 25, C.secondary);
  input.scores.areas.slice(0, 6).forEach((area, i) => {
    const x = 72 + i % 2 * 480, y = 346 + Math.floor(i / 2) * 224;
    body += box(x, y, 456, 202) + text(x + 28, y + 48, area.label, 34, C.ink, 700) + text(x + 28, y + 126, area.mine == null ? "—" : Math.round(area.mine), 80, C.ink, 800) + text(x + 143, y + 124, "점", 30, C.secondary) + text(x + 422, y + 115, `평균 ${area.reference == null ? "—" : Math.round(area.reference)}`, 29, C.secondary, 500, "end");
    body += box(x + 28, y + 153, 400, 12, "#e0e7f2", 6);
    if (area.mine != null) body += box(x + 28, y + 153, Math.max(0, Math.min(100, area.mine)) * 4, 12, C.blue, 6);
    if (area.reference != null) body += box(x + 28, y + 176, Math.max(0, Math.min(100, area.reference)) * 4, 6, C.reference, 3);
  });
  const gap = (a: DomainScores["areas"][number]) => Math.round(a.mine!) - Math.round(a.reference!);
  const ranked = input.scores.areas.filter(a => a.mine != null && a.reference != null).sort((a, b) => gap(b) - gap(a));
  const best = ranked.find(a => gap(a) > 0), worst = [...ranked].reverse().find(a => gap(a) < 0);
  for (const [area, title, x, color] of [[best, "강점", 72, C.blue], [worst, "보완", 570, C.red]] as const) {
    if (area) body += text(x, 1094, title, 30, color, 700) + text(x, 1141, area.label, 40, C.ink, 700) + text(x + 436, 1140, `${Math.round(area.mine!)} · 평균 ${Math.round(area.reference!)}`, 34, C.secondary, 600, "end");
  }
  return body;
}
function comparison(input: Extract<ShareImageInput, { kind: "comparison" }>, context: CanvasRenderingContext2D) {
  const selected = shareComparisonMetrics(input.trends, input.baseline);
  if (!selected.length) throw new Error("저장할 비교 지표가 없습니다. 기준 경기를 선택하거나 바꿔주세요.");
  const { first, last } = trendEndpointIndices(input.trends), { baseline } = input;
  const dates = baseline === null ? `${date(input.trends.points[first].date)} → ${date(input.trends.points[last].date)}` : date(input.trends.points[baseline].date);
  let body = box(72, 280, 936, 102, C.ink) + text(108, 321, baseline === null ? "초반 → 최근 시점" : "기준 경기", 28, "#cbd7e8") + text(108, 360, dates, fit(context, dates, 864, 36), "#fff", 700);
  const beforeLabel = baseline === null ? `초반 ${input.trends.points[first].window_matches}경기 집계` : `이전 ${baseline}경기`;
  const afterLabel = baseline === null ? `최근 ${input.trends.points[last].window_matches}경기 집계` : `이후 ${input.trends.points.length - baseline}경기`;
  body += text(72, 439, beforeLabel, 36, C.secondary, 600) + text(1008, 439, afterLabel, 36, C.ink, 700, "end");
  const columns = selected.length <= 2 ? 1 : 2, rows = Math.ceil(selected.length / columns), width = columns === 1 ? 936 : 456;
  const height = ((rows === 3 ? 756 : 708) - (rows - 1) * 24) / rows;
  selected.forEach((metric, i) => {
    const x = 72 + i % columns * 480, y = 476 + Math.floor(i / columns) * (height + 24), roomy = height > 300;
    const change = trendChangePresentation(metric.after.value, metric.before.value, metric.unit, metric.direction);
    const fill = change.direction === "improved" ? "#fff2f2" : change.direction === "declined" ? "#eff4ff" : "#f3f4f6";
    const delta = Number(((metric.after.value! - metric.before.value!) * scale(metric.unit)).toFixed(1));
    const deltaText = `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta).toFixed(1)}${["rate", "percent"].includes(metric.unit) ? "%p" : suffix(metric.unit)}`;
    body += box(x, y, width, height, fill) + text(x + 26, y + (roomy ? 49 : 39), metric.label, fit(context, metric.label, width - 52, 34), C.ink, 700) + text(x + 26, y + (roomy ? 139 : 98), deltaText, roomy ? 82 : 58, change.color, 800);
    const values = `${value(metric.before.value!, metric.unit)} → ${value(metric.after.value!, metric.unit)}`;
    body += text(x + 26, y + (roomy ? 211 : 146), values, fit(context, values, width - 52, roomy ? 42 : 36), C.ink, 600);
    if (metric.unit === "rate") {
      const attempts = metric.id === "overview:win_rate" ? `${metric.before.success}승/${metric.before.trials}경기 → ${metric.after.success}승/${metric.after.trials}경기` : `${metric.before.success}/${metric.before.trials}회 → ${metric.after.success}/${metric.after.trials}회`;
      body += text(x + 26, y + height - (roomy ? 69 : 48), attempts, fit(context, attempts, width - 52, 27), C.secondary);
    }
    body += text(x + 26, y + height - (roomy ? 25 : 15), `기록 ${metric.before.matches}경기 → ${metric.after.matches}경기`, 27, C.secondary);
  });
  return body;
}

async function embeddedImage(candidates: string[]): Promise<string> {
  for (const source of [...new Set(candidates.filter(Boolean))]) {
    if (!allowedShareAsset(source)) continue;
    try {
      const response = await fetch(`/api/share-asset?url=${encodeURIComponent(source)}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const url = URL.createObjectURL(await response.blob());
      try {
        const img = new Image(); img.src = url; await img.decode();
        const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        canvas.getContext("2d")!.drawImage(img, 0, 0);
        return canvas.toDataURL("image/png");
      } finally { URL.revokeObjectURL(url); }
    } catch { /* 다음 공식 이미지 후보를 확인한다. */ }
  }
  throw new Error("선수 사진 또는 시즌 이미지를 불러오지 못했습니다. 다시 시도해주세요.");
}
async function squad(input: Extract<ShareImageInput, { kind: "squad" }>, context: CanvasRenderingContext2D) {
  const reports = new Map(input.reports.map(p => [p.sp_id, p]));
  const memo = new Map<string, Promise<string>>();
  const load = (sources: string[]) => { const key = sources.join("|"); if (!memo.has(key)) memo.set(key, embeddedImage(sources)); return memo.get(key)!; };
  const players = shareSquadLayout(input.players);
  const compact = new Set(players.map(p => p.y)).size > 6;
  if (!players.length) throw new Error("저장할 스쿼드가 없습니다.");
  const content = await Promise.all(players.map(async p => {
      const { x, y } = p;
      const report = reports.get(p.spId), saved = p.settings;
      const photos = saved?.portrait_img ? [saved.portrait_img] : [p.portraitImage ?? "", report?.action_img ?? "", `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${p.spId}.png`, report?.face_img ?? "", `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${p.spId % 1_000_000}.png`];
      const seasonUrl = saved?.season_img || report?.season_img;
      const [photo, season] = await Promise.all([load(photos), seasonUrl ? load([seasonUrl]) : Promise.resolve("")]);
      const name = report?.player_name && !/^(spId|선수)\s*\d+/i.test(report.player_name) ? report.player_name : p.name;
      const photoHeight = compact ? 105 : 127, captionY = compact ? 132 : 158;
      let body = image(photo, x - 75, y, 150, photoHeight) + text(x - 79, y + 27, p.position, 29, "#e3f4e9", 700, "end");
      if (p.grade != null) body += box(x + 55, y + photoHeight - 47, 49, 35, "#f6d857", 4) + text(x + 79.5, y + photoHeight - 20, p.grade, 33, "#42340b", 800, "middle");
      return body + image(season, x - 108, y + photoHeight - 31, 36, 29) + text(x, y + captionY, name, fit(context, name, p.nameWidth, compact ? 32 : 36), "#fff", 700, "middle");
  }));
  let body = box(36, 264, 1008, 1046, C.green, 24);
  for (let i = 0; i < 6; i += 2) body += `<rect x="36" y="${264 + i * 174.33}" width="1008" height="174.33" fill="#ffffff06"/>`;
  body += `<g fill="none" stroke="#aad2bd" stroke-opacity=".48" stroke-width="2"><rect x="70" y="294" width="940" height="986"/><path d="M70 787H1010 M300 294V444H780V294 M300 1280V1130H780V1280 M425 294V345H655V294 M425 1280V1229H655V1280"/><circle cx="540" cy="787" r="112"/></g>` + content.join("");
  const labels = { affiliation: "소속", feature: "특성", enhance: "강화" };
  const colors = input.feed?.team_colors ?? [];
  colors.forEach((color, i) => {
    const y = 1345 + i * 75;
    const name = `${labels[color.category]} · ${color.name}`;
    body += text(72, y, name, fit(context, name, 710, 33), C.ink, 700) + text(1008, y, `${color.level}단계 · ${color.players}명`, 28, C.secondary, 500, "end");
    const effects = color.effects.map(v => `${v.type} +${v.value}`).join(" · ");
    body += text(72, y + 32, effects, fit(context, effects, 936, 27), C.secondary);
  });
  return body;
}
export async function createShareImage(input: ShareImageInput, showNickname: boolean): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas"); canvas.width = 1080;
  canvas.height = input.kind === "squad" ? Math.max(1620, 1395 + (input.feed?.team_colors?.length ?? 0) * 75) : 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 브라우저에서는 이미지 저장을 지원하지 않습니다.");
  const body = input.kind === "score" ? score(input) : input.kind === "comparison" ? comparison(input, context) : await squad(input, context);
  const subtitle = input.kind === "squad" ? input.feed ? `공개 피드 저장 구성 · ${input.feed.formation}` : "최근 경기 등록 선수" : `${input.period} · 최근 ${input.matches}경기${input.kind === "score" ? ` · 랭커 ${Math.max(...input.scores.areas.map(a => a.ranker_count), 0)}명 비교` : ""}`;
  const url = URL.createObjectURL(new Blob([frame(input, shareImageTitle(input), subtitle, body, canvas.height, showNickname)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image(); img.src = url; await img.decode(); context.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지 생성에 실패했습니다.")), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}
