import { fetchText, stripHtml, type RawUpdate } from "./types";

/**
 * 식약처 홈페이지 게시판 HTML 수집 — RSS 가 오류 페이지를 돌려줄 때의 2차 경로.
 *  - RSS brdId ↔ 게시판 번호 대응 (https://www.mfds.go.kr/www/rss/list.do 기준)
 *  - 목록 URL: https://www.mfds.go.kr/brd/m_<board>/list.do?page=N  (한 페이지 10건, 최신순)
 *  - 항목 URL: https://www.mfds.go.kr/brd/m_<board>/view.do?seq=<seq>
 *    → RSS <link> 와 같은 형식이므로 externalId(=url) 가 일치해 RSS 경로와 중복 저장되지 않는다
 *  - 게시판에는 본문이 없으므로 제목만으로 의료기기 관련 여부를 판정한다 (RSS 경로보다 보수적 → 경고로 표시)
 */
export const MFDS_BOARD_BY_FEED: Record<string, number> = {
  data0009: 209,   // 입법/행정예고
  data0005: 211,   // 고시전문 — 211 은 고시·훈령·예규 통합 게시판이라 data0006/0007 도 여기서 함께 잡힌다 (중복 저장 방지를 위해 0005 에만 연결)
  data0013: 1059,  // 안내서/지침
  ntc0003: 74,     // 공지
  ntc0004: 76,     // 공고
  ntc0021: 99,     // 보도자료
  seohan001: 1067, // 안전성 서한
};

export const MFDS_BOARD_MAX_PAGES = 5;

export interface BoardItem { seq: string; title: string; url: string; date?: Date }

export function boardListUrl(board: number, page: number) {
  return `https://www.mfds.go.kr/brd/m_${board}/list.do?page=${page}`;
}
export function boardViewUrl(board: number, seq: string) {
  return `https://www.mfds.go.kr/brd/m_${board}/view.do?seq=${seq}`;
}

/** RSS 응답이 실제 RSS 인지 판정 (오류 페이지·빈 응답·HTML 안내문이면 false) */
export function looksLikeRss(xml: string): boolean {
  const head = xml.slice(0, 4000);
  if (/일시적으로 서비스를 이용하실 수 없습니다|시스템 점검|접근이 거부|<!doctype html|<html/i.test(head) && !/<rss[\s>]/i.test(head)) return false;
  return /<rss[\s>]|<channel[\s>]/i.test(head);
}

/** 게시판 목록 HTML 한 페이지 → 항목 */
export function parseBoardList(html: string, board: number): BoardItem[] {
  const out: BoardItem[] = [];
  const listStart = html.indexOf("bbs_list01");
  if (listStart < 0) return out;
  const section = html.slice(listStart);
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(section))) {
    const li = m[1];
    if (!/class="center_column"/.test(li)) continue;
    const a = /<a\s+href="([^"]*view\.do\?seq=(\d+)[^"]*)"[^>]*class="title"[^>]*>([\s\S]*?)<\/a>/.exec(li);
    if (!a) continue;
    const title = stripHtml(a[3]).replace(/\s+/g, " ").trim();
    const dm = /class="right_column"[^>]*>\s*(\d{4}-\d{2}-\d{2})/.exec(li);
    const date = dm ? new Date(`${dm[1]}T00:00:00+09:00`) : undefined;
    if (!title) continue;
    out.push({ seq: a[2], title, url: boardViewUrl(board, a[2]), date });
  }
  return out;
}

/**
 * since 이후 항목을 페이지 순으로 모은다. 목록은 최신순이므로 한 페이지 전체가 since 이전이면 중단.
 * 페이지 상한(MFDS_BOARD_MAX_PAGES)에 걸리면 경고를 남겨 상태 점검에 보인다.
 */
export async function fetchBoardItems(board: number, since: Date, fetchPage: (url: string) => Promise<string> = fetchText): Promise<{ items: BoardItem[]; rawCount: number; warnings: string[] }> {
  const items: BoardItem[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let rawCount = 0;
  for (let page = 1; page <= MFDS_BOARD_MAX_PAGES; page++) {
    const html = await fetchPage(boardListUrl(board, page));
    const rows = parseBoardList(html, board);
    if (!rows.length) {
      if (page === 1) warnings.push(`게시판 m_${board} 목록을 해석하지 못함 (구조 변경 가능성)`);
      break;
    }
    rawCount += rows.length;
    let anyRecent = false;
    for (const r of rows) {
      if (r.date && r.date < since) continue;
      anyRecent = true;
      if (seen.has(r.seq)) continue; // 페이지가 밀리며 같은 글이 두 번 보이는 경우
      seen.add(r.seq);
      items.push(r);
    }
    if (!anyRecent) break;
    if (page === MFDS_BOARD_MAX_PAGES) warnings.push(`게시판 m_${board}: ${MFDS_BOARD_MAX_PAGES}페이지 상한 도달 — since 이전까지 다 보지 못했을 수 있음`);
  }
  return { items, rawCount, warnings };
}

export function boardItemToUpdate(source: string, it: BoardItem): RawUpdate {
  return { source, externalId: it.url, jurisdiction: "KR", title: it.title, url: it.url, publishedAt: it.date, raw: undefined };
}
