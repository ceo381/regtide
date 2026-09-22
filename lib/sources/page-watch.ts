import { createHash } from "node:crypto";
import type { Jurisdiction } from "@/lib/catalog";
import { supabaseAdmin } from "@/lib/supabase";
import { fetchText, stripHtml, truncate, type RawUpdate, type SourceAdapter } from "./types";

/**
 * RSS/API가 없는 페이지를 스냅샷과 비교해 "새로 추가된 문장"만 업데이트로 만듭니다.
 * (ISO/IEC 규격 페이지, EU Commission 의료기기 최신소식, 조화규격 목록, FDA 가이던스 목록 등)
 */
export interface PageWatchConfig {
  key: string;             // 예: "iso:13485"
  sourceKey: string;       // 카탈로그 sources와 매칭되는 상위 키. 예: "page_watch:iso"
  label: string;
  url: string;
  jurisdiction: Jurisdiction;
  /** 본문에서 관심 영역만 남기고 싶을 때 (정규식, 첫 매치 그룹 1 사용) */
  extract?: RegExp;
  /** 페이지의 변경 자체가 의미 있는 경우(규격 상태 등) 힌트 텍스트 */
  hint?: string;
}

export const PAGE_WATCH_TARGETS: PageWatchConfig[] = [
  // ── EU ──
  {
    key: "eu:md_latest",
    sourceKey: "page_watch:eu_md_latest",
    label: "EU Commission – Medical devices latest updates",
    url: "https://health.ec.europa.eu/medical-devices-sector/latest-updates_en",
    jurisdiction: "EU",
  },
  {
    key: "eu:mdcg_guidance",
    sourceKey: "page_watch:eu_md_latest",
    label: "EU Commission – MDCG endorsed documents",
    url: "https://health.ec.europa.eu/medical-devices-sector/new-regulations/guidance-mdcg-endorsed-documents-and-other-guidance_en",
    jurisdiction: "EU",
  },
  {
    key: "eu:harmonised",
    sourceKey: "page_watch:eu_harmonised",
    label: "EU harmonised standards – medical devices",
    url: "https://single-market-economy.ec.europa.eu/single-market/goods/european-standards/harmonised-standards/medical-devices_en",
    jurisdiction: "EU",
  },
  // ── US: FDA 가이던스는 Federal Register "Guidance Availability" 공고로 모두 수집되므로 별도 페이지 감시 없음 ──
  // ── ISO (iso.org 규격 페이지: 상태 Published / Under review / Revision 등 변경 감지) ──
  //    iso.org 는 자동화 접근을 차단(HTTP 403)할 수 있음. 차단되면 DISABLED_SOURCES=page_watch:iso 로 끄세요.
  { key: "iso:13485", sourceKey: "page_watch:iso", label: "ISO 13485:2016", url: "https://www.iso.org/standard/59752.html", jurisdiction: "INTL", hint: "ISO 13485" },
  { key: "iso:14971", sourceKey: "page_watch:iso", label: "ISO 14971:2019", url: "https://www.iso.org/standard/72704.html", jurisdiction: "INTL", hint: "ISO 14971" },
  { key: "iso:10993-1", sourceKey: "page_watch:iso", label: "ISO 10993-1", url: "https://www.iso.org/standard/68936.html", jurisdiction: "INTL", hint: "ISO 10993-1" },
  { key: "iso:14155", sourceKey: "page_watch:iso", label: "ISO 14155:2020", url: "https://www.iso.org/standard/71690.html", jurisdiction: "INTL", hint: "ISO 14155" },
  { key: "iso:15223-1", sourceKey: "page_watch:iso", label: "ISO 15223-1:2021", url: "https://www.iso.org/standard/77326.html", jurisdiction: "INTL", hint: "ISO 15223-1" },
  { key: "iso:11607-1", sourceKey: "page_watch:iso", label: "ISO 11607-1:2019", url: "https://www.iso.org/standard/70799.html", jurisdiction: "INTL", hint: "ISO 11607-1" },
  { key: "iso:tc210", sourceKey: "page_watch:iso", label: "ISO/TC 210 work programme", url: "https://www.iso.org/committee/54892/x/catalogue/p/0/u/1/w/0/d/0", jurisdiction: "INTL", hint: "ISO/TC 210 개발중 규격" },
  // ── IEC webstore publication 페이지 (상태·안정성 날짜·개정 정보 변경 감지) ──
  { key: "iec:62304", sourceKey: "page_watch:iec", label: "IEC 62304:2006+AMD1:2015", url: "https://webstore.iec.ch/en/publication/22794", jurisdiction: "INTL", hint: "IEC 62304" },
  { key: "iec:60601-1", sourceKey: "page_watch:iec", label: "IEC 60601-1:2005+AMD1+AMD2", url: "https://webstore.iec.ch/en/publication/67497", jurisdiction: "INTL", hint: "IEC 60601-1" },
  { key: "iec:62366-1", sourceKey: "page_watch:iec", label: "IEC 62366-1:2015+AMD1:2020", url: "https://webstore.iec.ch/en/publication/67220", jurisdiction: "INTL", hint: "IEC 62366-1" },
  { key: "iec:81001-5-1", sourceKey: "page_watch:iec", label: "IEC 81001-5-1:2021", url: "https://webstore.iec.ch/en/publication/63293", jurisdiction: "INTL", hint: "IEC 81001-5-1" },
];

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\s{2,}|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

export function pageWatchAdapter(cfg: PageWatchConfig): SourceAdapter {
  return {
    key: cfg.sourceKey,
    label: cfg.label,
    async fetch() {
      const html = await fetchText(cfg.url);
      let text = stripHtml(html);
      if (cfg.extract) {
        const m = text.match(cfg.extract);
        if (m?.[1]) text = m[1];
      }
      // 쿠키 배너·날짜 등 노이즈가 매번 바뀌는 것을 줄이기 위해 길이 제한
      text = text.slice(0, 60_000);
      const hash = sha(text);

      const sb = supabaseAdmin();
      const { data: prev } = await sb.from("page_snapshots").select("content_hash, content").eq("source_key", cfg.key).maybeSingle();

      // 기준 스냅샷 갱신은 collect 가 변경분을 DB 에 저장한 뒤에 수행 (commit). 저장 실패 시 다음 실행에서 다시 감지됨
      const commit = async () => {
        const { error } = await sb.from("page_snapshots").upsert({ source_key: cfg.key, content_hash: hash, content: text, fetched_at: new Date().toISOString() });
        if (error) throw new Error(`snapshot upsert failed (${cfg.key}): ${error.message}`);
      };

      if (!prev) return { items: [], commit }; // 최초 수집: 기준 스냅샷만 저장
      if (prev.content_hash === hash) return { items: [], commit };

      const prevSet = new Set(toSentences(prev.content));
      const added = toSentences(text).filter((s) => !prevSet.has(s));
      if (added.length === 0) return { items: [], commit };

      const diff = added.join("\n");
      const out: RawUpdate = {
        source: cfg.sourceKey,
        externalId: `${cfg.key}:${sha(diff).slice(0, 16)}`,
        jurisdiction: cfg.jurisdiction,
        title: `${cfg.label} 페이지 변경 감지`,
        url: cfg.url,
        publishedAt: new Date(),
        raw: truncate(`${cfg.hint ? `[관련 규격: ${cfg.hint}]\n` : ""}새로 추가된 내용:\n${diff}`),
      };
      return { items: [out], rawCount: 1, commit };
    },
  };
}
