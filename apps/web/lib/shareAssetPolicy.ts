export function allowedShareAsset(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    const allowed = url.hostname === "fco.dn.nexoncdn.co.kr" && url.pathname.startsWith("/live/externalAssets/common/")
      || url.hostname === "ssl.nexon.com" && url.pathname.startsWith("/s2/game/fc/");
    return allowed && /\.(png|jpe?g|webp)$/i.test(url.pathname) ? url : null;
  } catch { return null; }
}
