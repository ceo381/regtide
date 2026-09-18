import { CATALOG, type CatalogItem } from "@/lib/catalog";
import { supabaseAdmin, type UpdateRow } from "@/lib/supabase";

/**
 * 규칙 기반 분류 (외부 AI API 없음, 비용 0)
 *  1) 카탈로그 keywords 를 제목·본문에서 탐색 → 관련 catalog_ids 결정
 *  2) 문서 유형(입법예고·고시·가이던스·Rule 등)으로 영향도(impact) 결정
 *  3) 요약 대신 본문 앞부분을 발췌(excerpt)하여 summary 로 저장
 */

export interface ClassifyOutput {
  summary: string;
  impact: "high" | "medium" | "low" | "none";
  catalog_ids: string[];
  matched_keywords: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

/** 의료기기와 무관한 식품·의약품·화장품 등 문서를 걸러내는 배제어 (제목 기준) */
const EXCLUDE_TITLE = /식품|축산물|건강기능식품|화장품|의약품(?!.*의료기기)|마약|위생용품|농약|한약|담배|주류|식중독|급식|어린이 기호/;
/** 의료기기 관련성을 뒷받침하는 포함어 */
const INCLUDE_ANY = /의료기기|체외진단|디지털의료|의료용|GMP|UDI|표준코드|사이버보안|임상시험|medical device|in vitro diagnostic|510\(k\)|premarket|QMSR|MDR|IVDR|MDCG|ISO|IEC/i;

function scoreItem(item: CatalogItem, title: string, body: string): { score: number; hits: string[] } {
  const t = norm(title);
  const b = norm(body);
  let score = 0;
  const hits: string[] = [];
  for (const kw of item.keywords) {
    const k = norm(kw);
    if (t.includes(k)) {
      score += 3;
      hits.push(kw);
    } else if (b.includes(k)) {
      score += 1;
      hits.push(kw);
    }
  }
  return { score, hits };
}

export function matchCatalog(u: Pick<UpdateRow, "title" | "raw" | "jurisdiction" | "source">): { ids: string[]; keywords: string[] } {
  const title = u.title ?? "";
  const body = u.raw ?? "";
  const ids: string[] = [];
  const kws = new Set<string>();

  for (const item of CATALOG) {
    // 관할이 다르면 매칭 제외. 단, ISO/IEC(INTL) 항목은 어느 관할 문서에서든 규격 번호가 언급되면 매칭 허용
    const sameJurisdiction = item.jurisdiction === u.jurisdiction;
    if (!sameJurisdiction && item.jurisdiction !== "INTL") continue;

    const { score, hits } = scoreItem(item, title, body);
    // 같은 관할: 본문 1회 언급도 인정 / 타관할 INTL: 제목 언급 또는 본문 2회 이상 언급 필요
    const threshold = sameJurisdiction ? 1 : 2;
    if (score >= threshold) {
      ids.push(item.id);
      hits.forEach((h) => kws.add(h));
    }
  }

  // "식약처 안내서 전반" 같은 광범위 항목은 다른 구체 항목이 하나도 없을 때만 남김
  const broad = new Set(["kr-guidance"]);
  const specific = ids.filter((id) => !broad.has(id));
  return { ids: specific.length ? specific : ids, keywords: [...kws] };
}

export function decideImpact(u: Pick<UpdateRow, "title" | "source" | "jurisdiction">, matched: boolean): ClassifyOutput["impact"] {
  if (!matched) return "none";
  const t = u.title;

  if (u.jurisdiction === "KR") {
    if (/입법예고|행정예고|개정령\(안\)|개정고시\(안\)|제정\(안\)/.test(t)) return "high";
    if (/개정|제정|공포|시행/.test(t) && /고시|법|규칙|규정|기준/.test(t)) return "high";
    if (/안내서|지침|가이드라인|해설서|질의응답|Q&A/.test(t)) return "medium";
    if (/회수|판매중지|행정처분/.test(t)) return "low";
    return "medium";
  }
  if (u.jurisdiction === "US") {
    if (/^\[(Rule|Proposed Rule)\]/.test(t)) return "high";
    if (/guidance|draft guidance/i.test(t)) return "medium";
    if (/recognized consensus standards|recognition list/i.test(t)) return "medium";
    return "low";
  }
  // EU / INTL 페이지 변경 감지
  if (/harmonised|harmonized|implementing/i.test(t)) return "high";
  return "medium";
}

export function makeExcerpt(u: Pick<UpdateRow, "raw" | "title" | "source">, max = 420): string {
  const raw = (u.raw ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "본문이 제공되지 않은 항목입니다. 원문 링크에서 확인하세요.";
  // 페이지 변경 감지 항목은 "새로 추가된 내용:" 이후만 발췌
  const idx = raw.indexOf("새로 추가된 내용:");
  const text = idx >= 0 ? raw.slice(idx + "새로 추가된 내용:".length).trim() : raw;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("다. "));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut) + " …";
}

export function classifyOne(u: UpdateRow): ClassifyOutput {
  // 1차: 제목 기준 명백한 비대상 문서 배제 (KR 피드에 식품·의약품이 섞여 있음)
  const excluded = u.jurisdiction === "KR" && EXCLUDE_TITLE.test(u.title) && !/의료기기|체외진단|디지털의료/.test(u.title);
  const relevant = !excluded && INCLUDE_ANY.test(`${u.title} ${u.raw ?? ""}`);

  const { ids, keywords } = relevant ? matchCatalog(u) : { ids: [], keywords: [] };
  const impact = decideImpact(u, ids.length > 0);
  return { summary: makeExcerpt(u), impact, catalog_ids: ids, matched_keywords: keywords };
}

export interface ClassifyResult {
  classified: number;
  matched: number;
  errors: { id: string; error: string }[];
}

export async function classifyPending(limit = 500): Promise<ClassifyResult> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("updates")
    .select("*")
    .is("classified_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;

  const result: ClassifyResult = { classified: 0, matched: 0, errors: [] };
  const now = new Date().toISOString();

  for (const u of (data ?? []) as UpdateRow[]) {
    try {
      const r = classifyOne(u);
      const { error: upErr } = await sb
        .from("updates")
        .update({ summary_ko: r.summary, impact: r.impact, catalog_ids: r.catalog_ids, matched_keywords: r.matched_keywords, classified_at: now })
        .eq("id", u.id);
      if (upErr) throw upErr;
      result.classified++;
      if (r.catalog_ids.length) result.matched++;
    } catch (e) {
      result.errors.push({ id: u.id, error: String((e as Error).message ?? e) });
    }
  }
  return result;
}
