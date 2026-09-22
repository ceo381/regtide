"use client";
import { useMemo, useState } from "react";

export interface SubRow {
  id: string;
  email: string;
  productsLabel: string;
  productSearch: string;
  catalogCount: number;
  createdLabel: string;
  lastSentLabel: string;
  active: boolean;
}

/** 구독자 목록 — 검색은 브라우저에서 즉시 필터링 (서버 재요청 없음) */
export default function SubscriberTable({ rows }: { rows: SubRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) => r.email.toLowerCase().includes(k) || r.productSearch.includes(k));
  }, [rows, q]);

  return (
    <>
      <div className="admin-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일 또는 품목명 검색" aria-label="구독자 검색" />
        {q && <button type="button" className="btn ghost" onClick={() => setQ("")}>초기화</button>}
      </div>
      <p className="sub">{filtered.length}명 표시 · 비활성화하면 발송 대상에서 제외되고, 삭제하면 이메일이 즉시 삭제됩니다(구독해지와 동일).</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>이메일</th><th>품목</th><th>규격</th><th>가입</th><th>마지막 발송</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className={s.active ? "" : "inactive"}>
                <td>{s.email}</td>
                <td>{s.productsLabel || "—"}</td>
                <td className="num">{s.catalogCount}</td>
                <td>{s.createdLabel}</td>
                <td>{s.lastSentLabel}</td>
                <td>{s.active ? "활성" : "비활성"}</td>
                <td className="actions">
                  {s.active && (
                    <form method="post" action="/api/admin/run" onSubmit={(e) => { if (!confirm(`${s.email} 을(를) 발송 대상에서 제외할까요?`)) e.preventDefault(); }}>
                      <input type="hidden" name="action" value="deactivate" /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="tab" value="subscribers" />
                      <button className="btn ghost small">비활성화</button>
                    </form>
                  )}
                  <form method="post" action="/api/admin/run" onSubmit={(e) => { if (!confirm(`${s.email} 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) e.preventDefault(); }}>
                    <input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="tab" value="subscribers" />
                    <button className="btn danger small">삭제</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
