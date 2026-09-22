"use client";
import { useState } from "react";
import type { VoteSummary, SuggestionRow } from "@/lib/votes";

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");

function Hidden({ action, extra }: { action: string; extra?: Record<string, string> }) {
  return (
    <>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="tab" value="votes" />
      {extra && Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
    </>
  );
}

export default function VotePanel({ summary, suggestions, available }: { summary: VoteSummary; suggestions: SuggestionRow[]; available: boolean }) {
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const open = summary.open;

  if (!available) return <section className="card"><h2>기능 투표·건의</h2><p className="sub">vote_rounds·vote_options·votes·suggestions 테이블 마이그레이션 후 사용할 수 있습니다.</p></section>;

  return (
    <>
      <section className="card">
        <div className="row between">
          <div>
            <h2>진행 중인 투표 {open ? `— ${open.title}` : ""}</h2>
            <p className="sub" style={{ margin: 0 }}>{open ? `${fmt(open.opened_at)} 시작 · 총 ${open.total}표 · 득표 ${open.show_results ? "공개" : "비공개"}` : "열린 라운드가 없습니다. 새 라운드를 열면 랜딩과 리포트에 투표 상자가 나타납니다."}</p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {open && (
              <form method="post" action="/api/admin/run">
                <Hidden action="vote_toggle_results" extra={{ round_id: open.id, show: open.show_results ? "0" : "1" }} />
                <button className="btn ghost small">{open.show_results ? "득표 비공개로" : "득표 공개로"}</button>
              </form>
            )}
            {open && !closing && <button type="button" className="btn ghost small" onClick={() => setClosing(true)}>라운드 마감</button>}
            {!open && !creating && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ 새 라운드</button>}
          </div>
        </div>

        {open && (
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table compact">
              <thead><tr><th>후보</th><th className="num">득표</th><th className="num">비율</th><th>출시</th><th></th></tr></thead>
              <tbody>
                {[...open.options].sort((a, b) => b.count - a.count).map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.label}</strong><span className="cell-sub">{o.description}</span></td>
                    <td className="num"><strong>{o.count}</strong></td>
                    <td className="num">{open.total ? `${Math.round((o.count / open.total) * 100)}%` : "—"}</td>
                    <td>{o.released_at ? <span className="rm-status new">출시 {fmt(o.released_at)}</span> : <span className="cell-sub">미출시</span>}</td>
                    <td className="actions">
                      <form method="post" action="/api/admin/run">
                        <Hidden action="vote_release" extra={{ option_id: o.id, released: o.released_at ? "0" : "1" }} />
                        <button className="btn ghost small">{o.released_at ? "출시 취소" : "출시로 표시"}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="sub" style={{ marginTop: 8 }}>"출시로 표시"하면 랜딩의 "투표로 뽑혀 열린 기능"에 오르고, 이후 3주 동안 리포트 상단에 "여러분이 뽑은 기능이 열렸습니다."로 실립니다. 다음 후보로 넘어가려면 라운드를 마감하고 새 라운드를 여세요.</p>
          </div>
        )}

        {open && closing && (
          <form method="post" action="/api/admin/run" className="channel-form" style={{ marginTop: 10 }}>
            <Hidden action="vote_close" extra={{ round_id: open.id }} />
            <label>마감 메모 (선택 — 내부 기록용)
              <input name="release_note" maxLength={500} placeholder="예) 아카이브 1위(41표) → 10월 착수" />
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn danger" onClick={(e) => { if (!confirm("라운드를 마감할까요? 랜딩·리포트의 투표 상자가 사라집니다.")) e.preventDefault(); }}>마감</button>
              <button type="button" className="btn ghost" onClick={() => setClosing(false)}>취소</button>
            </div>
          </form>
        )}

        {!open && creating && (
          <form method="post" action="/api/admin/run" className="channel-form" style={{ marginTop: 10 }}>
            <Hidden action="vote_create" />
            <label>라운드 제목 <span className="req">*</span>
              <input name="title" required maxLength={120} placeholder="예) 2차 — 다음 기능은 RA·QA 실무자가 고릅니다." />
            </label>
            <label>후보 (한 줄에 하나, "제목 | 설명") <span className="req">*</span>
              <textarea name="options" rows={8} required placeholder={"규격별 개정 이력 타임라인 | 규격 하나를 골라 개정 흐름을 시간순으로\n입법예고 의견제출 기한 알림 | 마감이 다가오는 입법예고를 따로 알림"} />
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn primary">라운드 열기</button>
              <button type="button" className="btn ghost" onClick={() => setCreating(false)}>취소</button>
            </div>
          </form>
        )}
      </section>

      {summary.closedRounds.length > 0 && (
        <section className="card">
          <h2>지난 라운드</h2>
          {summary.closedRounds.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <strong>{r.title}</strong> <span className="sub">{fmt(r.opened_at)} ~ {fmt(r.closed_at)} · {r.total}표{r.release_note ? ` · ${r.release_note}` : ""}</span>
              <div className="table-wrap">
                <table className="admin-table compact"><tbody>
                  {[...r.options].sort((a, b) => b.count - a.count).map((o) => (
                    <tr key={o.id}><td>{o.label}</td><td className="num">{o.count}</td><td>{o.released_at ? <span className="rm-status new">출시 {fmt(o.released_at)}</span> : ""}</td>
                      <td className="actions"><form method="post" action="/api/admin/run"><Hidden action="vote_release" extra={{ option_id: o.id, released: o.released_at ? "0" : "1" }} /><button className="btn ghost small">{o.released_at ? "출시 취소" : "출시로 표시"}</button></form></td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2>건의 ({suggestions.length})</h2>
        <p className="sub">투표 상자의 "목록에 없는 기능" 입력. 익명이며 이메일·IP 는 저장되지 않습니다. 개인정보가 적혀 있으면 삭제하세요.</p>
        {suggestions.length === 0 ? <p className="sub">아직 건의가 없습니다.</p> : (
          <div className="table-wrap">
            <table className="admin-table compact">
              <thead><tr><th>시각</th><th>채널</th><th>내용</th><th></th></tr></thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(s.created_at)}</td>
                    <td>{s.ref ?? "—"}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{s.message}</td>
                    <td className="actions"><form method="post" action="/api/admin/run" onSubmit={(e) => { if (!confirm("이 건의를 삭제할까요?")) e.preventDefault(); }}><Hidden action="suggestion_delete" extra={{ id: s.id }} /><button className="btn danger small">삭제</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
