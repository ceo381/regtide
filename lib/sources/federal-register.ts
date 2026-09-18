import { truncate, type RawUpdate, type SourceAdapter } from "./types";

/**
 * Federal Register API v1 (https://www.federalregister.gov/developers/documentation/api/v1)
 * FDA 발행 문서 중 medical device 관련 Rule / Proposed Rule / Notice 를 수집합니다.
 */
interface FRDoc {
  document_number: string;
  title: string;
  type: string;
  abstract?: string | null;
  html_url: string;
  publication_date: string;
}

export const federalRegisterAdapter: SourceAdapter = {
  key: "federal_register",
  label: "US Federal Register (FDA)",
  async fetch(since) {
    const gte = since.toISOString().slice(0, 10);
    const out: RawUpdate[] = [];
    let page = 1;
    while (page <= 5) {
      const params = new URLSearchParams();
      params.append("conditions[agencies][]", "food-and-drug-administration");
      params.append("conditions[term]", '"medical device" OR "medical devices" OR "in vitro diagnostic"');
      params.append("conditions[publication_date][gte]", gte);
      params.append("per_page", "100");
      params.append("page", String(page));
      params.append("order", "newest");
      for (const f of ["document_number", "title", "type", "abstract", "html_url", "publication_date"]) {
        params.append("fields[]", f);
      }
      const res = await fetch(`https://www.federalregister.gov/api/v1/documents.json?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Federal Register HTTP ${res.status}`);
      const json = (await res.json()) as { results?: FRDoc[]; next_page_url?: string | null };
      for (const d of json.results ?? []) {
        out.push({
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
    return out;
  },
};
