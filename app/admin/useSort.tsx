"use client";
import { useMemo, useState, type ReactNode } from "react";

/**
 * 대시보드 표 정렬 — 브라우저에서 즉시 정렬(서버 재요청 없음).
 *   const s = useSort(rows, { email: (r) => r.email, n: (r) => r.count }, { key: "n", dir: "desc" });
 *   <thead><tr>{s.th("email", "이메일")}{s.th("n", "건수", { num: true })}</tr></thead>
 *   {s.sorted.map(...)}
 * 값이 null/undefined/"" 이면 항상 맨 뒤. 숫자는 숫자로, 문자열은 한국어 로케일로 비교.
 * 같은 열을 다시 누르면 방향이 바뀐다. 세 번째 클릭은 정렬 해제(원래 순서).
 */
export type SortVal = string | number | boolean | null | undefined;
export type SortDir = "asc" | "desc";
export interface SortState { key: string; dir: SortDir }

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const isEmpty = (v: SortVal) => v == null || v === "";

function cmp(a: SortVal, b: SortVal) {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1; // 빈 값은 방향과 무관하게 맨 뒤 (아래에서 보정)
  if (isEmpty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/** 순수 정렬 함수 (테스트용으로 분리). 빈 값은 방향과 무관하게 맨 뒤, 동률은 원래 순서 유지 */
export function sortRows<T>(rows: T[], get: (r: T) => SortVal, dir: SortDir): T[] {
  const dirMul = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((x, y) => {
      const ex = isEmpty(x.v), ey = isEmpty(y.v);
      if (ex !== ey) return ex ? 1 : -1;
      return cmp(x.v, y.v) * dirMul || x.i - y.i;
    })
    .map((x) => x.r);
}

export function useSort<T>(rows: T[], cols: Record<string, (r: T) => SortVal>, initial: SortState | null = null) {
  const [sort, setSort] = useState<SortState | null>(initial);

  const sorted = useMemo(() => (sort && cols[sort.key] ? sortRows(rows, cols[sort.key], sort.dir) : rows), [rows, cols, sort]);

  const toggle = (key: string) =>
    setSort((s) => {
      const first = defaultDir(rows, cols[key]);
      const flip = (d: SortDir): SortDir => (d === "asc" ? "desc" : "asc");
      if (!s || s.key !== key) return { key, dir: first }; // 다른 열 → 기본 방향
      if (initial && initial.key === key) {
        // 초기 정렬 열: 초기 방향 → 반대 방향 → 초기 방향 (해제 없음)
        return s.dir === initial.dir ? { key, dir: flip(initial.dir) } : initial;
      }
      if (s.dir === first) return { key, dir: flip(first) }; // 2회: 반대 방향
      return initial ?? null; // 3회: 초기 정렬로 복귀
    });

  const th = (key: string, label: ReactNode, opts: { num?: boolean; title?: string; className?: string } = {}) => {
    const active = sort?.key === key;
    const cls = [opts.num ? "num" : "", "sortable", active ? `sorted ${sort!.dir}` : "", opts.className ?? ""].filter(Boolean).join(" ");
    return (
      <th key={key} className={cls} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} title={opts.title ?? "클릭하여 정렬"}>
        <button type="button" className="sort-btn" onClick={() => toggle(key)}>
          <span>{label}</span>
          <span className="sort-ind" aria-hidden="true">{active ? (sort!.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
        </button>
      </th>
    );
  };

  return { sorted, sort, toggle, th };
}

/** 첫 클릭 방향: 숫자·불리언 열은 큰 값부터, 문자열 열은 가나다순 */
function defaultDir<T>(rows: T[], get: (r: T) => SortVal): SortDir {
  const sample = rows.map(get).find((v) => !isEmpty(v));
  return typeof sample === "number" || typeof sample === "boolean" ? "desc" : "asc";
}
