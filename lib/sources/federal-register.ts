import { FETCH_HEADERS, truncate, type RawUpdate, type SourceAdapter } from "./types";

/**
 * Federal Register API v1 (https://www.federalregister.gov/developers/documentation/api/v1)
 * FDA 발행 문서 중 medical device / IVD 관련 Rule / Proposed Rule / Notice 를 수집합니다.
 *
 * 운영 중 "오류 없이 0건" 이 관측되어(2026-09-22) 다음과 같이 보수적으로 바꿨습니다.
 *  - 검색어를 OR 결합 한 줄 대신 **검색어별로 따로 질의**하고 document_number 로 중복 제거 (검색 문법 의존 제거)
 *  - 날짜를 API 문서 예시 형식(MM/DD/YYYY)으로 전달
 *  - 응답에 count 필드가 없거나(비정상 JSON), count > 0 인데 results 가 비면 예외를 던져 운영 리포트 errors 에 드러나게 함
 */
interface FRDoc {
  document_number: string;
  title: string;
  type: string;
  abstract?: string | null;
  html_url: string;
  publication_date: string;
}
interface FRResponse {
  count?: number;
  results?: FRDoc[];
  next_page_url?: string | null;
  errors?: unknown;
}

const TERMS = ['"medical device"', '"medical devices"', '"in vitro diagnostic"'];
const TYPES = ["RULE", "PRORULE", "NOTICE"];

function mmddyyyy(d: Date) {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${m}/${day}/${d.getUTCFullYear()}`;
}

export const federalRegisterAdapter: SourceAdapter = {
  key: "federal_register",
  label: "US Federal Register (FDA)",
  async fetch(since) {
    const gte = mmddyyyy(since);
    const byId = new Map<string, RawUpdate>();

    for (const term of TERMS) {
      let page = 1;
      while (page <= 5) {
        const params = new URLSearchParams();
        params.append("conditions[agencies][]", "food-and-drug-administration");
        params.append("conditions[term]", term);
        params.append("conditions[publication_date][gte]", gte);
        for (const t of TYPES) params.append("conditions[type][]", t);
        params.append("per_page", "100");
        params.append("page", String(page));
        params.append("order", "newest");
        for (const f of ["document_number", "title", "type", "abstract", "html_url", "publication_date"]) params.append("fields[]", f);

        const url = `https://www.federalregister.gov/api/v1/documents.json?${params}`;
        const res = await fetch(url, { cache: "no-store", headers: { ...FETCH_HEADERS, accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
        if (!res.ok) throw new Error(`Federal Register HTTP ${res.status} (${term})`);
        const text = await res.text();
        let json: FRResponse;
        try {
          json = JSON.parse(text) as FRResponse;
        } catch {
          throw new Error(`Federal Register: JSON 이 아닌 응답 (${term}): ${text.slice(0, 120)}`);
        }
        if (typeof json.count !== "number") {
          throw new Error(`Federal Register: count 필드 없음 (${term}): ${text.slice(0, 160)}`);
        }
        const results = json.results ?? [];
        if (json.count > 0 && results.length === 0 && page === 1) {
          throw new Error(`Federal Register: count=${json.count} 인데 results 가 비어 있음 (${term}) — 질의 파라미터 확인 필요`);
        }
        for (const d of results) {
          if (byId.has(d.document_number)) continue;
          byId.set(d.document_number, {
            source: "federal_register",
            externalId: d.document_number,
            jurisdiction: "US",
            title: `[${d.type}] ${d.title}`,
            url: d.html_url,
            publishedAt: new Date(d.publication_date),
            raw: truncate(d.abstract ?? undefined),
          });
        }
        if (!json.next_page_url) break;
        page++;
      }
    }
    return [...byId.values()];
  },
};
