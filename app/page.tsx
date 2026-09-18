import Link from "next/link";
import { Suspense } from "react";
import SubscribeForm from "./components/SubscribeForm";
import UnsubNotice from "./components/UnsubNotice";

export default function Home() {
  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">RegTide</p>
        <h1>
          내 품목에 적용된 규격·인증,
          <br />
          바뀌면 매주 월요일 아침에 알려드립니다.
        </h1>
        <p>
          회원가입 없이 품목과 적용 규격·인증만 선택하세요. 식약처 고시·입법예고, 미국 Federal Register, EU MDR/MDCG,
          ISO/IEC 규격 동향을 자동 수집해 원문 발췌와 링크를 이메일로 보내드립니다. 무료입니다.
        </p>
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

      <footer>
        본 서비스는 공개된 규제 정보를 자동 수집·분류하여 제공하는 <strong>참고용 도구</strong>이며, 법률·규제 자문이 아니고 법적 효력이 없습니다. 일부 변경 사항이 누락·지연되거나 관련 없는 항목이 포함될 수 있으므로, 인허가·품질 관련 판단 전에 반드시 원문을 확인하세요. 본 정보에 근거한 판단과 그 결과에 대한 책임은 이용자에게 있습니다.
        <br />
        <Link href="/disclaimer">이용 안내 및 면책조항</Link> · <Link href="/privacy">개인정보 처리방침</Link>
      </footer>
    </main>
  );
}
