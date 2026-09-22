"use client";
import { useSort } from "./useSort";

export interface DeliveryRowView {
  key: string;
  sentAt: string;
  sentLabel: string;
  email: string;
  status: string;
  updateCount: number;
  error: string;
}

const STATUS_RANK: Record<string, number> = { failed: 2, sent: 1, skipped_empty: 0 };
const COLS = {
  sent: (r: DeliveryRowView) => r.sentAt,
  email: (r: DeliveryRowView) => r.email,
  status: (r: DeliveryRowView) => STATUS_RANK[r.status] ?? -1,
  count: (r: DeliveryRowView) => r.updateCount,
  error: (r: DeliveryRowView) => r.error || null,
};

export default function DeliveriesTable({ rows }: { rows: DeliveryRowView[] }) {
  const srt = useSort(rows, COLS, { key: "sent", dir: "desc" });
  return (
    <div className="table-wrap">
      <table className="admin-table">
        <thead><tr>{srt.th("sent", "시각")}{srt.th("email", "이메일")}{srt.th("status", "상태", { title: "실패 → 성공 → 해당없음 순" })}{srt.th("count", "항목 수", { num: true })}{srt.th("error", "오류")}</tr></thead>
        <tbody>
          {srt.sorted.map((x) => (
            <tr key={x.key}><td>{x.sentLabel}</td><td>{x.email}</td><td><span className={`status ${x.status}`}>{x.status}</span></td><td className="num">{x.updateCount}</td><td className="err">{x.error}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
