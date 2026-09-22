import { FETCH_HEADERS, HttpError, stripHtml, truncate, type FetchResult, type RawUpdate, type SourceAdapter } from "./types";

/**
 * 식약처 의료기기안심책방(emedi.mfds.go.kr) — 회수/판매중지 · 행정처분
 *  RSS(plc0139/plc0168)가 오류 페이지만 돌려주는 상태가 이어져, 원 데이터가 있는 emedi 검색 화면을 직접 읽는다.
 *  - 회수: POST /recall/list/MNU20265  (보고일자 범위, 10건/페이지, "총 N건")  항목키 deptReceiptNo
 *  - 처분: POST /disps/MNU20266        (처분일자 범위, 10건/페이지, "총 N건")  항목키 portalAdmDispsSeq
 *  목록은 날짜순이 아니므로(회수) 총 건수를 기준으로 끝까지 페이지를 넘긴다. 상세 페이지는 발췌(회수사유·위반내용)를 위해
 *  항목당 1회 읽되, 실패해도 목록 정보만으로 항목을 남긴다(누락 방지 우선).
 */
const BASE = "https://emedi.mfds.go.kr";
const PAGE_SIZE = 10;
const MAX_PAGES = 20; // 200건 — 14일 창에서는 넉넉
const DETAIL_LIMIT = 40; // 상세 페이지 조회 상한(실행 시간 보호). 넘으면 목록 정보만 저장

export const EMEDI_SOURCES = {
  recall: { key: "mfds_emedi:recall", label: "식약처 의료기기 회수/판매중지", name: "의료기기안심책방 회수/판매중지", url: `${BASE}/recall/list/MNU20265` },
  disps: { key: "mfds_emedi:disps", label: "식약처 의료기기 행정처분", name: "의료기기안심책방 행정처분", url: `${BASE}/disps/MNU20266` },
} as const;

function kstDate(d: Date) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function parseKstDate(s: string | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00+09:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

export interface EmediRow { id: string; cells: string[]; href: string }

/** 검색 결과 HTML → 표 행 (id 는 링크의 idParam 값) */
export function parseEmediTable(html: string, idParam: string): { rows: EmediRow[]; total: number | null } {
  const rows: EmediRow[] = [];
  const tm = /총\s*<b>\s*([\d,]+)\s*<\/b>\s*건/.exec(html) ?? /총\s*([\d,]+)\s*건/.exec(html);
  const total = tm ? Number(tm[1].replace(/,/g, "")) : null;
  const tbody = /<tbody[\s\S]*?<\/tbody>/i.exec(html)?.[0] ?? "";
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(tbody))) {
    const tr = m[1];
    const hrefM = /href="([^"]*)"/.exec(tr);
    if (!hrefM) continue;
    const href = hrefM[1].replace(/&amp;/g, "&");
    const idM = new RegExp(`[?&]${idParam}=([^&"]+)`).exec(href);
    if (!idM) continue;
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripHtml(c[1]).replace(/\s+/g, " ").trim());
    rows.push({ id: decodeURIComponent(idM[1]).trim(), cells, href });
  }
  return { rows, total };
}

/** 상세 페이지의 th/td 쌍 → 필드 맵 (같은 th 가 여러 번이면 첫 값) */
export function parseEmediDetail(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const k = stripHtml(m[1]).replace(/\s+/g, " ").trim();
    const v = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (k && v && !(k in out)) out[k] = v;
  }
  return out;
}

export interface EmediHttp {
  post(path: string, form: Record<string, string>): Promise<string>;
  get(path: string): Promise<string>;
}

