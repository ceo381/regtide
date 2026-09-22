import Link from "next/link";
import { verifyVoteToken } from "@/lib/vote-token";
import { loadVoteSummary, myVotes } from "@/lib/votes";
import { supabaseAdmin } from "@/lib/supabase";
import { VOTE_SUB, VOTE_TITLE } from "@/lib/roadmap";
import VoteBox from "../components/VoteBox";

export const metadata = { title: "다음 기능 투표", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * 구독자 전용 투표 페이지 — 확인 메일·주간 리포트의 개인 링크(/vote?s=&t=)로만 진입.
 * 토큰이 없거나 틀리면 투표 상자 대신 구독 안내.
 */
export default async function VotePage({ searchParams }: { searchParams: Promise<{ s?: string; t?: string }> }) {
  const { s = "", t = "" } = await searchParams;
  const verified = verifyVoteToken(s, t);
  let active = false;
  if (verified) {
    const { data } = await supabaseAdmin().from("subscribers").select("active").eq("id", s).maybeSingle();
    active = !!(data as { active?: boolean } | null)?.active;
  }
  const summary = await loadVoteSummary();
  const mine = verified && active && summary.open ? await myVotes(summary.open.id, s) : [];

  return (
    <main className="container">
      <section className="hero">
        <p className="eyebrow">RegTide</p>
        <h1>{VOTE_TITLE}</h1>
        <p>{VOTE_SUB}</p>
      </section>

      {!verified || !active ? (
        <section className="card">
          <h2>구독자만 투표할 수 있습니다</h2>
          <p className="sub">
            이 페이지는 구독 확인 메일과 매주 월요일 리포트에 담긴 개인 링크로만 열립니다. 링크가 만료되었거나 구독이 해지된 경우에도 이 화면이 보입니다.
            아직 구독 전이라면 30초면 됩니다. 구독하면 확인 메일에서 바로 투표할 수 있습니다.
          </p>
          <Link href="/#subscribe" className="btn btn-primary" style={{ display: "inline-block", textDecoration: "none" }}>구독하고 투표하기</Link>
        </section>
      ) : !summary.open ? (
        <section className="card">
          <h2>지금은 진행 중인 투표가 없습니다</h2>
          <p className="sub">다음 라운드가 열리면 주간 리포트에서 안내드립니다.</p>
        </section>
      ) : (
        <section className="card roadmap">
          <VoteBox title={summary.open.title} sub={mine.length ? "이미 참여하셨습니다. 고르신 항목은 아래와 같습니다." : "여러 개 골라도 되고, 목록에 없으면 직접 적어 주셔도 됩니다."} auth={{ s, t }} mine={mine} />
        </section>
      )}

      {summary.released.length > 0 && (
        <section className="card">
          <h2>투표로 뽑혀 열린 기능</h2>
          <ul>
            {summary.released.map((o) => <li key={o.id}><strong>{o.label}</strong> <span className="sub">{o.round_title}</span></li>)}
          </ul>
        </section>
      )}
      <footer><Link href="/">RegTide 홈</Link> · <Link href="/privacy">개인정보 처리방침</Link></footer>
    </main>
  );
}
