import type { Jurisdiction } from "@/lib/catalog";
import { MFDS_FEEDS } from "@/lib/sources/mfds-rss";
import { EMEDI_SOURCES } from "@/lib/sources/mfds-emedi";

/**
 * 출처(수집 소스) 표기용 메타데이터.
 * updates.source 값(예: "mfds_rss:data0009", "federal_register", "page_watch:iso")을
 * 사람이 읽을 수 있는 "발행 기관 · 소스명" 과 기관 홈페이지 링크로 바꾼다.
 */
export interface SourceInfo {
  agency: string; // 발행 기관 (국문 + 원어/약칭)
  name: string; // 소스 채널명
  url: string; // 기관/채널 홈페이지
  jurisdiction: Jurisdiction;
  /** published_at 이 "기관이 발표한 시각"이 아니라 "우리가 변경을 감지한 시각"인 소스 */
  detectedOnly?: boolean;
}

const STATIC: Record<string, SourceInfo> = {
  law_go_kr: { agency: "법제처 국가법령정보센터", name: "법령·행정규칙 Open API", url: "https://www.law.go.kr", jurisdiction: "KR" },
  federal_register: { agency: "미국 연방정부 Federal Register (FDA 고시)", name: "Federal Register API", url: "https://www.federalregister.gov", jurisdiction: "US" },
  "page_watch:eu_md_latest": { agency: "European Commission (DG SANTE)", name: "Medical devices – latest updates / MDCG documents", url: "https://health.ec.europa.eu/medical-devices-sector_en", jurisdiction: "EU", detectedOnly: true },
  "page_watch:eu_harmonised": { agency: "European Commission", name: "Harmonised standards – medical devices", url: "https://single-market-economy.ec.europa.eu/single-market/goods/european-standards/harmonised-standards/medical-devices_en", jurisdiction: "EU", detectedOnly: true },
  "page_watch:iso": { agency: "ISO (International Organization for Standardization)", name: "iso.org 규격 페이지", url: "https://www.iso.org", jurisdiction: "INTL", detectedOnly: true },
  "page_watch:iec": { agency: "IEC (International Electrotechnical Commission)", name: "IEC Webstore 규격 페이지", url: "https://webstore.iec.ch", jurisdiction: "INTL", detectedOnly: true },
};

export function describeSource(source: string): SourceInfo {
  if (source.startsWith("mfds_rss:")) {
    const brdId = source.slice("mfds_rss:".length);
    return { agency: "식품의약품안전처 (MFDS)", name: `${MFDS_FEEDS[brdId] ?? brdId} RSS`, url: "https://www.mfds.go.kr", jurisdiction: "KR" };
  }
  if (source.startsWith("mfds_emedi:")) {
    const k = source.slice("mfds_emedi:".length) as keyof typeof EMEDI_SOURCES;
    const e = EMEDI_SOURCES[k];
    return { agency: "식품의약품안전처 (MFDS)", name: e ? e.name : `의료기기안심책방 ${k}`, url: e?.url ?? "https://emedi.mfds.go.kr", jurisdiction: "KR" };
  }
  return STATIC[source] ?? { agency: source, name: "", url: "", jurisdiction: "INTL" };
}

/** 서비스가 모니터링하는 국가·기관 (이메일 헤더·랜딩 페이지 공용) */
export const COVERAGE: { code: Jurisdiction; country: string; agencies: string }[] = [
  { code: "KR", country: "한국", agencies: "식품의약품안전처(MFDS) · 법제처 국가법령정보센터" },
  { code: "US", country: "미국", agencies: "FDA (Federal Register 게재분)" },
  { code: "EU", country: "유럽연합", agencies: "European Commission · MDCG · 조화규격(OJEU)" },
  { code: "INTL", country: "국제규격", agencies: "ISO/TC 210 · IEC/TC 62 (ISO/IEC 규격 제·개정 동향)" },
];

/** 이메일 하단 출처 목록용 — 실제 이번 메일에 포함된 소스만 추려서 표시 */
export function sourcesUsed(sources: string[]): SourceInfo[] {
  const seen = new Map<string, SourceInfo>();
  for (const s of sources) {
    const info = describeSource(s);
    const k = `${info.agency}|${info.name}`;
    if (!seen.has(k)) seen.set(k, info);
  }
  return [...seen.values()];
}
