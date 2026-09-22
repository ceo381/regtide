/**
 * 외부 서비스(Supabase·Resend·소스 사이트) 없이 전체 파이프라인을 검증하는 자체 테스트.
 *   npm run selftest
 *
 * 검증 항목
 *  1. RSS 파서 (식약처 RSS 실제 형식의 고정 샘플)
 *  2. 수집(collect): 중복 제거 · 재실행 시 신규 0건
 *  3. 페이지 감시(page_watch): 첫 실행 스냅샷만 저장 → 변경 시 추가 문장만 업데이트 생성
 *  4. 분류(classify): 관련성·영향도·발췌, 식품/의약품 배제
 *  5. 발송(send): 구독자별 매칭, 빈 메일 건너뜀, 같은 주 중복 발송 방지, 이메일 HTML 내용
 *  6. 구독 API 입력 검증 (zod 스키마)
 */
import assert from "node:assert/strict";
import { __setSupabaseClientForTest } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "./fake-supabase";
import { collectUpdates } from "@/lib/collect";
import { classifyPending } from "@/lib/classify";
import { sendWeeklyDigests, weekWindow, type Mailer } from "@/lib/digest";
import { pageWatchAdapter } from "@/lib/sources/page-watch";
import { mfdsRssAdapter } from "@/lib/sources/mfds-rss";
import type { SourceAdapter } from "@/lib/sources";

process.env.NEXT_PUBLIC_SITE_URL = "https://regtide.example";
process.env.MAIL_FROM = "RegTide <test@regtide.example>";

const db = createFakeSupabase();
__setSupabaseClientForTest(db.client as SupabaseClient);

let passed = 0;
function ok(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}\n    ${(e as Error).message}`); process.exitCode = 1; });
}

// ── 고정 샘플 (실제 식약처 RSS 형식) ───────────────────────────────────────
const MFDS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>입법/행정예고</title>
<item><title><![CDATA[「의료기기법 시행규칙」 일부개정령(안) 입법예고]]></title><link>https://www.mfds.go.kr/brd/m_209/view.do?seq=44298</link><pubDate>Mon, 14 Sep 2026 00:23:59 GMT</pubDate><content:encoded><![CDATA[<p>의료기기 등급 분류 사전검토 절차 신설, 긴급 사용 의료기기 지정 절차, 인공지능 생성 광고 제한 등을 규정하고자 함.</p>]]></content:encoded></item>
<item><title><![CDATA[「의약외품 품목허가·신고·심사 규정」일부개정고시(안) 행정예고]]></title><link>https://www.mfds.go.kr/brd/m_209/view.do?seq=44290</link><pubDate>Thu, 03 Sep 2026 01:00:00 GMT</pubDate><description><![CDATA[의약외품 시험 요건 명확화]]></description></item>
<item><title><![CDATA[「식품의 기준 및 규격」 일부개정고시(안) 행정예고]]></title><link>https://www.mfds.go.kr/brd/m_209/view.do?seq=44280</link><pubDate>Wed, 02 Sep 2026 01:00:00 GMT</pubDate><description><![CDATA[농산물 잔류농약 기준 신설]]></description></item>
<item><title><![CDATA[의료기기 제조 및 품질관리 기준 일부개정고시(안) 행정예고]]></title><link>https://www.mfds.go.kr/brd/m_209/view.do?seq=44270</link><pubDate>Tue, 01 Sep 2026 01:00:00 GMT</pubDate><description><![CDATA[GMP 적합성인정 심사 절차 개선]]></description></item>
</channel></rss>`;

// fetch 를 가짜로 대체 (URL 별 응답)
const responses = new Map<string, () => string>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  for (const [prefix, body] of responses) {
    if (url.startsWith(prefix)) return new Response(body(), { status: 200, headers: { "content-type": "text/xml" } });
  }
  return new Response("blocked in selftest", { status: 599 });
}) as typeof fetch;

let euPage = `<html><body><h1>Harmonised standards</h1><p>EN ISO 13485:2016 quality management systems for medical devices is listed.</p><p>EN ISO 14971:2019 application of risk management to medical devices is listed.</p></body></html>`;
responses.set("https://www.mfds.go.kr/www/rss/brd.do?brdId=data0009", () => MFDS_XML);
responses.set("https://single-market-economy.ec.europa.eu/", () => euPage);

const since = new Date("2026-08-20T00:00:00Z");
const adapters: SourceAdapter[] = [
  mfdsRssAdapter("data0009"),
  pageWatchAdapter({
    key: "eu:harmonised", sourceKey: "page_watch:eu_harmonised", label: "EU harmonised standards – medical devices",
    url: "https://single-market-economy.ec.europa.eu/single-market/goods/european-standards/harmonised-standards/medical-devices_en", jurisdiction: "EU",
  }),
];

