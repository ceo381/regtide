import { type RawUpdate, type SourceAdapter } from "./types";

/**
 * 국가법령정보 공동활용 Open API (https://open.law.go.kr)
 * - 사용 신청 후 발급받은 OC(사용자 ID)를 LAW_GO_KR_OC 환경변수로 설정하면 활성화됩니다.
 * - target=law   : 법령(의료기기법·시행령·시행규칙 등)
 * - target=admrul: 행정규칙(식약처 고시 등)
 * 응답 필드는 API 가이드 기준이며, 누락 시 안전하게 건너뜁니다.
 */
const QUERIES = ["의료기기", "체외진단의료기기", "디지털의료제품"];

function ymd(s: unknown): Date | undefined {
  const v = String(s ?? "").replace(/\D/g, "");
  if (v.length !== 8) return undefined;
  const d = new Date(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00+09:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

function absolute(link: unknown): string | undefined {
  const l = String(link ?? "").trim();
  if (!l) return undefined;
  return l.startsWith("http") ? l : `https://www.law.go.kr${l.startsWith("/") ? "" : "/"}${l}`;
}

export const lawGoKrAdapter: SourceAdapter = {
  key: "law_go_kr",
  label: "국가법령정보센터 (법령·행정규칙)",
  async fetch(since) {
    const oc = process.env.LAW_GO_KR_OC;
    if (!oc) return [];
    const out: RawUpdate[] = [];
    const seen = new Set<string>();

    for (const target of ["law", "admrul"] as const) {
      for (const q of QUERIES) {
        const params = new URLSearchParams({ OC: oc, target, type: "JSON", query: q, display: "100", sort: target === "law" ? "ddes" : "ddes" });
        const res = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?${params}`, { cache: "no-store" });
        if (!res.ok) continue;
        const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!json) continue;
        const root = (json.LawSearch ?? json.AdmRulSearch ?? json) as Record<string, unknown>;
        const rows = root[target === "law" ? "law" : "admrul"];
        const list: Record<string, unknown>[] = Array.isArray(rows) ? rows : rows ? [rows as Record<string, unknown>] : [];
        for (const r of list) {
          const id = String(r["법령일련번호"] ?? r["행정규칙일련번호"] ?? r["법령ID"] ?? "");
          const name = String(r["법령명한글"] ?? r["행정규칙명"] ?? "").trim();
          if (!id || !name || seen.has(`${target}:${id}`)) continue;
          const date = ymd(r["공포일자"] ?? r["발령일자"]);
          if (date && date < since) continue;
          seen.add(`${target}:${id}`);
          const kind = String(r["제개정구분명"] ?? r["법령구분명"] ?? r["행정규칙종류"] ?? "");
          out.push({
            source: "law_go_kr",
            externalId: `${target}:${id}`,
            jurisdiction: "KR",
            title: `${name}${kind ? ` (${kind})` : ""}`,
            url: absolute(r["법령상세링크"] ?? r["행정규칙상세링크"]),
            publishedAt: date,
            raw: [
              `구분: ${target === "law" ? "법령" : "행정규칙"}`,
              `공포/발령일: ${r["공포일자"] ?? r["발령일자"] ?? "-"}`,
              `시행일: ${r["시행일자"] ?? "-"}`,
              `소관부처: ${r["소관부처명"] ?? "-"}`,
            ].join("\n"),
          });
        }
      }
    }
    return out;
  },
};
