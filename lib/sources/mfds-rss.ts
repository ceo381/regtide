import { XMLParser } from "fast-xml-parser";
import { fetchText, stripHtml, truncate, type FetchResult, type RawUpdate, type SourceAdapter } from "./types";
import { MFDS_BOARD_BY_FEED, boardItemToUpdate, fetchBoardItems, looksLikeRss } from "./mfds-board";

/**
 * 식약처 RSS (https://www.mfds.go.kr/www/rss/list.do)
 *  data0009 입법/행정예고, data0005 고시전문, data0013 안내서/지침, ntc0004 공고 …
 *  회수/판매중지·행정처분은 RSS(plc0139/plc0168)가 오류 페이지만 돌려주므로 emedi 어댑터(mfds-emedi.ts)로 수집한다.
 *
 *  2차 경로: RSS 가 XML 이 아닌 오류 페이지("일시적으로 서비스를 이용하실 수 없습니다")를 돌려주면
 *  같은 게시판의 HTML 목록(MFDS_BOARD_BY_FEED)을 대신 읽는다. 항목 URL 형식이 RSS <link> 와 같아 중복 저장되지 않는다.
 *  게시판에는 본문이 없어 제목만으로 의료기기 관련 여부를 판정하므로, 대체 수집 사실을 경고로 남겨 상태 점검에 보인다.
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
};

export const MEDICAL_DEVICE_HINT = /의료기기|체외진단|디지털의료|의료용|의료제품|GMP|UDI|표준코드|사이버보안|임상시험|소프트웨어 의료|인공지능 의료|SaMD/i;

export function mfdsRssAdapter(brdId: string): SourceAdapter {
  const key = `mfds_rss:${brdId}`;
  return {
    key,
    label: `식약처 ${MFDS_FEEDS[brdId] ?? brdId}`,
    async fetch(since) {
      const xml = await fetchText(`https://www.mfds.go.kr/www/rss/brd.do?brdId=${brdId}`);
      if (!looksLikeRss(xml)) return fallbackToBoard(key, brdId, since, xml);
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

/** RSS 오류 시 게시판 HTML 로 대체 수집. 대응 게시판이 없으면 소스 오류로 올린다 */
async function fallbackToBoard(key: string, brdId: string, since: Date, xml: string, fetchPage?: (url: string) => Promise<string>): Promise<FetchResult> {
  const board = MFDS_BOARD_BY_FEED[brdId];
  const reason = /일시적으로 서비스를 이용하실 수 없습니다/.test(xml) ? "식약처 RSS 일시 장애 페이지" : "RSS 형식이 아닌 응답";
  if (!board) throw new Error(`${reason} (brdId=${brdId}) — 대체 게시판 없음`);
  const b = await fetchBoardItems(board, since, fetchPage);
  const items = b.items.filter((it) => MEDICAL_DEVICE_HINT.test(it.title)).map((it) => boardItemToUpdate(key, it));
  return {
    items,
    rawCount: b.rawCount,
    warnings: [`${reason} → 게시판 HTML(m_${board})로 대체 수집 (제목 기준 판정, 원본 ${b.rawCount}건 중 ${items.length}건)`, ...b.warnings],
  };
}
export const __mfdsRssInternals = { fallbackToBoard };

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
