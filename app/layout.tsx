import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RegTide · 의료기기 규격·인증 주간 모니터링",
  description:
    "보유 품목에 적용된 국내외 규격·인증(식약처, FDA, EU MDR, ISO/IEC)의 법령·고시·가이던스 변경 사항을 매주 월요일 이메일로 받아보세요. 회원가입 없음, 무료.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
