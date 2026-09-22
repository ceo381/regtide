"use client";
import { useMemo, useState } from "react";
import { useSort } from "./useSort";

export interface UpdateRowView {
  id: string;
  createdAt: string | null;
  publishedAt: string | null;
  createdLabel: string;
  publishedLabel: string;
  jurisdiction: string;
  impact: string | null; // high | medium | low | none | null
  impactLabel: string;
  title: string;
  url: string;
  sourceLabel: string;
  catalogLabel: string;
}

const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1, none: 0 };
const COLS = {
  created: (r: UpdateRowView) => r.createdAt,
  published: (r: UpdateRowView) => r.publishedAt,
  jurisdiction: (r: UpdateRowView) => r.jurisdiction,
  impact: (r: UpdateRowView) => (r.impact ? IMPACT_RANK[r.impact] ?? -1 : -1),
  title: (r: UpdateRowView) => r.title,
  source: (r: UpdateRowView) => r.sourceLabel,
  catalog: (r: UpdateRowView) => r.catalogLabel || null,
};

export default function UpdatesTable({ rows }: { rows: UpdateRowView[] }) {
  const [q, setQ] = useState("");
  const [hideNone, setHideNone] = useState(false);
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => (!hideNone || r.impact !== "none") && (!k || r.title.toLowerCase().includes(k) || r.sourceLabel.toLowerCase().includes(k) || r.catalogLabel.toLowerCase().includes(k)));
  }, [rows, q, hideNone]);
  const srt = useSort(filtered, COLS, { key: "created", dir: "desc" });

  return (
    <>
      <div className="admin-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 · 출처 · 규격 검색" aria-label="수집 항목 검색" />
        <label className="check"><input type="checkbox" checked={hideNone} onChange={(e) => setHideNone(e.target.checked)} /> 무관 숨기기</label>
        {q && <button type="button" className="btn ghost" onClick={() => setQ("")}>초기화</button>}
      </div>
      <p className="sub">{filtered.length}건 표시 · 열 제목을 누르면 정렬됩니다.</p>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr>{srt.th("created", "수집")}{srt.th("published", "발표")}{srt.th("jurisdiction", "관할")}{srt.th("impact", "영향도")}{srt.th("title", "제목")}{srt.th("source", "출처")}{srt.th("catalog", "매칭 규격")}</tr></thead>
          <tbody>
            {srt.sorted.map((u) => (
              <tr key={u.id} className={u.impact === "none" ? "inactive" : ""}>
                <td>{u.createdLabel}</td>
                <td>{u.publishedLabel}</td>
                <td>{u.jurisdiction}</td>
                <td><span className={`impact ${u.impact ?? "pending"}`}>{u.impactLabel}</span></td>
                <td><a href={u.url || "#"} target="_blank" rel="noreferrer">{u.title}</a></td>
                <td>{u.sourceLabel}</td>
                <td>{u.catalogLabel || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
