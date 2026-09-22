import { ROADMAP_HEADLINE, ROADMAP_SUB, VOTE_SUB, VOTE_TITLE } from "@/lib/roadmap";
import { loadVoteSummary } from "@/lib/votes";
import VoteBox from "./VoteBox";

/** 랜딩 — 티저 + 투표 상자 + (있으면) "투표로 뽑혀 열린 기능" 이력 */
export default async function Roadmap() {
  const s = await loadVoteSummary();
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }) : "");
  return (
    <section className="card roadmap" aria-labelledby="roadmap-title">
      <h2 id="roadmap-title">{ROADMAP_HEADLINE}</h2>
      <p className="sub">{ROADMAP_SUB} 지금 당장 필요한 기능이 없더라도 이메일만 등록해 두시면, 새 기능이 열릴 때 가장 먼저 안내받습니다.</p>
      {s.released.length > 0 && (
        <div className="released">
          <h3>투표로 뽑혀 열린 기능</h3>
          <ul>
            {s.released.map((o) => <li key={o.id}><strong>{o.label}</strong> <span>{fmt(o.released_at)} · {o.round_title}</span></li>)}
          </ul>
        </div>
      )}
      <VoteBox title={VOTE_TITLE} sub={VOTE_SUB} />
    </section>
  );
}
