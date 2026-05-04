import type { Metadata } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const siteUrl = "https://fcoach.fun";
const siteDescription =
  "FC온라인 닉네임만 입력하면 최근 경기 로그를 분석해 핵심 지표, 선수 리포트, 전술 코칭, 개선 추적을 제공하는 비공식 개인 코치 서비스입니다.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "FCOACH | FC온라인 전술 코칭",
    template: "%s | FCOACH",
  },
  description: siteDescription,
  applicationName: "FCOACH",
  keywords: ["FC온라인", "FC Online", "FCOACH", "전술 코칭", "경기 분석", "선수 리포트", "랭커 분석"],
  authors: [{ name: "FCOACH", url: siteUrl }],
  creator: "FCOACH",
  publisher: "FCOACH",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.svg",
    apple: "/apple-icon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: siteUrl,
    siteName: "FCOACH",
    title: "FCOACH | FC온라인 전술 코칭",
    description: siteDescription,
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "FCOACH - FC온라인 전술 코칭",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FCOACH | FC온라인 전술 코칭",
    description: siteDescription,
    images: ["/og-image.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Script
          src="https://openapi.nexon.com/js/analytics.js?app_id=289946"
          strategy="afterInteractive"
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
