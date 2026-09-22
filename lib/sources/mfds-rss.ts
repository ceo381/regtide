import { XMLParser } from "fast-xml-parser";
import { fetchText, stripHtml, truncate, type RawUpdate, type SourceAdapter } from "./types";

/**
 * 식약처 RSS (https://www.mfds.go.kr/www/rss/list.do)
 *  data0009 입법/행정예고, data0005 고시전문, data0013 안내서/지침,
 *  ntc0004 공고, plc0139 의료기기 회수/판매중지
 */
export const MFDS_FEEDS: Record<string, string> = {
  data0009: "입법/행정예고",
  data0005: "고시전문",
  data0006: "훈령전문",
  data0007: "예규전문",
  data0013: "안내서/지침",
  ntc0003: "공지",
  ntc0004: "공고",
  ntc0021: "보도자료",
  seohan001: "안전성 서한",
  plc0139: "의료기기 회수/판매중지",
  plc0168: "의료기기 행정처분",
};

const MEDICAL_DEVICE_HINT = /의료기기|체외진단|디지털의료|의료용|의료제품|GMP|UDI|표준코드|사이버보안|임상시험|소프트웨어 의료|인공지능 의료|SaMD/i;

export function mfdsRssAdapter(brdId: string): SourceAdapter {
  const key = `mfds_rss:${brdId}`;
  return {
    key,
    label: `식약처 ${MFDS_FEEDS[brdId] ?? brdId}`,
    async fetch(since) {
      const xml = await fetchText(`https://www.mfds.go.kr/www/rss/brd.do?brdId=${brdId}`);
      const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: "__cdata" });
      const doc = parser.parse(xml);
      const items = toArray(doc?.rss?.channel?.item);
      const out: RawUpdate[] = [];
      let rawCount = 0;
      for (const it of items) {
        rawCount++;
        const title = text(it.title);
        const link = text(it.link);
        const pub = it.pubDate ? new Date(text(it.pubDate)) : undefined;
        if (!title || !link) continue;
        if (pub && !isNaN(pub.getTime()) && pub < since) continue;
        const body = stripHtml(text(it["content:encoded"]) || text(it.description));
        // 고시/입법예고 피드는 식품·의약품도 섞여 있으므로 의료기기 관련 항목만 통과
        // 본문 전체를 검사 (앞 500자만 보면 뒤쪽에서만 의료기기를 언급하는 통합 고시를 놓친다)
        if (!MEDICAL_DEVICE_HINT.test(title + " " + body)) continue;
        out.push({
          source: key,
          externalId: link,
          jurisdiction: "KR",
          title,
          url: link,
          publishedAt: pub && !isNaN(pub.getTime()) ? pub : undefined,
          raw: truncate(body),
        });
      }
      return { items: out, rawCount };
    },
  };
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && v && "__cdata" in v) return String((v as { __cdata: unknown }).__cdata ?? "").trim();
  if (typeof v === "object" && v && "#text" in v) return String((v as { "#text": unknown })["#text"] ?? "").trim();
  return String(v).trim();
}
