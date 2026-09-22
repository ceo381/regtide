import type { Metadata } from "next";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://regtide-pi.vercel.app";
const TITLE = "RegTide · 의료기기 규격·인증 변경 주간 알림 (식약처·FDA·EU MDR·ISO)";
const DESCRIPTION =
  "내 품목에 적용된 의료기기 규격·인증이 바뀌면 매주 월요일 이메일로 알려드립니다. 식약처 고시·입법예고, 국가법령정보, 미국 FDA(Federal Register), EU MDR/IVDR·MDCG, ISO/IEC 규격 동향을 자동 수집. 회원가입 없음, 무료.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s · RegTide" },
  description: DESCRIPTION,
  applicationName: "RegTide",
  keywords: [
    "의료기기 규제", "의료기기 규제 업데이트", "의료기기 규격 변경 알림", "식약처 고시 알림", "식약처 입법예고", "의료기기법 개정",
    "의료기기 인허가", "의료기기 RA", "의료기기 QA", "MDR 개정", "EU MDR", "IVDR", "MDCG 가이던스", "FDA 의료기기 규제", "Federal Register FDA",
    "ISO 13485", "IEC 60601", "ISO 14971", "규제 모니터링", "의료기기 뉴스레터",
  ],
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE,
    siteName: "RegTide",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "RegTide — 의료기기 규격·인증 변경 주간 알림" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NAVER_SITE_VERIFICATION ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } : undefined,
  },
  category: "technology",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
