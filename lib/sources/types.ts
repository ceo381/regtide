import type { Jurisdiction } from "@/lib/catalog";

/** 수집 어댑터가 반환하는 정규화된 업데이트 항목 */
export interface RawUpdate {
  source: string;        // 예: "mfds_rss:data0009", "mfds_emedi:recall"
  externalId: string;    // 소스 내 고유 키
  jurisdiction: Jurisdiction;
  title: string;
  url?: string;
  publishedAt?: Date;
  raw?: string;          // 요약 입력용 발췌 (최대 ~4,000자)
}

export interface SourceAdapter {
  key: string;
  label: string;
  fetch(since: Date): Promise<RawUpdate[] | FetchResult>;
}

/**
 * 어댑터가 "상태 커밋"을 미뤄야 할 때 쓰는 확장 반환형.
 * 페이지 감시처럼 기준 스냅샷을 갱신하는 소스는, 변경분이 DB 에 저장된 **뒤에** 스냅샷을 옮겨야
 * 저장 실패·타임아웃 시 변경분이 영구 누락되지 않는다. collect 가 upsert 성공 후 commit() 을 호출한다.
 */
export interface FetchResult {
  items: RawUpdate[];
  /** 수집 전 원본 건수(필터 전). 상태 점검의 "0건" 판정에 사용 */
  rawCount?: number;
  commit?: () => Promise<void>;
  /** 일부 질의·페이지가 실패했지만 나머지는 성공한 경우의 경고. collect 가 상태 점검에 그대로 올린다 */
  warnings?: string[];
}
/** 어댑터 반환값을 항목 배열로 정규화 (스크립트·테스트용) */
export function itemsOf(v: RawUpdate[] | FetchResult): RawUpdate[] {
  return Array.isArray(v) ? v : v.items;
}
export function isFetchResult(v: RawUpdate[] | FetchResult): v is FetchResult {
  return !Array.isArray(v) && typeof v === "object" && Array.isArray((v as FetchResult).items);
}

/** 일부 사이트(iso.org 등)는 비브라우저 UA를 차단하므로 일반 브라우저 헤더를 사용 */
export const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
};

export class HttpError extends Error {
  constructor(public url: string, public status: number) {
    super(`${url} → HTTP ${status}`);
  }
}

export async function fetchText(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: { ...FETCH_HEADERS, ...(init?.headers ?? {}) }, signal: ctrl.signal, cache: "no-store", redirect: "follow" });
    if (!res.ok) throw new HttpError(url, res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s: string | undefined, n = 4000): string | undefined {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + " …" : s;
}
