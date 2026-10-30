import { allowedShareAsset } from "../../../lib/shareAssetPolicy";

export async function GET(request: Request) {
  const source = allowedShareAsset(new URL(request.url).searchParams.get("url") ?? "");
  if (!source) return new Response("지원하지 않는 이미지입니다.", { status: 400 });
  try {
    const upstream = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(10_000), next: { revalidate: 86400 } });
    const type = upstream.headers.get("content-type")?.split(";")[0] ?? "";
    if (!upstream.ok || !["image/png", "image/jpeg", "image/webp"].includes(type) || !upstream.body) throw new Error("image");
    const reader = upstream.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 3_000_000) { await reader.cancel(); throw new Error("size"); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("이미지를 불러올 수 없습니다.", { status: 502 }); }
}
