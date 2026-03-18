import { NextRequest, NextResponse } from "next/server";

const HOST_REDIRECT_MAP: Record<string, string> = {
  "www.fcoach.fun": "fcoach.fun",
};

export function middleware(request: NextRequest) {
  const hostHeader = request.headers.get("host") || "";
  const host = hostHeader.split(":")[0].toLowerCase();
  const targetHost = HOST_REDIRECT_MAP[host];
  if (!targetHost) return NextResponse.next();

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "https";
  redirectUrl.host = targetHost;
  return NextResponse.redirect(redirectUrl, 308);
}

export const config = { matcher: ["/:path*"] };
