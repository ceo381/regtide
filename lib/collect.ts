import { supabaseAdmin } from "@/lib/supabase";
import { allAdapters as defaultAdapters, type RawUpdate, type SourceAdapter } from "@/lib/sources";
import { isFetchResult } from "@/lib/sources/types";
import { HttpError } from "@/lib/sources/types";

/** 크론이 매번 되돌아보는 수집 기간(일). 주 1회 실행 + 여유 1일 */
export const COLLECT_LOOKBACK_DAYS = 8;

export interface CollectResult {
  fetched: number;
  inserted: number;
  /** 소스별 가져온 건수(필터 후). 0건인 소스를 운영 리포트에서 바로 확인하기 위함 */
  bySource: Record<string, number>;
  /** 소스별 원본 건수(필터 전). 피드 자체가 비었는지(차단·구조 변경) 와 "의료기기 항목이 없었을 뿐"을 구분 */
  rawBySource: Record<string, number>;
  /** 사이트 차단(403)·URL 변경(404) 등으로 건너뛴 소스. 파이프라인은 계속 진행됨 */
  skipped: { source: string; reason: string }[];
  errors: { source: string; error: string }[];
}

/** DISABLED_SOURCES="page_watch:iso,law_go_kr" 처럼 콤마로 나열하면 해당 소스를 건너뜀 */
export function enabled(adapters: SourceAdapter[]): SourceAdapter[] {
  const off = new Set((process.env.DISABLED_SOURCES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  // 설정이 없어 동작할 수 없는 소스는 "0건"이 아니라 "비활성"으로 취급 (상태 점검 오탐 방지)
  if (!(process.env.LAW_GO_KR_OC ?? "").trim()) off.add("law_go_kr");
  return adapters.filter((a) => !off.has(a.key));
}

/** 어댑터 하나가 응답을 멈춰도 전체 수집이 크론 시간 제한에 걸리지 않도록 상한을 둔다 */
const ADAPTER_DEADLINE_MS = 40_000;
function withDeadline<T>(p: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: ${ADAPTER_DEADLINE_MS / 1000}초 내 응답 없음 (타임아웃)`)), ADAPTER_DEADLINE_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** 모든 소스에서 since 이후 항목을 수집하여 updates 테이블에 신규 항목만 저장 */
export async function collectUpdates(since: Date, adapters: SourceAdapter[] = defaultAdapters()): Promise<CollectResult> {
  const sb = supabaseAdmin();
  const result: CollectResult = { fetched: 0, inserted: 0, bySource: {}, rawBySource: {}, skipped: [], errors: [] };
  adapters = enabled(adapters);

  const settled = await Promise.allSettled(
    adapters.map(async (a) => {
      const r = await withDeadline(a.fetch(since), a.label);
      const fr = isFetchResult(r) ? r : { items: r, rawCount: undefined, commit: undefined };
      return { key: a.key, items: fr.items, rawCount: fr.rawCount ?? fr.items.length, commit: fr.commit };
    }),
  );

  const rows: RawUpdate[] = [];
  const commits: { key: string; commit: () => Promise<void> }[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      rows.push(...s.value.items);
      // 같은 소스 키를 여러 어댑터가 공유(ISO 규격별 페이지 등) → 덮어쓰지 않고 합산
      result.bySource[s.value.key] = (result.bySource[s.value.key] ?? 0) + s.value.items.length;
      result.rawBySource[s.value.key] = (result.rawBySource[s.value.key] ?? 0) + s.value.rawCount;
      if (s.value.commit) commits.push({ key: s.value.key, commit: s.value.commit });
      return;
    }
    const e = s.reason;
    if (e instanceof HttpError && (e.status === 403 || e.status === 404 || e.status === 429)) {
      const why = e.status === 403 ? "사이트가 자동화 접근을 차단함(403)" : e.status === 404 ? "페이지 URL 변경됨(404)" : "요청 제한(429)";
      result.skipped.push({ source: `${adapters[i].key} (${adapters[i].label})`, reason: `${why} — ${e.url}` });
    } else {
      result.errors.push({ source: adapters[i].key, error: String(e?.message ?? e) });
    }
  });
  result.fetched = rows.length;
  // 변경분이 없어도 페이지 감시 스냅샷은 갱신되어야 함 (변경 없음 = 기준 유지, 최초 = 기준 생성)
  const runCommits = async () => {
    for (const c of commits) {
      try { await c.commit(); } catch (e) { result.errors.push({ source: c.key, error: String((e as Error).message ?? e) }); }
    }
  };
  if (rows.length === 0) { await runCommits(); await saveLastCollect(sb, since, result); return result; }

  // 같은 (source, external_id)가 한 배치 안에 중복되면 upsert가 실패하므로 제거
  const uniq = new Map<string, RawUpdate>();
  for (const r of rows) uniq.set(`${r.source}\u0000${r.externalId}`, r);

  const payload = [...uniq.values()].map((r) => ({
    source: r.source,
    external_id: r.externalId,
    jurisdiction: r.jurisdiction,
    title: r.title,
    url: r.url ?? null,
    published_at: r.publishedAt?.toISOString() ?? null,
    raw: r.raw ?? null,
  }));

  // 500개씩 나눠 삽입, 이미 있는 건 무시
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { data, error } = await sb
      .from("updates")
      .upsert(chunk, { onConflict: "source,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) result.errors.push({ source: "db", error: error.message });
    else result.inserted += data?.length ?? 0;
  }
  // 변경분 저장이 실패한 경우 스냅샷을 옮기지 않는다 → 다음 실행에서 같은 변경을 다시 감지 (영구 누락 방지)
  if (!result.errors.some((e) => e.source === "db")) await runCommits();
  else result.errors.push({ source: "page_watch", error: "변경분 저장 실패로 페이지 스냅샷 갱신을 보류했습니다 (다음 실행에서 재감지)" });
  await saveLastCollect(sb, since, result);
  return result;
}

const LAST_COLLECT_KEY = "admin:last_collect";

/** 마지막 수집 결과를 page_snapshots 에 저장 (운영 리포트의 "소스 상태" 표시용). 실패해도 수집 결과에는 영향 없음 */
export interface CollectHistoryEntry { ranAt: string; bySource: Record<string, number>; rawBySource?: Record<string, number>; errors: number; skipped: number }
const HISTORY_MAX = 30;

async function saveLastCollect(sb: ReturnType<typeof supabaseAdmin>, since: Date, r: CollectResult) {
  try {
    // 이전 이력(최근 30회)을 이어 붙여 "특정 소스가 N회 연속 0건" 같은 이상을 감지할 수 있게 함
    let history: CollectHistoryEntry[] = [];
    try {
      const prev = await readLastCollect();
      history = prev?.history ?? [];
    } catch { /* 첫 실행 */ }
    history.push({ ranAt: new Date().toISOString(), bySource: r.bySource, rawBySource: r.rawBySource, errors: r.errors.length, skipped: r.skipped.length });
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
    const content = JSON.stringify({ ranAt: new Date().toISOString(), since: since.toISOString(), ...r, history });
    await sb.from("page_snapshots").upsert({ source_key: LAST_COLLECT_KEY, content_hash: String(content.length), content, fetched_at: new Date().toISOString() }, { onConflict: "source_key" });
  } catch (e) {
    console.error("[collect] saveLastCollect failed:", (e as Error).message);
  }
}

export type LastCollect = CollectResult & { ranAt: string; since: string; history?: CollectHistoryEntry[] };

/**
 * 소스별 연속 0건 횟수 (최근 이력 기준).
 *  - 원본 건수(rawBySource, 필터 전)가 있으면 그것을 기준으로 한다: 피드 자체가 비었을 때만 0 으로 센다.
 *    (의료기기 항목이 없어 필터 후 0건인 것은 정상이므로 경보 대상이 아님)
 *  - 페이지 감시 소스는 변경 없으면 0이 정상이므로 호출측에서 구분
 */
export function consecutiveZeroRuns(history: CollectHistoryEntry[] | undefined, source: string): number {
  if (!history?.length) return 0;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    const v = h.rawBySource?.[source] ?? h.bySource?.[source];
    if (v === undefined) break; // 그 실행에서 소스가 없었음(비활성/오류) → 연속 집계 중단
    if (v !== 0) break;
    n++;
  }
  return n;
}

/** 이력에서 한 번이라도 원본 건수가 0보다 컸던 소스 (한 번도 없던 소스의 0건은 "조용해짐"이 아니라 미확인) */
export function everHadItems(history: CollectHistoryEntry[] | undefined, source: string): boolean {
  return !!history?.some((h) => ((h.rawBySource?.[source] ?? h.bySource?.[source]) ?? 0) > 0);
}

export async function readLastCollect(): Promise<LastCollect | null> {
  const { data } = await supabaseAdmin().from("page_snapshots").select("content").eq("source_key", LAST_COLLECT_KEY).maybeSingle();
  const c = (data as { content?: string } | null)?.content;
  if (!c) return null;
  try { return JSON.parse(c); } catch { return null; }
}
