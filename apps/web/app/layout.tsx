import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FCOACH",
  description: "FCOACH · FC 온라인 전적 진단/코칭 리포트 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
