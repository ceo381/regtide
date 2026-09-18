/**
 * 테스트용 인메모리 Supabase 대체 클라이언트.
 * 이 프로젝트가 사용하는 체이닝 메서드만 구현합니다:
 *   from().select/insert/upsert/update/delete, eq/is/not/gte/lt, order, limit, maybeSingle
 */
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeDB {
  tables: Record<string, Row[]>;
  client: unknown;
}

const UNIQUE: Record<string, string[][]> = {
  subscribers: [["email"], ["unsubscribe_token"]],
  updates: [["source", "external_id"]],
  page_snapshots: [["source_key"]],
  deliveries: [["subscriber_id", "week_start"]],
};

function defaults(table: string, row: Row): Row {
  const now = new Date().toISOString();
  const base: Row = { id: randomUUID(), created_at: now, ...row };
  if (table === "subscribers") {
    base.unsubscribe_token ??= randomUUID().replace(/-/g, "");
    base.active ??= true;
    base.products ??= [];
    base.catalog_ids ??= [];
    base.last_sent_at ??= null;
  }
  if (table === "updates") {
    base.catalog_ids ??= [];
    base.matched_keywords ??= [];
    base.summary_ko ??= null;
    base.impact ??= null;
    base.classified_at ??= null;
  }
  if (table === "deliveries") base.sent_at ??= now;
  return base;
}

export function createFakeSupabase(): FakeDB {
  const tables: Record<string, Row[]> = { subscribers: [], updates: [], page_snapshots: [], deliveries: [] };

  function from(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Filter[] = [];
    let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let patch: Row = {};
    let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    let orderBy: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    let single = false;
    let wantSelect = false;

    const matchUnique = (a: Row, b: Row, cols: string[]) => cols.every((c) => a[c] === b[c]);

    const exec = () => {
      const all = rows();
      const pass = (r: Row) => filters.every((f) => f(r));
      let result: Row[] = [];

      if (op === "select") {
        result = all.filter(pass);
      } else if (op === "insert") {
        for (const p of payload) {
          const r = defaults(table, p);
          for (const cols of UNIQUE[table] ?? []) {
            if (all.some((x) => matchUnique(x, r, cols))) return { data: null, error: { message: `duplicate key value violates unique constraint (${cols.join(",")})` } };
          }
          all.push(r);
          result.push(r);
        }
      } else if (op === "upsert") {
        const cols = upsertOpts.onConflict?.split(",").map((s) => s.trim()) ?? UNIQUE[table]?.[0] ?? ["id"];
        for (const p of payload) {
          const r = defaults(table, p);
          const idx = all.findIndex((x) => matchUnique(x, r, cols));
          if (idx >= 0) {
            if (upsertOpts.ignoreDuplicates) continue;
            all[idx] = { ...all[idx], ...p };
            result.push(all[idx]);
          } else {
            all.push(r);
            result.push(r);
          }
        }
      } else if (op === "update") {
        for (const r of all) if (pass(r)) { Object.assign(r, patch); result.push(r); }
      } else if (op === "delete") {
        const keep: Row[] = [];
        for (const r of all) (pass(r) ? result : keep).push(r);
        tables[table] = keep;
      }

      if (orderBy) {
        const { col, asc } = orderBy;
        result.sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -1 : 1) * (asc ? 1 : -1));
      }
      if (lim != null) result = result.slice(0, lim);
      if (single) return { data: result[0] ?? null, error: null };
      if (op !== "select" && !wantSelect) return { data: null, error: null };
      return { data: result.map((r) => ({ ...r })), error: null };
    };

    const b: any = {
      select() { if (op === "select") op = "select"; else wantSelect = true; return b; },
      insert(p: Row | Row[]) { op = "insert"; payload = Array.isArray(p) ? p : [p]; return b; },
      upsert(p: Row | Row[], o: typeof upsertOpts = {}) { op = "upsert"; payload = Array.isArray(p) ? p : [p]; upsertOpts = o; return b; },
      update(p: Row) { op = "update"; patch = p; return b; },
      delete() { op = "delete"; return b; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b; },
      is(c: string, v: unknown) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
      not(c: string, _o: string, v: unknown) { filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return b; },
      gte(c: string, v: string) { filters.push((r) => String(r[c]) >= v); return b; },
      lt(c: string, v: string) { filters.push((r) => String(r[c]) < v); return b; },
      order(c: string, o: { ascending?: boolean } = {}) { orderBy = { col: c, asc: o.ascending !== false }; return b; },
      limit(n: number) { lim = n; return b; },
      maybeSingle() { single = true; return b; },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve().then(exec).then(res, rej); },
    };
    return b;
  }

  return { tables, client: { from } };
}
