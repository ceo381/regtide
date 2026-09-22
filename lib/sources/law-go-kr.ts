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
    // 환경변수에 따옴표·공백이 섞여 들어오는 실수를 흡수
    const oc = (process.env.LAW_GO_KR_OC ?? "").trim().replace(/^["']+|["']+$/g, "");
    if (!oc) return [];
    const masked = oc.length <= 4 ? `${oc[0]}***` : `${oc.slice(0, 2)}***${oc.slice(-2)}`;
    const out: RawUpdate[] = [];
    const seen = new Set<string>();
    // "오류 없이 0건" 방지: 질의별 실패를 모아 두고, 정상 응답이 하나도 없으면 예외로 드러낸다
    const failures: string[] = [];
    let okCount = 0;

    const jobs: { target: "law" | "admrul"; q: string }[] = [];
    for (const target of ["law", "admrul"] as const) for (const q of QUERIES) jobs.push({ target, q });
    // 6개 질의를 병렬로 (순차 실행 시 최악 120초 → 크론 시간 제한 위험)
    const results = await Promise.all(jobs.map(async ({ target, q }) => {
      {
        const params = new URLSearchParams({ OC: oc, target, type: "JSON", query: q, display: "100", sort: "ddes" });
        // 신청 시 등록한 도메인을 Referer 로 실어 보냄 (도메인 검사를 하는 경우 대비). LAW_GO_KR_REFERER 로 덮어쓸 수 있음
        const referer = (process.env.LAW_GO_KR_REFERER || process.env.NEXT_PUBLIC_SITE_URL || "https://regtide-pi.vercel.app").replace(/\/?$/, "/");
        const res = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?${params}`, {
          cache: "no-store",
          headers: { accept: "application/json,text/plain,*/*", referer, origin: referer.replace(/\/$/, ""), "user-agent": "Mozilla/5.0 (compatible; RegTide/1.0; +" + referer + ")" },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) { failures.push(`${target}/${q}: HTTP ${res.status}`); return null; }
        const text = await res.text();
        let json: Record<string, unknown> | null = null;
        try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
        if (!json) {
          // OC 미승인·오타 시 law.go.kr 은 200 으로 HTML 안내 페이지를 돌려준다
          const hint = /인증|승인|권한|OC/.test(text) ? "OC(인증키) 미승인 또는 오타 가능성" : "JSON 이 아닌 응답";
          failures.push(`${target}/${q}: ${hint} — ${text.replace(/\s+/g, " ").slice(0, 100)}`);
          return null;
        }
        const root = (json.LawSearch ?? json.AdmRulSearch ?? json) as Record<string, unknown>;
        const rows = root[target === "law" ? "law" : "admrul"];
        if (rows === undefined && !("totalCnt" in root)) {
          failures.push(`${target}/${q}: 알 수 없는 응답 구조 — ${JSON.stringify(json).slice(0, 100)}`);
          return null;
        }
        okCount++;
        return { target, rows };
      }
    }));

    for (const r of results) {
      if (!r) continue;
      const { target, rows } = r;
      {
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
    if (okCount === 0 && failures.length) {
      throw new Error(`국가법령정보 API 응답 없음 (${failures.length}건 실패, OC=${masked}, 길이 ${oc.length}). 첫 오류: ${failures[0]} — 브라우저에서 https://www.law.go.kr/DRF/lawSearch.do?OC=<OC>&target=law&type=JSON&query=의료기기 를 열어 OC 값을 확인하세요`);
    }
    if (failures.length) {
      // 일부만 실패해도 조용히 넘기지 않는다 — 특정 target(예: 행정규칙=식약처 고시) 전체가 빠질 수 있으므로 상태 점검에 경고로 올린다
      console.warn(`[law_go_kr] 일부 질의 실패 ${failures.length}/${failures.length + okCount}:`, failures.slice(0, 3));
      return { items: out, rawCount: out.length, warnings: [`국가법령정보 질의 ${failures.length}/${failures.length + okCount}건 실패 — ${failures[0]}`] };
    }
    return out;
  },
};
