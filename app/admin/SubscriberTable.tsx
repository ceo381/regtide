"use client";
import { useMemo, useState } from "react";
import { useSort } from "./useSort";

export interface SubRow {
  id: string;
  email: string;
  productsLabel: string;
  productSearch: string;
  catalogCount: number;
  ref: string;
  createdLabel: string;
  lastSentLabel: string;
  createdAt: string | null; // 정렬용 ISO
  lastSentAt: string | null;
  active: boolean;
}

const COLS = {
  email: (r: SubRow) => r.email,
  products: (r: SubRow) => r.productsLabel,
  catalog: (r: SubRow) => r.catalogCount,
  ref: (r: SubRow) => r.ref,
  created: (r: SubRow) => r.createdAt,
  lastSent: (r: SubRow) => r.lastSentAt,
  active: (r: SubRow) => r.active,
};

/** 구독자 목록 — 검색은 브라우저에서 즉시 필터링 (서버 재요청 없음) */
export default function SubscriberTable({ rows }: { rows: SubRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rows;
    return rows.filter((r) => r.email.toLowerCase().includes(k) || r.productSearch.includes(k) || r.ref.toLowerCase().includes(k));
  }, [rows, q]);
  const srt = useSort(filtered, COLS, { key: "created", dir: "desc" });

  return (
    <>
      <div className="admin-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이메일 · 품목명 · 채널(ref) 검색" aria-label="구독자 검색" />
        {q && <button type="button" className="btn ghost" onClick={() => setQ("")}>초기화</button>}
      </div>
      <p className="sub">{filtered.length}명 표시 · 비활성화하면 발송 대상에서 제외되고, 삭제하면 이메일이 즉시 삭제됩니다(구독해지와 동일).</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr>{srt.th("email", "이메일")}{srt.th("products", "품목")}{srt.th("catalog", "규격", { num: true })}{srt.th("ref", "채널")}{srt.th("created", "가입")}{srt.th("lastSent", "마지막 발송")}{srt.th("active", "상태")}<th></th></tr></thead>
          <tbody>
            {srt.sorted.map((s) => (
              <tr key={s.id} className={s.active ? "" : "inactive"}>
                <td>{s.email}</td>
                <td>{s.productsLabel || "—"}</td>
                <td className="num">{s.catalogCount}</td>
                <td>{s.ref || <span style={{ color: "#98a2b3" }}>—</span>}</td>
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