/** 세션 쿠키가 필요한 경우를 대비해 첫 GET 의 Set-Cookie 를 이후 요청에 실어 보낸다 */
export function emediHttp(timeoutMs = 20_000): EmediHttp {
  let cookie = "";
  async function req(path: string, init: RequestInit): Promise<string> {
    const url = `${BASE}${path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers: { ...FETCH_HEADERS, Referer: `${BASE}/`, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) }, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(/,(?=[^;]+=[^;]+)/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
      if (!res.ok) throw new HttpError(url, res.status);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }
  return {
    get: (path) => req(path, { method: "GET" }),
    post: (path, form) => req(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() }),
  };
}

interface Spec {
  key: string;
  listPath: string;
  idParam: string;
  form(start: string, end: string, page: number): Record<string, string>;
  /** 표 행 → 항목 (날짜 필터·제목 구성). null 이면 제외 */
  toItem(row: EmediRow, since: Date, detail?: Record<string, string>): RawUpdate | null;
  detailPath(id: string): string;
  /** 검색 시작일: since 보다 얼마나 앞당길지(일). 공개일이 보고/처분일보다 늦는 경우를 흡수 */
  lookbackDays: number;
}

async function collect(spec: Spec, since: Date, http: EmediHttp, now = new Date()): Promise<FetchResult> {
  const warnings: string[] = [];
  const start = kstDate(new Date(since.getTime() - spec.lookbackDays * 86400_000));
  const end = kstDate(new Date(now.getTime() + 86400_000));
  const rows: EmediRow[] = [];
  const seenIds = new Set<string>();
  let total: number | null = null;
  // 첫 요청은 GET 으로 세션을 얻는다(필요 없는 경우에도 무해)
  try { await http.get(spec.listPath); } catch { /* 목록 POST 에서 다시 시도 */ }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await http.post(spec.listPath, spec.form(start, end, page));
    const parsed = parseEmediTable(html, spec.idParam);
    if (page === 1) {
      total = parsed.total;
      if (!parsed.rows.length && total == null && !/조회된?\s*(결과|데이터|내역)가?\s*없습니다|검색결과가 없습니다/.test(html)) {
        throw new Error(`${spec.key}: 검색 결과 표를 해석하지 못함 (화면 구조 변경 가능성)`);
      }
    }
    // 같은 페이지가 반복되면(페이징 파라미터 무시) 무한히 넘기지 않고 중단 + 경고
    const fresh = parsed.rows.filter((r) => !seenIds.has(r.id));
    if (page > 1 && parsed.rows.length && !fresh.length) {
      warnings.push(`${spec.key}: ${page}페이지가 이전 페이지와 같음 — 페이징이 동작하지 않아 ${rows.length}건까지만 수집`);
      break;
    }
    for (const r of fresh) seenIds.add(r.id);
    rows.push(...fresh);
    const done = !parsed.rows.length || parsed.rows.length < PAGE_SIZE || (total != null && rows.length >= total);
    if (done) break;
    if (page === MAX_PAGES) warnings.push(`${spec.key}: ${MAX_PAGES}페이지 상한 도달 (총 ${total ?? "?"}건 중 ${rows.length}건)`);
  }
  // 같은 id 가 여러 페이지에 걸쳐 중복 노출될 수 있으므로 정리
  const uniq = new Map<string, EmediRow>();
  for (const r of rows) if (!uniq.has(r.id)) uniq.set(r.id, r);

  const items: RawUpdate[] = [];
  let detailFails = 0, detailCount = 0;
  for (const r of uniq.values()) {
    const base = spec.toItem(r, since);
    if (!base) continue;
    let detail: Record<string, string> | undefined;
    if (detailCount < DETAIL_LIMIT) {
      detailCount++;
      try { detail = parseEmediDetail(await http.get(spec.detailPath(r.id))); } catch { detailFails++; }
    }
    items.push(spec.toItem(r, since, detail) ?? base);
  }
  if (detailFails) warnings.push(`${spec.key}: 상세 페이지 ${detailFails}건 조회 실패 — 목록 정보만 저장`);
  if (detailCount >= DETAIL_LIMIT && uniq.size > DETAIL_LIMIT) warnings.push(`${spec.key}: 상세 조회 상한(${DETAIL_LIMIT}건) 초과 — 일부는 목록 정보만 저장`);
  return { items, rawCount: uniq.size, warnings };
}

/** 회수/판매중지 — 표: 순번, 업체명, 품목명, 허가번호, 정부/영업자 구분, 진행 여부, 보고일자 */
export const RECALL_SPEC: Spec = {
  key: EMEDI_SOURCES.recall.key,
  listPath: "/recall/list/MNU20265",
  idParam: "deptReceiptNo",
  lookbackDays: 7,
  form: (start, end, page) => ({ mid: "MNU20265", startPlanSbmsnDt: start, endPlanSbmsnDt: end, pageNum: String(page), searchYn: page === 1 ? "true" : "", searchAfKey: "" }),
  detailPath: (id) => `/recall/view/MNU20265?mid=MNU20265&deptReceiptNo=${encodeURIComponent(id)}`,
  toItem(row, since, d) {
    const [, company, product, permit, kind, status, reported] = row.cells;
    const date = parseKstDate(reported);
    if (date && date < since) return null;
    if (!product && !company) return null;
    const title = `[회수·판매중지] ${product || "품목명 미표기"} — ${company || "업체명 미표기"}`;
    const lines = [
      "식약처 의료기기 회수·판매중지 공표 (의료기기안심책방)",
      `업체명: ${company}`, `품목명: ${product}`, permit ? `품목허가(인증·신고)번호: ${permit}` : "", kind ? `회수 구분: ${kind}` : "", status ? `회수 진행 여부: ${status}` : "", reported ? `보고일자: ${reported}` : "",
      d?.["회수사유"] ? `회수사유: ${d["회수사유"]}` : "", d?.["위해성정도"] ? `위해성정도: ${d["위해성정도"]}` : "", d?.["회수방법"] ? `회수방법: ${d["회수방법"]}` : "", d?.["소비자가 취해야 하는 행동"] ? `소비자가 취해야 하는 행동: ${d["소비자가 취해야 하는 행동"]}` : "",
    ].filter(Boolean);
    return { source: this.key, externalId: row.id, jurisdiction: "KR", title, url: `${BASE}${this.detailPath(row.id)}`, publishedAt: date, raw: truncate(lines.join("\n")) };
  },
};

/** 행정처분 — 표: 순번, 업체명, 제품명[허가번호], 처분명(말줄임), 처분일자, 공개일자 */
export const DISPS_SPEC: Spec = {
  key: EMEDI_SOURCES.disps.key,
  listPath: "/disps/MNU20266",
  idParam: "portalAdmDispsSeq",
  lookbackDays: 45, // 처분일 기준 검색이므로, 공개가 늦은 건을 놓치지 않도록 넉넉히
  // searchYn=true 는 검색을 새로 시작해 항상 1페이지를 돌려주므로(실측), 2페이지부터는 비운다 (회수와 동일)
  form: (start, end, page) => ({ pageNum: String(page), searchYn: page === 1 ? "true" : "", dispsStartDate: start, dispsEndDate: end, entpName: "", prdlNmCn: "", prdlNmNo: "", dispsName: "" }),
  detailPath: (id) => `/disps/view/MNU20266?portalAdmDispsSeq=${encodeURIComponent(id)}`,
  toItem(row, since, d) {
    const [, company, product, dispsShort, dispsDate, openDate] = row.cells;
    // 기준일은 공개일자 (처분일은 공개보다 앞서므로 처분일로 자르면 늦게 공개된 건을 놓친다)
    const date = parseKstDate(openDate) ?? parseKstDate(dispsDate);
    if (date && date < since) return null;
    if (!company) return null;
    const disps = d?.["처분명"] || dispsShort;
    const title = `[행정처분] ${disps || "처분명 미표기"} — ${company}`;
    const lines = [
      "식약처 의료기기 행정처분 공표 (의료기기안심책방)",
      `업체명: ${company}`, product && product !== "-" ? `제품명[허가번호]: ${product}` : "", d?.["업종명"] ? `업종: ${d["업종명"]}` : "", `처분명: ${disps}`, dispsDate ? `처분일자: ${dispsDate}` : "", d?.["처분기간"] ? `처분기간: ${d["처분기간"]}` : "", openDate ? `공개일자: ${openDate}` : "",
      d?.["위반법령"] ? `위반법령: ${d["위반법령"]}` : "", d?.["위반내용"] ? `위반내용: ${d["위반내용"]}` : "", d?.["처분내용"] ? `처분내용: ${d["처분내용"]}` : "",
    ].filter(Boolean);
    return { source: this.key, externalId: row.id, jurisdiction: "KR", title, url: `${BASE}${this.detailPath(row.id)}`, publishedAt: date, raw: truncate(lines.join("\n")) };
  },
};

export function emediAdapter(spec: Spec, http?: EmediHttp): SourceAdapter {
  const info = spec.key === RECALL_SPEC.key ? EMEDI_SOURCES.recall : EMEDI_SOURCES.disps;
  return { key: spec.key, label: info.label, fetch: (since) => collect(spec, since, http ?? emediHttp()) };
}

export function emediAdapters(): SourceAdapter[] {
  return [emediAdapter(RECALL_SPEC), emediAdapter(DISPS_SPEC)];
}
