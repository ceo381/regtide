import type { Jurisdiction } from "@/lib/catalog";

/** 수집 어댑터가 반환하는 정규화된 업데이트 항목 */
export interface RawUpdate {
  source: string;        // 예: "mfds_rss:data0009"
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
  fetch(since: Date): Promise<RawUpdate[]>;
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
