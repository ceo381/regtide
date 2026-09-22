import { ROADMAP_HEADLINE, ROADMAP_SUB, VOTE_TITLE } from "@/lib/roadmap";
import { loadVoteSummary } from "@/lib/votes";

/** 랜딩 — 티저 + "투표 진행 중" 사실만 (후보·투표 상자 없음). 투표는 구독자 전용 링크(/vote)로만 */
export default async function Roadmap() {
  const s = await loadVoteSummary();
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }) : "");
  const open = s.open;
  return (
    <section className="card roadmap" id="roadmap" aria-labelledby="roadmap-title">
      <h2 id="roadmap-title">{ROADMAP_HEADLINE}</h2>
      <p className="sub">{ROADMAP_SUB}</p>
      {open && (
        <div className="vote-teaser">
          <span className="live">투표 진행 중</span>
          <div>
            <strong>{VOTE_TITLE}</strong>
            <span>
              후보 {open.options.length}개를 두고 구독자들이 다음에 열릴 기능을 고르고 있습니다{open.participants >= 10 ? ` · 지금까지 ${open.participants}명 참여` : ""}.
              투표는 구독 확인 메일과 매주 월요일 리포트의 링크로만 참여할 수 있습니다.
            </span>
          </div>
        </div>
      )}
      {s.released.length > 0 && (
        <div className="released">
          <h3>투표로 뽑혀 열린 기능</h3>
          <ul>
            {s.released.map((o) => <li key={o.id}><strong>{o.label}</strong> <span>{fmt(o.released_at)} · {o.round_title}</span></li>)}
          </ul>
        </div>
      )}
      <p className="roadmap-cta">지금 당장 필요한 기능이 없더라도 이메일만 등록해 두시면, 새 기능이 열릴 때 가장 먼저 안내받고 다음 기능을 고르는 투표에도 참여할 수 있습니다.</p>
      <a href="#subscribe" className="btn btn-primary" style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}>구독하고 투표하기</a>
    </section>
  );
}