async function main() {
  console.log("\n[1] RSS 파서");
  await ok("의료기기 관련 항목만 통과하고 CDATA/pubDate 를 파싱한다", async () => {
    const items = await mfdsRssAdapter("data0009").fetch(since);
    const titles = items.map((i) => i.title);
    assert.ok(titles.some((t) => t.includes("의료기기법 시행규칙")));
    assert.ok(titles.some((t) => t.includes("품질관리 기준")));
    assert.ok(!titles.some((t) => t.includes("식품의 기준")), "식품 항목이 걸러져야 함");
    assert.ok(!titles.some((t) => t.includes("의약외품")), "의약외품 항목이 걸러져야 함");
    assert.equal(items[0].publishedAt?.toISOString(), "2026-09-14T00:23:59.000Z");
    assert.ok(items[0].raw?.includes("사전검토"));
  });

  console.log("\n[2] 수집");
  await ok("첫 수집: RSS 2건 저장, 페이지 감시는 스냅샷만 저장(0건)", async () => {
    const r = await collectUpdates(since, adapters);
    assert.deepEqual(r.errors, []);
    assert.equal(r.inserted, 2);
    assert.equal(db.tables.updates.length, 2);
    assert.equal(db.tables.page_snapshots.filter((r) => !String(r.source_key).startsWith("admin:")).length, 1);
    const last = db.tables.page_snapshots.find((r) => r.source_key === "admin:last_collect")!;
    assert.ok(last && JSON.parse(String(last.content)).bySource["mfds_rss:data0009"] === 2, "마지막 수집 결과(소스별 건수)가 저장되어야 함");
  });
  await ok("재수집: 동일 항목은 중복 저장되지 않는다", async () => {
    const r = await collectUpdates(since, adapters);
    assert.equal(r.inserted, 0);
    assert.equal(db.tables.updates.length, 2);
  });

  console.log("\n[3] 페이지 감시");
  await ok("페이지에 문장이 추가되면 추가분만 업데이트로 생성된다", async () => {
    euPage = euPage.replace("</body>", `<p>EN IEC 62304:2006/A1:2015 medical device software life cycle processes was added on 15 September 2026 under Implementing Decision (EU) 2026/999.</p></body>`);
    const r = await collectUpdates(since, adapters);
    assert.equal(r.inserted, 1);
    const eu = db.tables.updates.find((u) => u.source === "page_watch:eu_harmonised")!;
    assert.ok(String(eu.raw).includes("62304"));
    assert.ok(!String(eu.raw).includes("14971"), "기존 문장은 포함되지 않아야 함");
  });

  console.log("\n[4] 분류");
  await ok("모든 미분류 항목이 분류되고 관련성·영향도가 부여된다", async () => {
    const r = await classifyPending();
    assert.deepEqual(r.errors, []);
    assert.equal(r.classified, 3);
    const byTitle = (s: string) => db.tables.updates.find((u) => String(u.title).includes(s))!;
    const law = byTitle("의료기기법 시행규칙");
    assert.equal(law.impact, "high");
    assert.ok((law.catalog_ids as string[]).includes("kr-mdact"));
    const gmp = byTitle("품질관리 기준");
    assert.equal(gmp.impact, "high");
    assert.deepEqual(gmp.catalog_ids, ["kr-gmp"]);
    const eu = byTitle("EU harmonised");
    assert.equal(eu.impact, "high");
    assert.ok((eu.catalog_ids as string[]).includes("eu-harmonised"));
    assert.ok((eu.catalog_ids as string[]).includes("iec-62304"), "본문의 IEC 62304 언급이 INTL 항목으로 매칭되어야 함");
    assert.ok(String(eu.summary_ko).startsWith("EN IEC 62304"), "발췌는 '새로 추가된 내용' 이후만");
  });

  console.log("\n[5] 발송");
  const sent: { to: string; subject: string; html: string }[] = [];
  const mailer: Mailer = { async send(m) { sent.push(m); return { id: `msg_${sent.length}` }; } };
  db.tables.subscribers.push(
    { id: "s1", email: "gmp@company.kr", unsubscribe_token: "tok1", active: true, products: [{ name: "저주파자극기", category: "2등급", catalogIds: ["kr-gmp"] }], catalog_ids: ["kr-gmp"], last_sent_at: null },
    { id: "s2", email: "sw@company.kr", unsubscribe_token: "tok2", active: true, products: [{ name: "AI SW", category: "디지털의료기기(SaMD)", catalogIds: ["iec-62304", "us-software-ai"] }], catalog_ids: ["iec-62304", "us-software-ai"], last_sent_at: null },
    { id: "s3", email: "fda@company.kr", unsubscribe_token: "tok3", active: true, products: [{ name: "PMA 기기", category: "3등급", catalogIds: ["us-pma"] }], catalog_ids: ["us-pma"], last_sent_at: null },
    { id: "s4", email: "off@company.kr", unsubscribe_token: "tok4", active: false, products: [], catalog_ids: ["kr-gmp"], last_sent_at: null },
  );
  await ok("구독자별로 자기 규격에 해당하는 항목만 발송되고, 해당 없음·비활성은 건너뛴다", async () => {
    const r = await sendWeeklyDigests(new Date(), { recent: true }, mailer);
    assert.deepEqual(r.failed, []);
    assert.equal(r.sent, 2, "s1(GMP), s2(62304) 두 명");
    assert.equal(r.skipped, 1, "s3 는 해당 항목 없음");
    const m1 = sent.find((m) => m.to === "gmp@company.kr")!;
    assert.ok(m1.subject.includes("1건"));
    assert.ok(m1.html.includes("품질관리 기준"));
    assert.ok(!m1.html.includes("의료기기법 시행규칙"), "선택하지 않은 항목은 포함되지 않아야 함");
    assert.ok(m1.html.includes("/api/unsubscribe?token=tok1"));
    assert.ok(m1.html.includes("저주파자극기"));
    // 고객 피드백: 출처 · 기관 발표/수집 일시 · 지원 국가 표기
    assert.ok(m1.html.includes("출처:") && m1.html.includes("식품의약품안전처 (MFDS)"), "항목별 출처(발행 기관) 표기");
    assert.ok(m1.html.includes("기관 발표일시:") && m1.html.includes("RegTide 수집:"), "기관 발표 일시와 수집 일시 표기");
    assert.ok(m1.html.includes("모니터링 대상:") && m1.html.includes("유럽연합"), "지원 국가 표기");
    assert.ok(m1.html.includes("정보 수집 기간") && m1.html.includes("8일"), "정보 수집 기간 표기");
    assert.ok(m1.html.includes("이번 메일의 출처"), "하단 출처 목록");
    const m2 = sent.find((m) => m.to === "sw@company.kr")!;
    assert.ok(m2.html.includes("62304"));
    assert.ok(m2.html.includes("변경 감지일시:") && m2.html.includes("European Commission"), "페이지 감시 소스는 '변경 감지'로 표기");
    assert.equal(db.tables.deliveries.filter((d) => d.status === "sent").length, 2);
    assert.equal(db.tables.deliveries.filter((d) => d.status === "skipped_empty").length, 1);
  });
  await ok("같은 주에 다시 실행하면 중복 발송되지 않는다", async () => {
    const r = await sendWeeklyDigests(new Date(), { recent: true }, mailer);
    assert.equal(r.sent, 0);
    assert.equal(r.skipped, 3);
    assert.equal(sent.length, 2);
  });
  await ok("발송 실패(failed) 건은 다음 실행에서 재시도된다", async () => {
    db.tables.subscribers.push({ id: "s5", email: "retry@company.kr", unsubscribe_token: "tok5", active: true, products: [], catalog_ids: ["kr-gmp"], last_sent_at: null });
    let calls = 0;
    const flaky: Mailer = { async send(m) { calls++; if (calls === 1) throw new Error("temporary provider outage"); sent.push(m); return { id: "msg_retry" }; } };
    const r1 = await sendWeeklyDigests(new Date(), { recent: true }, flaky);
    assert.equal(r1.failed.length, 1);
    assert.equal(db.tables.deliveries.find((d) => d.subscriber_id === "s5")!.status, "failed");
    const r2 = await sendWeeklyDigests(new Date(), { recent: true }, flaky);
    assert.equal(r2.sent, 1, "실패했던 구독자에게 재발송");
    assert.equal(r2.failed.length, 0);
    const rows = db.tables.deliveries.filter((d) => d.subscriber_id === "s5");
    assert.equal(rows.length, 1, "행이 중복 생성되지 않고 갱신됨");
    assert.equal(rows[0].status, "sent");
  });
  await ok("weekWindow: 월요일 09:00 KST 크론 실행 시 그 실행에서 수집한 항목이 포함되는 구간", () => {
    const cronTime = new Date("2026-09-21T00:00:00Z"); // 월 09:00 KST
    const w = weekWindow(cronTime);
    assert.equal(w.weekStart, "2026-09-21", "중복 방지 키는 이번 주 월요일");
    assert.equal(w.start.toISOString(), "2026-09-20T15:00:00.000Z", "start = 이번 주 월 00:00 KST");
    assert.equal(w.end.getTime(), cronTime.getTime(), "end = 지금");
    // 방금 수집된 항목(created_at = 크론 시각)은 포함, 지난주 크론 항목은 제외
    const justCollected = new Date(cronTime.getTime() + 60_000).toISOString();
    const lastWeekRun = new Date(cronTime.getTime() - 7 * 86400_000).toISOString();
    assert.ok(justCollected >= w.start.toISOString(), "이번 실행 수집분 포함");
    assert.ok(lastWeekRun < w.start.toISOString(), "지난주 실행 수집분 제외");
    // 이메일 표시 기간은 지난주 월 ~ 일
    assert.equal(w.periodStart.toISOString(), "2026-09-13T15:00:00.000Z");
    assert.equal(w.periodEnd.toISOString(), "2026-09-20T15:00:00.000Z");
  });
  await ok("월요일 크론 시나리오: 수집 직후 발송하면 그 항목이 메일에 들어간다", async () => {
    const cronTime = new Date("2026-09-21T00:05:00Z");
    // 크론 실행 중 저장된 항목(created_at = 크론 시각)
    db.tables.updates.push({ id: "u-cron", source: "mfds_rss:data0005", external_id: "cron-1", jurisdiction: "KR", title: "의료기기 허가·신고·심사 등에 관한 규정 일부개정고시", url: "https://x", published_at: "2026-09-19T00:00:00Z", raw: null, summary_ko: "발췌", impact: "high", catalog_ids: ["kr-approval"], matched_keywords: ["허가·신고·심사"], classified_at: cronTime.toISOString(), created_at: cronTime.toISOString() });
    db.tables.subscribers.push({ id: "s6", email: "cron@company.kr", unsubscribe_token: "tok6", active: true, products: [], catalog_ids: ["kr-approval"], last_sent_at: null });
    const before = sent.length;
    const r = await sendWeeklyDigests(cronTime, {}, mailer); // recent 옵션 없이 = 실제 크론과 동일
    assert.equal(r.failed.length, 0);
    const m = sent.slice(before).find((x) => x.to === "cron@company.kr");
    assert.ok(m, "크론 시각에 수집된 항목으로 메일이 발송되어야 함");
    assert.ok(m!.html.includes("허가·신고·심사"));
    assert.ok(m!.html.includes("2026. 09. 14.") && m!.html.includes("2026. 09. 20."), "표시 기간은 지난주 월~일");
  });

  console.log("\n[6] 구독 API 입력 검증");
  await ok("잘못된 입력은 400, 정상 입력은 저장된다", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    const call = async (body: unknown) => {
      const req = new Request("http://localhost/api/subscribe", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      const res = await POST(req as never);
      return { status: res.status, json: await res.json() };
    };
    const good = { email: "RA@Company.co.kr", consent: true, products: [{ name: "혈당측정기", category: "체외진단의료기기", catalogIds: ["kr-ivd-act", "eu-ivdr"] }] };
    assert.equal((await call({ ...good, consent: false })).status, 400, "동의 없음");
    assert.equal((await call({ ...good, email: "not-an-email" })).status, 400, "이메일 형식");
    assert.equal((await call({ ...good, products: [] })).status, 400, "품목 없음");
    assert.equal((await call({ ...good, products: [{ ...good.products[0], catalogIds: ["no-such-id"] }] })).status, 400, "존재하지 않는 카탈로그 ID");
    const r = await call(good);
    assert.equal(r.status, 200);
    assert.equal(r.json.catalogCount, 2);
    const row = db.tables.subscribers.find((s) => s.email === "ra@company.co.kr");
    assert.ok(row, "이메일은 소문자로 정규화되어 저장");
    assert.deepEqual(row!.catalog_ids, ["kr-ivd-act", "eu-ivdr"]);
    assert.ok(row!.consent_at);
    // 같은 이메일 재구독 → 갱신(중복 생성 아님)
    await call({ ...good, products: [{ name: "혈당측정기", category: "체외진단의료기기", catalogIds: ["kr-ivd-act"] }] });
    assert.equal(db.tables.subscribers.filter((s) => s.email === "ra@company.co.kr").length, 1);
  });
  await ok("구독해지: 토큰 일치 시 구독자 삭제 후 리다이렉트", async () => {
    const { GET } = await import("@/app/api/unsubscribe/route");
    const mk = (t: string) => ({ nextUrl: new URL(`http://localhost/api/unsubscribe?token=${t}`) }) as never;
    const res = await GET(mk("tok1"));
    assert.equal(res.headers.get("location"), "https://regtide.example/?unsub=ok");
    assert.ok(!db.tables.subscribers.some((s) => s.unsubscribe_token === "tok1"));
    const bad = await GET(mk("nope"));
    assert.equal(bad.headers.get("location"), "https://regtide.example/?unsub=invalid");
  });

  globalThis.fetch = realFetch;
  console.log(`\n${process.exitCode ? "실패한 항목이 있습니다." : `모든 검증 통과 (${passed}개)`}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
