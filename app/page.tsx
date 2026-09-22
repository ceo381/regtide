import Link from "next/link";
import { Suspense } from "react";
import SubscribeForm from "./components/SubscribeForm";
import UnsubNotice from "./components/UnsubNotice";
import { COVERAGE } from "@/lib/source-info";
import Faq, { FAQ } from "./components/Faq";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://regtide-pi.vercel.app";

/** 구조화 데이터 — WebSite(사이트), Organization(운영사), FAQPage(아래 FAQ 와 동일 문구) */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "BreaThings",
      url: "https://breathings.co.kr",
      email: "ceo@breathings.co.kr",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#website`,
      url: SITE,
      name: "RegTide",
      alternateName: "레그타이드 · 의료기기 규격·인증 변경 주간 알림",
      description: "의료기기 규격·인증(식약처·FDA·EU MDR·ISO/IEC) 변경 사항을 매주 월요일 이메일로 알려주는 무료 서비스",
      inLanguage: "ko",
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE}/#faq`,
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ],
};

export default function Home() {
  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <section className="hero">
        <p className="eyebrow">RegTide</p>
        <h1>
          내 품목에 적용된 의료기기 규격·인증,
          <br />
          바뀌면 매주 월요일 아침에 알려드립니다.
        </h1>
        <p>
          회원가입 없이 품목과 적용 규격·인증만 선택하세요. 식약처 고시·입법예고, 미국 Federal Register, EU MDR/MDCG,
          ISO/IEC 규격 동향을 자동 수집해 원문 발췌와 링크를 이메일로 보내드립니다. 무료입니다.
        </p>
        <div className="coverage" aria-label="지원 국가">
          {COVERAGE.map((c) => (
            <div key={c.code} className="coverage-item">
              <strong>{c.country}</strong>
              <span>{c.agencies}</span>
            </div>
          ))}
        </div>
        <div className="sources">
          <span>식약처 입법·행정예고</span>
          <span>식약처 고시·안내서</span>
          <span>국가법령정보센터</span>
          <span>US Federal Register (FDA)</span>
          <span>EU Commission · MDCG</span>
          <span>EU 조화규격 (OJEU)</span>
          <span>ISO/TC 210 · IEC TC 62</span>
        </div>
      </section>

      <Suspense fallback={null}>
        <UnsubNotice />
      </Suspense>

      <SubscribeForm />

      <Faq />

      <footer>
        모든 항목에는 발행 기관(출처), 기관 발표 일시, RegTide 수집 일시(KST)와 원문 링크가 함께 표기됩니다. 지원 국가·기관: 한국(식약처·법제처), 미국(FDA), 유럽연합(European Commission·MDCG), 국제규격(ISO/IEC).
        <br />
        본 서비스는 공개된 규제 정보를 자동 수집·분류하여 제공하는 <strong>참고용 도구</strong>이며, 법률·규제 자문이 아니고 법적 효력이 없습니다. 일부 변경 사항이 누락·지연되거나 관련 없는 항목이 포함될 수 있으므로, 인허가·품질 관련 판단 전에 반드시 원문을 확인하세요. 본 정보에 근거한 판단과 그 결과에 대한 책임은 이용자에게 있습니다.
        <br />
        <Link href="/disclaimer">이용 안내 및 면책조항</Link> · <Link href="/privacy">개인정보 처리방침</Link>
      </footer>
    </main>
  );
}
