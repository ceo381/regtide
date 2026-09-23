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
import { MFDS_FEEDS, mfdsRssAdapter, __mfdsRssInternals } from "@/lib/sources/mfds-rss";
import { MFDS_BOARD_BY_FEED, looksLikeRss, parseBoardList } from "@/lib/sources/mfds-board";
import { DISPS_SPEC, RECALL_SPEC, emediAdapter, parseEmediDetail, parseEmediTable, type EmediHttp } from "@/lib/sources/mfds-emedi";
import { itemsOf } from "@/lib/sources/types";
import { allAdapters, type SourceAdapter } from "@/lib/sources";
import { describeSource } from "@/lib/source-info";
import { consecutiveZeroRuns } from "@/lib/collect";
import { checkCollection, checkDisclaimerTemplate } from "@/lib/health";
import { computeChannels } from "@/lib/admin-data";
import { upsertChannel, validateChannel, listChannels } from "@/lib/channels";
import { __setWelcomeMailerForTest, nextMondaySend, renderWelcomeHtml } from "@/lib/welcome";

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
    const items = itemsOf(await mfdsRssAdapter("data0009").fetch(since));
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
  const sent: { to: string; subject: string; html: string; headers?: Record<string, string> }[] = [];
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
    assert.ok(m1.html.includes("RegTide 수집 기간") && m1.html.includes("8일"), "정보 수집 기간 표기");
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
  await ok("weekWindow: 매일 수집 체계 — 후보 구간은 최근 14일, 중복 방지 키는 이번 주 월요일", () => {
    const cronTime = new Date("2026-09-21T00:00:00Z"); // 월 09:00 KST
    const w = weekWindow(cronTime);
    assert.equal(w.weekStart, "2026-09-21", "중복 방지 키는 이번 주 월요일");
    assert.equal(w.start.toISOString(), new Date(cronTime.getTime() - 14 * 86400_000).toISOString(), "start = 14일 전");
    assert.equal(w.end.getTime(), cronTime.getTime(), "end = 지금");
    // 크론 시각 수집분과 지난주 수요일 일일 수집분 모두 후보에 포함 (중복은 deliveries.update_ids 로 제외)
    const justCollected = new Date(cronTime.getTime() + 60_000).toISOString();
    const lastWednesday = new Date(cronTime.getTime() - 5 * 86400_000).toISOString();
    assert.ok(justCollected >= w.start.toISOString(), "이번 실행 수집분 포함");
    assert.ok(lastWednesday >= w.start.toISOString(), "주중 일일 수집분 포함");
    // 이메일 표시 기간은 지난주 월 ~ 일
    assert.equal(w.periodStart.toISOString(), "2026-09-13T15:00:00.000Z");
    assert.equal(w.periodEnd.toISOString(), "2026-09-20T15:00:00.000Z");
  });
  await ok("월요일 크론 시나리오: 수집 직후 발송하면 그 항목이 메일에 들어간다", async () => {
    const cronTime = new Date("2026-09-21T00:05:00Z");
    // 크론 실행 중 저장된 항목(created_at > 크론 시작 시각)
    db.tables.updates.push({ id: "u-cron", source: "mfds_rss:data0005", external_id: "cron-1", jurisdiction: "KR", title: "의료기기 허가·신고·심사 등에 관한 규정 일부개정고시", url: "https://x", published_at: "2026-09-19T00:00:00Z", raw: null, summary_ko: "발췌", impact: "high", catalog_ids: ["kr-approval"], matched_keywords: ["허가·신고·심사"], classified_at: cronTime.toISOString(), created_at: new Date(cronTime.getTime() + 30_000).toISOString() }); // 크론 시작보다 30초 뒤 저장 — 상한 없이 포함되어야 함
    db.tables.subscribers.push({ id: "s6", email: "cron@company.kr", unsubscribe_token: "tok6", active: true, products: [], catalog_ids: ["kr-approval"], last_sent_at: null });
    const before = sent.length;
    const r = await sendWeeklyDigests(cronTime, {}, mailer); // recent 옵션 없이 = 실제 크론과 동일
    assert.equal(r.failed.length, 0);
    const m = sent.slice(before).find((x) => x.to === "cron@company.kr");
    assert.ok(m, "크론 시각에 수집된 항목으로 메일이 발송되어야 함");
    assert.ok(m!.html.includes("허가·신고·심사"));
    assert.ok(m!.html.includes("2026. 09. 14.") && m!.html.includes("2026. 09. 20."), "표시 기간은 지난주 월~일");
  });

  await ok("매일 수집 체계: 주중(수요일) 수집 항목이 다음 월요일 메일에 들어가고, 지난주에 보낸 항목은 다시 실리지 않는다", async () => {
    const nextMonday = new Date("2026-09-28T00:05:00Z");
    // 지난주 수요일(9/23) 일일 크론이 수집한 항목
    db.tables.updates.push({ id: "u-wed", source: "mfds_rss:ntc0021", external_id: "wed-1", jurisdiction: "KR", title: "의료기기 허가·신고·심사 규정 개정 안내", url: "https://x", published_at: "2026-09-23T00:00:00Z", raw: null, summary_ko: "발췌", impact: "medium", catalog_ids: ["kr-approval"], matched_keywords: ["허가·신고·심사"], classified_at: "2026-09-22T23:10:00Z", created_at: "2026-09-22T23:05:00Z" });
    const before = sent.length;
    const r = await sendWeeklyDigests(nextMonday, {}, mailer);
    assert.equal(r.failed.length, 0);
    const m = sent.slice(before).find((x) => x.to === "cron@company.kr");
    assert.ok(m, "다음 월요일 메일 발송");
    assert.ok(m!.html.includes("개정 안내"), "수요일 수집 항목 포함");
    assert.ok(!m!.html.includes("일부개정고시"), "지난주 월요일 메일에 이미 보낸 항목(u-cron)은 14일 창 안이어도 제외");
    const row = db.tables.deliveries.find((d) => d.subscriber_id === "s6" && d.week_start === "2026-09-28")!;
    assert.ok((row.update_ids as string[]).includes("u-wed") && !(row.update_ids as string[]).includes("u-cron"));
  });

  await ok("배치 발송: sendBatch 로 묶어 보내고(같은 멱등 키로 2회 시도), 모두 실패하면 개별 발송(구독자별 멱등 키)으로 대체한다", async () => {
    // 새 주(week) 로 가정하여 중복 방지 키를 피함
    const wk = new Date("2026-09-28T00:05:00Z");
    const batchCalls: number[] = [];
    const batchKeys: (string | undefined)[] = [];
    const singleKeys: (string | undefined)[] = [];
    let failLeft = 2;
    const batchMailer: Mailer = {
      async send(m, o) { sent.push(m); singleKeys.push(o?.idempotencyKey); return { id: `single_${sent.length}` }; },
      async sendBatch(ms, o) {
        batchCalls.push(ms.length);
        batchKeys.push(o?.idempotencyKey);
        if (failLeft > 0) { failLeft--; throw new Error("batch boom"); }
        ms.forEach((m) => sent.push(m));
        return ms.map((_, i) => ({ id: `batch_${i}` }));
      },
    };
    const wkKey0 = wk.toISOString().slice(0, 10);
    db.tables.deliveries = db.tables.deliveries.filter((d) => d.week_start !== wkKey0); // 앞선 시나리오의 같은 주 기록 제거
    const before = sent.length;
    const nActive = db.tables.subscribers.filter((x) => x.active).length;
    // 첫 호출: batch 실패 → 개별 발송으로 대체되어 활성 구독자 전원이 받음
    const r1 = await sendWeeklyDigests(wk, { sendEmpty: true, recent: true }, batchMailer);
    assert.equal(batchCalls.length, 2, "같은 묶음을 2회 시도");
    assert.ok(batchKeys[0] && batchKeys[0] === batchKeys[1], "재시도는 같은 멱등 키");
    assert.ok(singleKeys.every((k) => k && k.startsWith("regtide:2026-09-28:")), "개별 발송은 구독자별 멱등 키");
    assert.equal(new Set(singleKeys).size, singleKeys.length, "멱등 키는 구독자마다 다름");
    assert.equal(r1.sent, nActive);
    assert.deepEqual(r1.recordErrors, []);
    assert.equal(r1.failed.length, 0);
    assert.equal(sent.length - before, nActive);
    const wkKey = wk.toISOString().slice(0, 10);
    const rows = db.tables.deliveries.filter((d) => d.week_start === wkKey);
    assert.equal(rows.length, nActive);
    assert.ok(rows.every((d) => d.status === "sent" && String(d.provider_message_id).startsWith("single_")));
    // 두 번째 호출: 이미 sent 이므로 전부 skipped, 발송 없음
    const r2 = await sendWeeklyDigests(wk, { sendEmpty: true, recent: true }, batchMailer);
    assert.equal(r2.sent, 0);
    assert.equal(r2.skipped, nActive);
    // 기록 삭제 후 재호출: 이번엔 batch 성공 경로
    db.tables.deliveries = db.tables.deliveries.filter((d) => d.week_start !== wkKey);
    const r3 = await sendWeeklyDigests(wk, { sendEmpty: true, recent: true }, batchMailer);
    assert.equal(r3.sent, nActive);
    assert.equal(batchCalls[batchCalls.length - 1], nActive);
    assert.ok(db.tables.deliveries.filter((d) => d.week_start === wkKey).every((d) => String(d.provider_message_id).startsWith("batch_")));
    assert.ok(db.tables.subscribers.filter((x) => x.active).every((x) => x.last_sent_at), "last_sent_at 갱신");
  });

  await ok("테스트 발송(only): 지정한 한 명에게만 가고 deliveries 에 기록하지 않는다", async () => {
    const before = db.tables.deliveries.length;
    const n = sent.length;
    const r = await sendWeeklyDigests(new Date("2026-09-21T00:05:00Z"), { sendEmpty: true, recent: true, only: "tester@company.kr" }, mailer);
    assert.equal(r.sent, 1);
    assert.equal(sent.length, n + 1);
    assert.equal(sent[n].to, "tester@company.kr");
    assert.ok(sent[n].subject.startsWith("[테스트]"));
    assert.equal(db.tables.deliveries.length, before, "테스트 발송은 deliveries 에 기록되지 않아야 함");
    // 기존 구독자 지정 시에도 그 한 명에게만
    const r2 = await sendWeeklyDigests(new Date("2026-09-21T00:05:00Z"), { sendEmpty: true, recent: true, only: "GMP@company.kr" }, mailer);
    assert.equal(r2.sent, 1);
    assert.equal(sent[sent.length - 1].to, "gmp@company.kr");
    assert.equal(db.tables.deliveries.length, before);
  });

  console.log("\n[핵심 검증 A] 수집 누락 방지");
  await ok("모든 수집 어댑터가 출처 메타데이터(발행 기관·링크)에 등록되어 있다", async () => {
    const missing = allAdapters()
      .map((a) => a.key)
      .filter((k) => { const si = describeSource(k); return !si.url || si.agency === k; });
    assert.deepEqual(missing, [], `출처 미등록 소스: ${missing.join(", ")} → lib/source-info.ts 에 추가`);
  });
  await ok("수집 이력이 누적되고 '연속 0건' 소스를 계산할 수 있다", async () => {
    const last = JSON.parse(String(db.tables.page_snapshots.find((r) => r.source_key === "admin:last_collect")!.content));
    assert.ok(Array.isArray(last.history) && last.history.length >= 3, "collect 3회 실행 이력이 있어야 함");
    assert.equal(consecutiveZeroRuns(last.history, "mfds_rss:data0009"), 0, "정상 소스는 0");
    const fake = Array.from({ length: 8 }, (_, i) => ({ ranAt: String(i), bySource: { x: 0, y: i === 7 ? 0 : 1 }, errors: 0, skipped: 0 }));
    assert.equal(consecutiveZeroRuns(fake, "x"), 8);
    assert.equal(consecutiveZeroRuns(fake, "y"), 1);
    assert.equal(consecutiveZeroRuns(fake, "z"), 0, "이력에 없는 소스는 0");
  });

  console.log("\n[핵심 검증 B] 면책·고지");
  await ok("모든 다이제스트 메일에 면책 고지·원문 확인 안내·구독해지 링크가 있고 AI 언급이 없다", async () => {
    assert.ok(sent.length >= 3);
    for (const m of sent) {
      const footer = m.html.slice(m.html.indexOf("이용 안내 및 면책"));
      assert.ok(footer.length > 100, "면책 섹션 존재");
      assert.ok(footer.includes("참고용 정보"), "'참고용' 명시");
      assert.ok(footer.includes("법적 효력이 없습니다"), "법적 효력 부인");
      assert.ok(footer.includes("원문 링크에서 확인"), "원문 확인 안내");
      assert.ok(footer.includes("책임은 이용자에게"), "책임 귀속");
      assert.ok(footer.includes("/disclaimer"), "면책조항 전문 링크");
      assert.ok(footer.includes("/api/unsubscribe?token="), "구독해지 링크");
      assert.ok(!/\bAI\b|인공지능|자동 요약|생성형/.test(footer), "면책 문구에 AI 언급 금지");
      assert.ok(!m.html.includes("수신거부"), "'수신거부' 대신 '구독해지' 사용");
      assert.ok(m.html.includes("/?ref=fwd"), "전달 유입 링크(ref=fwd) 포함");
      assert.ok(m.html.includes("기능은 하나씩 늘어납니다") || m.html.includes("여러분이 뽑은 기능이 열렸습니다."), "새 기능 소식 블록 포함");
      // 규격 이름(EU AI Act, AI 의료기기 등)은 규제 대상이라 메일 본문에 나올 수 있음 — 금지 대상은 면책·안내 문구(위에서 검사)와 새 기능 블록
      const rmStart = Math.max(m.html.indexOf("인허가·품질 담당자의 일이 하나씩"), m.html.indexOf("여러분이 뽑은 기능이 열렸습니다."));
      const rm = m.html.slice(rmStart, m.html.indexOf("이 리포트가 도움이 되셨다면"));
      assert.ok(!/\bAI\b|인공지능/.test(rm), "새 기능 블록에 AI 언급 없음");
      assert.ok(m.html.includes("원 수신자 전용"), "전달받은 사람에게 구독해지 링크 주의 안내");
      if (!m.subject.startsWith("[테스트]")) {
        const lu = m.headers?.["List-Unsubscribe"] ?? "";
        assert.ok(/^<https:\/\/regtide\.example\/api\/unsubscribe\?token=.+>$/.test(lu), "List-Unsubscribe 헤더(확인 페이지): " + lu);
        assert.ok(!m.headers?.["List-Unsubscribe-Post"], "원클릭 해지 헤더는 넣지 않음(확인 페이지 경유)");
      }
    }
  });
  await ok("참고(low) 항목은 하단 압축 섹션에 제목만 싣고, 같은 소스가 4건을 넘으면 3건 + '외 N건 전체 보기' 링크로 접힌다", async () => {
    const { renderDigestHtml, renderLowSection } = await import("@/lib/digest");
    const mk = (i: number, impact: "high" | "low", source = "mfds_emedi:disps") => ({ id: `l${i}`, source, external_id: String(i), jurisdiction: "KR", title: `[행정처분] 처분 ${i} — 업체${i}`, url: `https://emedi.mfds.go.kr/disps/view/MNU20266?portalAdmDispsSeq=${i}`, published_at: "2026-09-20T00:00:00Z", raw: "발췌 본문 " + i, summary_ko: "발췌 본문 " + i, impact, catalog_ids: ["kr-vigilance"], matched_keywords: ["행정처분"], classified_at: "2026-09-21T00:00:00Z", created_at: "2026-09-21T00:00:00Z" });
    const sub = { id: "s1", email: "a@b.kr", products: [], catalog_ids: ["kr-vigilance"], unsubscribe_token: "tok", active: true, created_at: "", consent_version: "v2" };
    const rows = [mk(0, "high"), ...Array.from({ length: 6 }, (_, i) => mk(i + 1, "low")), mk(20, "low", "mfds_emedi:recall")];
    const html = renderDigestHtml(sub as never, rows as never, { start: new Date("2026-09-14T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z"), generatedAt: new Date("2026-09-21T00:00:00Z") });
    assert.ok(html.includes("총 8건 (주요 1건 · 참고 7건)"), "건수 표기");
    // 수집 기간 표기는 실제 실린 항목의 가장 이른 수집 시각까지 넓어진다 (첫 리포트 14일치와 어긋나지 않게)
    const early = [{ ...mk(90, "high"), created_at: "2026-09-10T00:00:00Z" }];
    const eh = renderDigestHtml(sub as never, early as never, { start: new Date("2026-09-14T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z"), generatedAt: new Date("2026-09-21T00:30:00Z"), firstReport: true });
    assert.ok(/RegTide 수집 기간<\/strong>: 2026\. 09\. 10\./.test(eh), "수집 기간 시작 = 가장 이른 항목 수집일");
    assert.ok(/기관 발표일<\/strong>: 2026\. 09\. 20\./.test(eh), "기관 발표일 범위 별도 표기");
    // 영향도 라벨은 서로 다른 채움 방식
    const big2 = renderDigestHtml(sub as never, [mk(1, "high"), { ...mk(2, "high"), impact: "medium" }, mk(3, "low")] as never, { start: new Date("2026-09-14T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z") });
    assert.ok(big2.includes("background:#d92d20;color:#ffffff") && big2.includes("background:#fef0c7;color:#93370d"), "즉시 조치·검토 필요 라벨 색 구분");
    assert.ok(eh.includes("첫 리포트이므로") && eh.includes("매일 오전 8시경 각 기관이"));
    assert.ok(!html.includes("첫 리포트이므로"), "첫 리포트가 아니면 안내 없음");
    assert.ok(html.includes("발췌 본문 0") && !html.includes("발췌 본문 1"), "참고 항목에는 발췌가 없다");
    assert.ok(html.includes("처분 1 —") && html.includes("처분 3 —") && !html.includes("처분 4 —"), "6건 중 3건만 제목 표시");
    assert.ok(html.includes("외 3건 — 의료기기안심책방 행정처분에서 전체 보기") && html.includes('href="https://emedi.mfds.go.kr/disps/MNU20266"'), "나머지는 소스 검색 화면 링크");
    assert.ok(html.includes("처분 20 —") && !html.includes("외 0건"), "4건 이하 소스는 전부 표시, 접힘 없음");
    assert.ok(html.includes("의료기기안심책방 회수/판매중지 · 1건"));
    assert.equal(renderLowSection([]), "");
    // 주요 항목이 없고 참고만 있으면 "변경 없음" 이 아니라 참고 섹션이 실린다
    const onlyLow = renderDigestHtml(sub as never, rows.slice(1, 3) as never, { start: new Date("2026-09-14T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z") });
    assert.ok(onlyLow.includes("아래 참고 항목만 확인") && !onlyLow.includes("감지되지 않았습니다") && onlyLow.includes("참고 <span"));
    // Gmail 잘림(약 102KB) 방지: 주요 60건 + 참고 60건이어도 100KB 미만, 면책·구독해지 링크 유지
    const big = [...Array.from({ length: 60 }, (_, i) => ({ ...mk(200 + i, "high"), source: "mfds_rss:data0009", summary_ko: "개정 고시 발췌 ".repeat(40) })), ...Array.from({ length: 60 }, (_, i) => mk(400 + i, "low"))];
    const bigHtml = renderDigestHtml(sub as never, big as never, { start: new Date("2026-09-14T00:00:00Z"), end: new Date("2026-09-21T00:00:00Z") });
    assert.ok(Buffer.byteLength(bigHtml) < 100 * 1024, `메일 크기 ${(Buffer.byteLength(bigHtml) / 1024).toFixed(1)}KB`);
    assert.ok(bigHtml.includes("그 밖의 주요 항목") && bigHtml.includes("· 35건") && bigHtml.includes("/api/unsubscribe?token=tok") && bigHtml.includes("법적 효력이 없습니다"));
    // 참고 줄에도 원문 링크(면책의 '원문에서 확인' 원칙)
    for (let i = 1; i <= 3; i++) assert.ok(html.includes(`portalAdmDispsSeq=${i}"`), `참고 ${i} 원문 링크`);
  });
  await ok("모든 항목에 출처·발표/감지 일시·수집 일시가 표기된다", async () => {
    const m = sent.find((x) => x.to === "gmp@company.kr")!;
    const items = m.html.split('<tr><td style="padding:16px 0').slice(1);
    assert.ok(items.length >= 1);
    for (const it of items) {
      assert.ok(it.includes("출처:"), "출처 표기");
      assert.ok(/(기관 발표|변경 감지)일시:/.test(it), "발표/감지 일시 표기");
      assert.ok(it.includes("RegTide 수집:"), "수집 일시 표기");
    }
  });

  await ok("상태 점검: 면책 템플릿 자체 점검이 통과하고, 수집 이상(오래됨·오류·연속 0건)을 감지한다", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://regtide.example";
    const disc = checkDisclaimerTemplate();
    assert.deepEqual(disc.filter((i) => i.level === "critical"), [], "면책 템플릿 필수 문구 누락 없음");
    const fresh = { ranAt: new Date().toISOString(), since: "", fetched: 1, inserted: 1, bySource: { "mfds_rss:data0009": 1 }, rawBySource: { "mfds_rss:data0009": 20 }, skipped: [], errors: [], history: [] };
    const stale = checkCollection({ ...fresh, ranAt: new Date(Date.now() - 40 * 3600_000).toISOString() });
    assert.ok(stale.some((i) => i.level === "critical" && i.title.includes("마지막 수집")), "40시간 전 수집 → 즉시 조치");
    const errored = checkCollection({ ...fresh, errors: [{ source: "federal_register", error: "HTTP 500" }] });
    assert.ok(errored.some((i) => i.level === "critical" && i.title.includes("소스 오류")), "소스 오류 → 즉시 조치");
    // 원본(필터 전) 건수가 0 인 실행이 7회 연속 + 예전에는 항목이 있었음 → 즉시 조치
    const hist = [
      { ranAt: "0", bySource: { "mfds_rss:ntc0021": 3 }, rawBySource: { "mfds_rss:ntc0021": 25 }, errors: 0, skipped: 0 },
      ...Array.from({ length: 7 }, (_, i) => ({ ranAt: String(i + 1), bySource: { "mfds_rss:ntc0021": 0 }, rawBySource: { "mfds_rss:ntc0021": 0 }, errors: 0, skipped: 0 })),
    ];
    const zero = checkCollection({ ...fresh, bySource: { "mfds_rss:ntc0021": 0 }, rawBySource: { "mfds_rss:ntc0021": 0 }, history: hist });
    assert.ok(zero.some((i) => i.level === "critical" && i.title.includes("수집 누락 경보")), "예전엔 오던 소스가 7회 연속 빈 응답 → 누락 경보");
    // 피드는 차 있는데(원본 25건) 의료기기 항목만 없어서 필터 후 0건 → 경보 아님 (오탐 방지)
    const quietOk = Array.from({ length: 8 }, (_, i) => ({ ranAt: String(i), bySource: { "mfds_rss:data0007": 0 }, rawBySource: { "mfds_rss:data0007": 25 }, errors: 0, skipped: 0 }));
    const notAlarm = checkCollection({ ...fresh, bySource: { "mfds_rss:data0007": 0 }, rawBySource: { "mfds_rss:data0007": 25 }, history: quietOk });
    assert.ok(!notAlarm.some((i) => i.title.includes("data0007") || i.title.includes("예규")), "피드가 살아 있고 의료기기 항목만 없는 경우는 경보 아님");
    // 한 번도 항목이 없던 소스가 7회 연속 빈 응답 → 확인 등급(warning)
    const never = Array.from({ length: 7 }, (_, i) => ({ ranAt: String(i), bySource: { "mfds_rss:seohan001": 0 }, rawBySource: { "mfds_rss:seohan001": 0 }, errors: 0, skipped: 0 }));
    const w = checkCollection({ ...fresh, bySource: { "mfds_rss:seohan001": 0 }, rawBySource: { "mfds_rss:seohan001": 0 }, history: never });
    assert.ok(w.some((i) => i.level === "warning" && i.title.includes("빈 응답")));
    assert.ok(checkCollection(null).some((i) => i.title === "수집 기록 없음"));
  });

  await ok("유입 채널: ref 가 저장되고, 재구독 시 최초 채널이 유지되며, 채널 통계가 계산된다", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    const body = (email: string, ref: string, landedAt?: string) => new Request("http://x/api/subscribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ email, consent: true, products: [{ name: "테스트", category: "3등급", catalogIds: ["kr-gmp"] }], ref, landedAt: landedAt ?? "", referrer: "open.kakao.com" }) });
    const landed = new Date(Date.now() - 5 * 60_000).toISOString();
    assert.equal((await POST(body("ch1@corp.co.kr", "openchat2", landed) as never)).status, 200);
    const row = db.tables.subscribers.find((s) => s.email === "ch1@corp.co.kr")!;
    assert.equal(row.ref, "openchat2");
    assert.equal(row.referrer, "open.kakao.com");
    assert.equal((await POST(body("ch1@corp.co.kr", "linkedin") as never)).status, 200);
    assert.equal(db.tables.subscribers.find((s) => s.email === "ch1@corp.co.kr")!.ref, "openchat2", "최초 유입 채널 유지");
    assert.equal((await POST(body("ch2@naver.com", "BAD ref!") as never)).status, 400, "허용되지 않는 ref 형식은 거부");
    const { channels } = computeChannels(db.tables.subscribers as never);
    const oc = channels.find((c) => c.ref === "openchat2")!;
    assert.ok(oc && oc.total === 1 && oc.companyDomains === 1 && oc.medianConvertMin! >= 4 && oc.medianConvertMin! <= 6 && oc.quickRate === 1 && oc.highRiskShare === 1);
    assert.ok(channels.some((c) => c.ref === "(직접/미상)"), "ref 없는 구독자는 직접/미상으로 집계");
  });

  await ok("채널 태그: 입력 검증·저장·통계 결합(전환율·게시 후 24h)", async () => {
    assert.equal(validateChannel({ code: "Bad Code", name: "x" }).ok, false);
    assert.equal(validateChannel({ code: "openchat2", name: "" }).ok, false);
    const posted = new Date(Date.now() - 2 * 3600_000);
    const v = validateChannel({ code: "openchat2", name: "오픈채팅 인허가방", kind: "오픈채팅", audience_size: "1,000", posted_at: posted.toISOString(), notes: "테스트" });
    assert.ok(v.ok);
    if (v.ok) { assert.equal(v.value.audience_size, 1000); await upsertChannel(v.value); }
    const v2 = validateChannel({ code: "openchat2", name: "오픈채팅 인허가방(수정)", kind: "오픈채팅", audience_size: "1000" });
    if (v2.ok) await upsertChannel(v2.value);
    const reg = await listChannels();
    assert.equal(reg.filter((r) => r.code === "openchat2").length, 1, "같은 코드는 덮어쓰기(중복 없음)");
    const { channels } = computeChannels(db.tables.subscribers as never, new Date(), reg.map((r) => ({ ...r, posted_at: posted.toISOString() })));
    const oc = channels.find((c) => c.ref === "openchat2")!;
    assert.equal(oc.registry?.name, "오픈채팅 인허가방(수정)");
    assert.equal(oc.conversionRate, 1 / 1000);
    assert.equal(oc.within24h, 1, "게시 후 24시간 내 구독 1명");
    assert.ok(oc.hoursSincePost! > 1.9 && oc.hoursSincePost! < 2.1);
    // 등록만 되고 구독자 없는 채널도 0명으로 표시
    const v3 = validateChannel({ code: "kmdia", name: "협회 공지", kind: "협회·조합" });
    if (v3.ok) await upsertChannel(v3.value);
    const { channels: ch2 } = computeChannels(db.tables.subscribers as never, new Date(), await listChannels());
    assert.ok(ch2.some((c) => c.ref === "kmdia" && c.total === 0));
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
    const welcomes: { to: string; subject: string; html: string }[] = [];
    __setWelcomeMailerForTest({ async send(m) { welcomes.push(m); return { id: "w" }; } });
    const r = await call(good);
    assert.equal(r.status, 200);
    assert.equal(r.json.catalogCount, 2);
    assert.equal(r.json.welcome, "sent");
    const row = db.tables.subscribers.find((s) => s.email === "ra@company.co.kr");
    assert.ok(row, "이메일은 소문자로 정규화되어 저장");
    assert.deepEqual(row!.catalog_ids, ["kr-ivd-act", "eu-ivdr"]);
    assert.ok(row!.consent_at);
    // 같은 이메일 재구독 → 갱신(중복 생성 아님). 방금 변경했으므로 확인 메일은 다시 보내지 않음(1시간 제한)
    const r2 = await call({ ...good, products: [{ name: "혈당측정기", category: "체외진단의료기기", catalogIds: ["kr-ivd-act"] }] });
    assert.equal(db.tables.subscribers.filter((s) => s.email === "ra@company.co.kr").length, 1);
    assert.equal(r2.json.welcome, "skipped", "설정 변경 직후 반복 신청에는 확인 메일을 보내지 않음");
    assert.equal(welcomes.length, 1);
    // 품목명은 선택 입력: 비워도(또는 아예 없어도) 저장되고, 표시 이름은 등급·유형으로 대체
    const r3 = await call({ email: "noname@company.co.kr", consent: true, products: [{ name: "", category: "2등급", catalogIds: ["kr-mdact"] }, { category: "이식형", catalogIds: ["iso-10993"] }] });
    assert.equal(r3.status, 200, "품목명 없이도 구독 가능");
    const nn = db.tables.subscribers.find((s) => s.email === "noname@company.co.kr")!;
    assert.deepEqual((nn.products as { name: string }[]).map((p) => p.name), ["", ""]);
    assert.equal(nn.consent_version, "v2", "동의 문구 버전 기록");
    const w = welcomes.find((m) => m.to === "noname@company.co.kr")!;
    assert.ok(w.html.includes("2등급 품목 1") && w.html.includes("이식형 품목 2"), "확인 메일에 등급·유형으로 표시");
    const { renderDigestHtml } = await import("@/lib/digest");
    const dh = renderDigestHtml({ id: "x", email: String(nn.email), unsubscribe_token: "t", products: nn.products as never, catalog_ids: ["kr-mdact"], active: true, last_sent_at: null }, [], { start: new Date(), end: new Date() });
    assert.ok(dh.includes("모니터링 품목: 2등급 품목 1, 이식형 품목 2"), "주간 리포트에도 등급·유형으로 표시");
    const { DEFAULT_CATALOG_BY_CATEGORY, CATALOG_BY_ID, PRODUCT_CATEGORIES } = await import("@/lib/catalog");
    for (const c of PRODUCT_CATEGORIES) {
      assert.ok(DEFAULT_CATALOG_BY_CATEGORY[c].length >= 5, `${c} 기본 세트`);
      for (const id of DEFAULT_CATALOG_BY_CATEGORY[c]) assert.ok(CATALOG_BY_ID[id], `${c} 기본 세트의 ${id} 가 카탈로그에 존재`);
    }
    __setWelcomeMailerForTest(null);
  });
  await ok("구독 확인 메일: 신청자 본인에게만, 품목·규격·발송 주기·첫 리포트 예정일·면책·구독해지 링크 포함, 실패해도 구독은 성공", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    const call = async (body: unknown) => {
      const req = new Request("http://localhost/api/subscribe", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
      const res = await POST(req as never);
      return { status: res.status, json: await res.json() };
    };
    const welcomes: { to: string; subject: string; html: string }[] = [];
    __setWelcomeMailerForTest({ async send(m) { welcomes.push(m); return { id: "w" }; } });
    const body = { email: "welcome@company.co.kr", consent: true, products: [{ name: "인공호흡기", category: "3등급", catalogIds: ["kr-mdact", "eu-mdr"] }] };
    const r = await call(body);
    assert.equal(r.status, 200);
    assert.equal(welcomes.length, 1);
    const m = welcomes[0];
    assert.equal(m.to, "welcome@company.co.kr", "수신자는 신청자 본인");
    assert.ok(m.subject.includes("구독이 완료"));
    assert.ok(m.html.includes("인공호흡기"), "등록 품목");
    assert.ok(m.html.includes("매주 월요일 오전 9시경(KST)"), "발송 주기");
    assert.ok(/첫 리포트 예정: <strong>[^<]*오전 9시경<\/strong>/.test(m.html), "첫 리포트 예정일은 오전 9시경으로 표기");
    assert.ok(m.html.includes("첫 리포트 예정"), "첫 리포트 예정일");
    assert.ok(m.html.includes("모니터링 대상"), "지원 국가·기관");
    const footer = m.html.slice(m.html.indexOf("이용 안내 및 면책"));
    for (const needle of ["참고용 정보", "법적 효력이 없습니다", "원문 링크에서 확인", "책임은 이용자에게", "/disclaimer", "/api/unsubscribe?token="]) assert.ok(footer.includes(needle), `면책: ${needle}`);
    assert.ok(!/\bAI\b|인공지능|자동 요약|생성형/.test(footer), "AI 언급 금지");
    assert.ok(!m.html.includes("수신거부"));
    const row = db.tables.subscribers.find((s) => s.email === "welcome@company.co.kr")!;
    assert.ok(m.html.includes(`token=${row.unsubscribe_token}`), "구독해지 링크가 본인 토큰");
    // 발송기가 죽어도 구독은 저장된다
    __setWelcomeMailerForTest({ async send() { throw new Error("resend down"); } });
    const r2 = await call({ ...body, email: "welcome2@company.co.kr" });
    assert.equal(r2.status, 200);
    assert.equal(r2.json.welcome, "failed");
    assert.ok(db.tables.subscribers.some((s) => s.email === "welcome2@company.co.kr"), "메일 실패와 무관하게 구독 저장");
    __setWelcomeMailerForTest(null);
    // 첫 리포트 예정일 계산: 월요일 09:00 KST
    const d = nextMondaySend(new Date("2026-09-22T06:00:00Z")); // 화요일 15:00 KST
    assert.equal(d.toISOString(), "2026-09-28T00:00:00.000Z");
    assert.equal(nextMondaySend(new Date("2026-09-27T23:30:00Z")).toISOString(), "2026-09-28T00:00:00.000Z", "월요일 09:00 전이면 당일");
    assert.equal(nextMondaySend(new Date("2026-09-28T01:00:00Z")).toISOString(), "2026-10-05T00:00:00.000Z", "월요일 09:00 이후면 다음 주");
    // 설정 변경 문구
    const html = renderWelcomeHtml({ id: "x", email: "a@b.c", unsubscribe_token: "t", products: [], catalog_ids: ["kr-mdact"], active: true, last_sent_at: null }, { isNew: false });
    assert.ok(html.includes("구독 설정이 변경되었습니다"));
  });
  await ok("구독해지: GET 은 확인 페이지만(삭제 없음), POST 로 토큰 일치 시 삭제 후 리다이렉트", async () => {
    const { GET, POST } = await import("@/app/api/unsubscribe/route");
    const mk = (t: string) => ({ nextUrl: new URL(`http://localhost/api/unsubscribe?token=${t}`) }) as never;
    // 메일 스캐너가 링크를 자동으로 열어도(GET) 구독이 지워지면 안 된다
    const view = await GET(mk("tok1"));
    assert.equal(view.status, 200);
    assert.ok((await view.text()).includes("구독을 해지할까요"));
    assert.ok(db.tables.subscribers.some((s) => s.unsubscribe_token === "tok1"), "GET 으로는 삭제되지 않아야 함");
    const post = (t: string) => { const fd = new FormData(); fd.set("token", t); return new Request("http://localhost/api/unsubscribe", { method: "POST", body: fd }); };
    const res = await POST(Object.assign(post("tok1"), { nextUrl: new URL("http://localhost/api/unsubscribe") }) as never);
    assert.equal(res.headers.get("location"), "https://regtide.example/?unsub=ok");
    assert.ok(!db.tables.subscribers.some((s) => s.unsubscribe_token === "tok1"));
    // 해지 통계: 식별 정보 없이 한 줄 남는다
    const u = db.tables.unsubscribes?.at(-1);
    assert.ok(u, "unsubscribes 행 생성");
    assert.equal(u!.reason, "user");
    for (const k of ["email", "subscriber_id", "unsubscribe_token", "domain"]) assert.ok(!(k in u!), `해지 통계에 ${k} 없음`);
    assert.equal(u!.catalog_count, 1); assert.deepEqual(u!.categories, ["2등급"]);
    assert.ok(Array.isArray(u!.categories));
    const { anonymizeForChurn } = await import("@/lib/churn");
    const a = anonymizeForChurn({ id: "x", email: "a@gmail.com", ref: "openchat1", created_at: "2026-09-21T00:00:00Z", catalog_ids: ["a", "b"], products: [{ category: "2등급" }, { category: "2등급" }], last_sent_at: null }, "user", 1, new Date("2026-09-28T00:00:00Z"));
    assert.equal(a.tenure_days, 7); assert.equal(a.mail_type, "personal"); assert.deepEqual(a.categories, ["2등급"]); assert.equal(a.deliveries_received, 1);
    assert.ok(!JSON.stringify(a).includes("gmail"), "도메인도 저장하지 않음");
    const bad = await POST(Object.assign(post("nope"), { nextUrl: new URL("http://localhost/api/unsubscribe") }) as never);
    assert.equal(bad.headers.get("location"), "https://regtide.example/?unsub=invalid");
  });

  await ok("유입 집계: /api/visit 가 ref·referrer 만 저장(IP 없음)하고, 채널 통계에 방문 수·방문→구독 전환율이 붙는다", async () => {
    const { POST } = await import("@/app/api/visit/route");
    const hit = async (body: unknown) => {
      const req = new Request("http://localhost/api/visit", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.9" } });
      return (await POST(req as never)).json();
    };
    await hit({ ref: "OpenChat1", referrer: "open.kakao.com" });
    await hit({ ref: "openchat1", referrer: "open.kakao.com" });
    await hit({ ref: "", referrer: "" });
    await hit({ ref: "<script>", referrer: "x" });
    const vs = db.tables.visits;
    assert.equal(vs.length, 4);
    assert.deepEqual(vs.map((v) => v.ref), ["openchat1", "openchat1", null, "script"], "ref 는 소문자·허용 문자만");
    for (const v of vs) assert.ok(!("ip" in v) && !("consent_ip" in v), "IP 저장 안 함");
    assert.equal(vs[0].referrer, "open.kakao.com");
    const { computeChannels } = await import("@/lib/admin-data");
    const subs = db.tables.subscribers.map((r, i) => ({ ...r, created_at: new Date().toISOString(), ref: i === 0 ? "openchat1" : r.ref }));
    const { channels } = computeChannels(subs as never, new Date(), [], vs as never);
    const oc = channels.find((c) => c.ref === "openchat1")!;
    assert.equal(oc.visits, 2);
    assert.ok(oc.visitConversion != null && oc.visitConversion > 0, "방문→구독 전환율 계산");
    const scr = channels.find((c) => c.ref === "script")!;
    assert.equal(scr.total, 0, "방문만 있고 구독자 없는 채널도 표시");
    assert.equal(scr.visits, 1);
    const { channels: noVisits } = computeChannels(subs as never, new Date(), [], null);
    assert.equal(noVisits[0].visits, null, "visits 테이블이 없으면 null (집계 전 표시)");
  });
  await ok("기능 투표·건의: 구독자 전용 링크(HMAC)만 통과, 라운드당 1회, 해지 시 함께 삭제, 마감·출시 표시가 요약과 메일 블록에 반영된다", async () => {
    process.env.CRON_SECRET ??= "test-secret";
    const { castVote, loadVoteSummary, closeRound, markReleased, createRound, recentlyReleased, listSuggestions, myVotes } = await import("@/lib/votes");
    const { roadmapBlockHtml } = await import("@/lib/email-common");
    const { voteToken, verifyVoteToken, voteUrl } = await import("@/lib/vote-token");
    const c = await createRound("1차", ["아카이브 | 지난 변경 검색", "조문 비교 | 신구 대비", "x"]);
    assert.ok(c.ok, c.error);
    let s = await loadVoteSummary();
    assert.ok(s.open && s.open.options.length === 3 && s.open.total === 0);
    const [o1, o2] = s.open!.options;
    // 투표할 구독자 2명 (활성 / 비활성)
    db.tables.subscribers.push({ id: "voter1", email: "voter1@company.kr", unsubscribe_token: "vt1", active: true, products: [], catalog_ids: ["kr-mdact"], last_sent_at: null });
    db.tables.subscribers.push({ id: "voter2", email: "voter2@company.kr", unsubscribe_token: "vt2", active: false, products: [], catalog_ids: ["kr-mdact"], last_sent_at: null });
    const t1 = voteToken("voter1");
    assert.ok(verifyVoteToken("voter1", t1) && !verifyVoteToken("voter1", "bad") && !verifyVoteToken("voter2", t1), "토큰은 구독자별·위조 불가");
    assert.ok(voteUrl("https://regtide.example", "voter1").startsWith("https://regtide.example/vote?s=voter1&t="));
    const { POST, GET } = await import("@/app/api/vote/route");
    let ipSeq = 0;
    const call = async (body: unknown, headers: Record<string, string> = {}) => {
      const req = new Request("http://localhost/api/vote", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": `10.0.1.${++ipSeq}`, ...headers } });
      const res = await POST(req as never);
      return { status: res.status, json: await res.json() };
    };
    // 토큰 없음/틀림 → 401, 다른 사이트 → 403, 비활성 구독자 → 400
    assert.equal((await call({ roundId: s.open!.id, optionIds: [o1.id] })).status, 401);
    assert.equal((await call({ roundId: s.open!.id, optionIds: [o1.id], s: "voter1", t: "bad" })).status, 401);
    assert.equal((await call({ roundId: s.open!.id, optionIds: [o1.id], s: "voter1", t: t1 }, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await call({ roundId: s.open!.id, optionIds: [o1.id], s: "voter2", t: voteToken("voter2") })).status, 400, "비활성 구독자 거부");
    // 정상 투표
    const r1 = await call({ roundId: s.open!.id, optionIds: [o1.id, o2.id, "not-an-option"], other: "  심사원 지적사항 사례 모음  ", ref: "OpenChat1", s: "voter1", t: t1 });
    assert.equal(r1.status, 200); assert.equal(r1.json.voted, 2); assert.equal(r1.json.suggested, true);
    // 같은 라운드 재투표 거부
    assert.equal((await call({ roundId: s.open!.id, optionIds: [o1.id], s: "voter1", t: t1 })).status, 400, "라운드당 1회");
    assert.deepEqual((await myVotes(s.open!.id, "voter1")).sort(), [o1.id, o2.id].sort());
    for (const v of db.tables.votes) assert.ok(!("email" in v) && !("ip" in v) && v.subscriber_id === "voter1", "투표 행에는 구독자 id 만 (이메일·IP 없음)");
    const sg = await listSuggestions();
    assert.equal(sg[0].message, "심사원 지적사항 사례 모음"); assert.equal(sg[0].subscriber_id, "voter1");
    // GET: 토큰이 있으면 본인 참여 내역
    const g = await GET(Object.assign(new Request(`http://localhost/api/vote?s=voter1&t=${t1}`), { nextUrl: new URL(`http://localhost/api/vote?s=voter1&t=${t1}`) }) as never).then((r) => r.json());
    assert.ok(g.verified && g.mine.length === 2 && g.open.participants === 1 && g.open.total === null, "득표 비공개 시 total 숨김");
    s = await loadVoteSummary();
    assert.equal(s.open!.total, 2); assert.equal(s.open!.participants, 1);
    // 메일 블록: 구독자별 링크
    let html = roadmapBlockHtml(new Date(), s, "voter1");
    assert.ok(!html.includes("/vote?s=voter1") && html.includes("투표해 주셔서 감사합니다"), "이미 투표한 구독자에게는 링크 대신 감사 문구: " + html);
    html = roadmapBlockHtml(new Date(), s, "voter2");
    assert.ok(html.includes("/vote?s=voter2&amp;t=") && html.includes("신규 기능 투표하기") && !html.includes("여러분이 뽑은 기능이 열렸습니다."));
    assert.ok(!html.includes("무료로 시작") && !html.includes("구독하고"), "메일 블록에는 랜딩용 구독 권유 문구가 없어야 함");
    assert.ok(!roadmapBlockHtml(new Date(), s, "health").includes("/vote?s="), "상태 점검 렌더링에는 개인 링크 없음");
    // 해지 시 투표·건의 함께 삭제 (cascade 를 흉내: 가짜 DB 는 cascade 가 없으므로 실제 스키마의 on delete cascade 를 문서로 보장. 여기서는 삭제 호출만 확인)
    // 닫힌 라운드에는 투표 불가, 출시 표시 반영
    assert.ok((await closeRound(s.open!.id, "메모")).ok);
    assert.ok(!(await castVote({ roundId: o1.round_id, optionIds: [o1.id], subscriberId: "voter1" })).ok);
    assert.ok((await markReleased(o1.id, true)).ok);
    s = await loadVoteSummary();
    assert.equal(s.open, null); assert.equal(s.released[0].label, "아카이브"); assert.equal(recentlyReleased(s).length, 1);
    html = roadmapBlockHtml(new Date(), s, "voter1");
    assert.ok(html.includes("여러분이 뽑은 기능이 열렸습니다.") && html.includes("아카이브") && !html.includes("신규 기능 투표하기"));
    assert.ok(!/\bAI\b|인공지능/.test(html));
    const { participantsLabel } = await import("@/lib/roadmap");
    assert.equal(participantsLabel(12), "", "30명 미만은 표시 안 함");
    assert.equal(participantsLabel(34), "지금까지 34명 참여");
    assert.equal(participantsLabel(137), "지금까지 100명 이상 참여");
    assert.ok((await createRound("2차", ["a | 1", "b | 2"])).ok);
    assert.ok((await loadVoteSummary()).open?.title === "2차");
  });
  await ok("대시보드 표 정렬: 숫자·문자·날짜 정렬, 빈 값은 항상 맨 뒤, 동률은 원래 순서", async () => {
    const { sortRows } = await import("@/app/admin/useSort");
    const rows = [{ n: 2, s: "나", d: "2026-09-02" }, { n: null, s: "", d: null }, { n: 10, s: "가", d: "2026-09-10" }, { n: 2, s: "다", d: "2026-09-01" }];
    assert.deepEqual(sortRows(rows, (r) => r.n, "desc").map((r) => r.n), [10, 2, 2, null]);
    assert.deepEqual(sortRows(rows, (r) => r.n, "asc").map((r) => r.n), [2, 2, 10, null], "빈 값은 오름차순에서도 맨 뒤");
    assert.deepEqual(sortRows(rows, (r) => r.n, "asc").map((r) => r.s), ["나", "다", "가", ""], "동률(2,2)은 원래 순서 유지");
    assert.deepEqual(sortRows(rows, (r) => r.s, "asc").map((r) => r.s), ["가", "나", "다", ""]);
    assert.deepEqual(sortRows(rows, (r) => r.d, "desc").map((r) => r.d), ["2026-09-10", "2026-09-02", "2026-09-01", null]);
  });

  await ok("식약처 RSS 장애 → 게시판 HTML 대체 수집 (같은 URL 형식으로 중복 없음, 경고 표시, 대응 게시판 없으면 오류)", async () => {
    const errPage = `<!DOCTYPE html><html><head><title>식품의약품안전처</title></head><body><p>일시적으로 서비스를 이용하실 수 없습니다.</p></body></html>`;
    assert.equal(looksLikeRss(errPage), false);
    assert.equal(looksLikeRss(`<?xml version="1.0"?><rss version="2.0"><channel><item><title>x</title></item></channel></rss>`), true);
    assert.equal(looksLikeRss(""), false);
    const li = (seq: string, title: string, date: string) => `<li><div class="num">1</div><div class="center_column"><a href="./view.do?seq=${seq}&amp;srchFr=&amp;page=1" class="title" title="자세히보기">  \n ${title} \n </a><div class="winfo"><p>담당부서 | 의료기기정책과</p></div></div><div class="right_column">${date}</div></li>`;
    const page = (items: string) => `<html><body><div class="bbs_list01"><ul>${items}</ul></div><div class="bbs_page"><ul><li class="on"><b>1</b></li></ul></div></body></html>`;
    const p1 = page(li("44298", "「의료기기법 시행규칙」 일부개정령(안) 입법예고", "2026-09-14") + li("44289", "「건강기능식품 기준·규격」 행정예고", "2026-09-13") + li("44280", "의료기기 허가·심사 규정 개정고시(안) 행정예고", "2026-08-01"));
    const rows = parseBoardList(p1, 209);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].url, "https://www.mfds.go.kr/brd/m_209/view.do?seq=44298", "RSS <link> 와 같은 형식이어야 중복 저장이 안 됨");
    assert.equal(rows[0].title, "「의료기기법 시행규칙」 일부개정령(안) 입법예고");
    assert.equal(rows[0].date?.toISOString(), "2026-09-13T15:00:00.000Z", "KST 자정 기준");
    const fetched: string[] = [];
    const fakeFetch = async (url: string) => { fetched.push(url); return url.endsWith("page=1") ? p1 : page(li("44100", "의료기기 옛날 공고", "2026-07-01")); };
    const r = await __mfdsRssInternals.fallbackToBoard("mfds_rss:data0009", "data0009", new Date("2026-09-01T00:00:00Z"), errPage, fakeFetch);
    assert.equal(r.items.length, 1, "since 이후 + 의료기기 제목만");
    assert.equal(r.items[0].externalId, "https://www.mfds.go.kr/brd/m_209/view.do?seq=44298");
    assert.equal(r.rawCount, 4, "1페이지에 since 이후 항목이 있으므로 2페이지까지 읽음 (3+1)");
    assert.ok(r.warnings?.[0].includes("일시 장애 페이지") && r.warnings[0].includes("m_209"), "대체 수집 사실이 경고로 남아야 함: " + r.warnings?.[0]);
    assert.deepEqual(fetched, ["https://www.mfds.go.kr/brd/m_209/list.do?page=1", "https://www.mfds.go.kr/brd/m_209/list.do?page=2"], "2페이지가 전부 since 이전이므로 거기서 중단");
    const r2 = await __mfdsRssInternals.fallbackToBoard("mfds_rss:data0009", "data0009", new Date("2026-07-15T00:00:00Z"), errPage, fakeFetch);
    assert.equal(r2.items.length, 2, "2페이지의 7/1 항목은 since 이전이라 제외, 1페이지 의료기기 2건");
    assert.ok(fetched.length >= 4);
    // 대응 게시판이 없는 피드는 오류 (상태 점검 errors 로 올라감)
    await assert.rejects(() => __mfdsRssInternals.fallbackToBoard("mfds_rss:data0006", "data0006", new Date(), errPage, fakeFetch), /대체 게시판 없음/);
    assert.ok(!("plc0139" in MFDS_FEEDS) && !("plc0168" in MFDS_FEEDS), "회수·행정처분 RSS 는 emedi 로 이관");
    for (const k of Object.keys(MFDS_BOARD_BY_FEED)) assert.ok(k in MFDS_FEEDS, `게시판 대응표의 ${k} 는 RSS 피드 목록에 있어야 함`);
    // 어댑터 경로: fetchText 가 오류 페이지를 돌려주면 자동으로 게시판으로
    globalThis.fetch = (async (url: string) => new Response(String(url).includes("/rss/") ? errPage : p1, { status: 200 })) as typeof fetch;
    const viaAdapter = await mfdsRssAdapter("data0009").fetch(new Date("2026-09-01T00:00:00Z"));
    assert.equal(itemsOf(viaAdapter).length, 1);
    assert.ok(!Array.isArray(viaAdapter) && viaAdapter.warnings?.length, "어댑터 결과에 경고 포함");
    globalThis.fetch = realFetch;
  });
  await ok("의료기기안심책방(emedi) 회수·행정처분 수집: 표·상세 해석, 총 건수 기준 페이징, 상세 실패 시 목록 정보로 저장", async () => {
    const link = (id: string) => `/recall/view/MNU20265?startPlanSbmsnDt=2026-08-20&amp;mid=MNU20265&amp;pageNum=1&amp;deptReceiptNo=${id}`;
    const tr = (id: string, cells: string[]) => `<tr class="cursor">${cells.map((c) => `<td> <a href="${link(id)}">${c}</a> </td>`).join("")}</tr>`;
    const table = (total: number, rows: string) => `<html><body><p class="page">총 <b>${total}</b>건</p><table><thead><tr><th>순번</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const p1 = table(12, Array.from({ length: 10 }, (_, i) => tr(`2026${String(i).padStart(8, "0")}`, [String(i + 1), `업체${i}`, `품목${i}`, `수인 ${i}`, "영업자 회수보고", "진행중", i === 0 ? "2026-09-22" : "2026-09-07"])).join(""));
    const p2 = table(12, tr("202600000010", ["11", "업체10", "품목10", "수인 10", "정부 회수보고", "완료", "2026-09-17"]) + tr("202600000011", ["12", "업체11", "품목11", "수인 11", "영업자 회수보고", "진행중", "2026-08-01"]));
    const parsed = parseEmediTable(p1, "deptReceiptNo");
    assert.equal(parsed.total, 12);
    assert.equal(parsed.rows.length, 10);
    assert.equal(parsed.rows[0].id, "202600000000");
    assert.equal(parsed.rows[0].cells[2], "품목0");
    const detailHtml = `<table><tr><th>업체명(업허가번호)</th><td>업체0 (제 1 호)</td></tr><tr><th>회수사유</th><td>팁이 <b>파손될</b> 가능성이 있음</td></tr><tr><th>위해성정도</th><td>「의료기기법」 시행규칙 \n 제52조제2항제1호</td></tr><tr><th>회수사유</th><td>중복</td></tr></table>`;
    const d = parseEmediDetail(detailHtml);
    assert.equal(d["회수사유"], "팁이 파손될 가능성이 있음", "첫 값 유지, 태그 제거");
    assert.equal(d["위해성정도"], "「의료기기법」 시행규칙 제52조제2항제1호");
    const calls: { m: string; path: string; form?: Record<string, string> }[] = [];
    const http: EmediHttp = {
      async get(path) { calls.push({ m: "GET", path }); if (path.includes("deptReceiptNo=202600000001")) throw new Error("timeout"); return path.includes("/view/") ? detailHtml : "<html>list</html>"; },
      async post(path, form) { calls.push({ m: "POST", path, form }); return form.pageNum === "1" ? p1 : p2; },
    };
    const since = new Date("2026-09-08T00:00:00Z");
    const r = await emediAdapter(RECALL_SPEC, http).fetch(since);
    const items = itemsOf(r);
    assert.equal(calls.filter((c) => c.m === "POST").length, 2, "총 12건 → 2페이지까지만");
    assert.equal(calls.find((c) => c.m === "POST")!.form!.searchYn, "true");
    assert.equal(calls.filter((c) => c.m === "POST")[1].form!.searchYn, "", "2페이지부터는 searchYn 비움");
    assert.deepEqual(items.map((i) => i.externalId).sort(), ["202600000000", "202600000010"], "보고일자가 since 이후인 것만 (9/7 은 제외, 8/1 제외)");
    const first = items.find((i) => i.externalId === "202600000000")!;
    assert.equal(first.source, "mfds_emedi:recall");
    assert.equal(first.title, "[회수·판매중지] 품목0 — 업체0");
    assert.equal(first.url, "https://emedi.mfds.go.kr/recall/view/MNU20265?mid=MNU20265&deptReceiptNo=202600000000");
    assert.ok(first.raw?.includes("회수사유: 팁이 파손될 가능성이 있음") && first.raw.includes("보고일자: 2026-09-22"));
    assert.equal(first.publishedAt?.toISOString(), "2026-09-21T15:00:00.000Z");
    assert.ok(!Array.isArray(r) && r.rawCount === 12 && !(r.warnings ?? []).length, "상세 실패는 since 이전 항목이라 조회하지 않음 → 경고 없음");
    // 상세 조회 실패 → 항목은 남고 경고
    const http2: EmediHttp = { async get(path) { if (path.includes("/view/")) throw new Error("500"); return ""; }, async post(_p, form) { return form.pageNum === "1" ? p1 : p2; } };
    const r2 = await emediAdapter(RECALL_SPEC, http2).fetch(since);
    assert.equal(itemsOf(r2).length, 2, "상세 실패해도 목록 정보로 항목 유지 (누락 방지)");
    assert.ok(!Array.isArray(r2) && r2.warnings?.[0].includes("상세 페이지 2건 조회 실패"), String(!Array.isArray(r2) && r2.warnings));
    // 표를 해석하지 못하면 오류 (구조 변경을 조용히 0건으로 넘기지 않음)
    const http3: EmediHttp = { async get() { return ""; }, async post() { return "<html><body>점검 중</body></html>"; } };
    await assert.rejects(() => emediAdapter(RECALL_SPEC, http3).fetch(since), /해석하지 못함/);
    // "조회된 결과가 없습니다" 는 정상 0건
    const http4: EmediHttp = { async get() { return ""; }, async post() { return "<html><body><table><tbody><tr><td>조회된 결과가 없습니다.</td></tr></tbody></table></body></html>"; } };
    assert.equal(itemsOf(await emediAdapter(RECALL_SPEC, http4).fetch(since)).length, 0);
    // 행정처분: 공개일자 기준, 상세의 처분명(전체)로 제목
    const dlink = (id: string) => `/disps/view/MNU20266?dispsEndDate=2026-09-23&amp;searchYn=true&amp;pageNum=1&amp;&amp;portalAdmDispsSeq=${id}`;
    const dtr = (id: string, cells: string[]) => `<tr>${cells.map((c) => `<td><a href="${dlink(id)}">${c}</a></td>`).join("")}</tr>`;
    const dp = `<html><body><p class="page">총 <b>2</b>건</p><table><tbody>${dtr("3422", ["27", "승원산업", "-", "전 제조업무정지 3개월(2026. 9. 2...", "2026-09-02", "2026-09-21"])}${dtr("3400", ["26", "옛날업체", "-", "경고", "2026-08-01", "2026-08-05"])}</tbody></table></body></html>`;
    const ddetail = `<table><tr><th>업체명</th><td>승원산업</td></tr><tr><th>업종명</th><td>제조업</td></tr><tr><th>처분명</th><td>전 제조업무정지 3개월(2026. 9. 21. ~ 2026. 12. 20.)</td></tr><tr><th>처분기간</th><td>2026-09-21 ~ 2026-12-20</td></tr><tr><th>위반내용</th><td>품질책임자 미지정(2차)</td></tr></table>`;
    const dhttp: EmediHttp = { async get(path) { return path.includes("/view/") ? ddetail : ""; }, async post(path, form) { calls.push({ m: "POST", path, form }); return dp; } };
    // 페이징이 무시되어 같은 페이지가 반복되는 경우(총 건수 없음, 10건 가득) → 무한 진행 없이 중단 + 경고
    const full = `<html><body><table><tbody>${Array.from({ length: 10 }, (_, i) => dtr(String(100 + i), [String(10 - i), `업체${i}`, "-", "경고", "2026-09-10", "2026-09-21"])).join("")}</tbody></table></body></html>`;
    const rep = await emediAdapter(DISPS_SPEC, { async get() { return ""; }, async post() { return full; } }).fetch(since);
    assert.equal(itemsOf(rep).length, 10);
    assert.ok(!Array.isArray(rep) && rep.warnings?.[0].includes("페이징이 동작하지 않아"), String(!Array.isArray(rep) && rep.warnings));
    const dr = itemsOf(await emediAdapter(DISPS_SPEC, dhttp).fetch(since));
    assert.equal(dr.length, 1, "공개일자 8/5 건은 since 이전");
    assert.equal(dr[0].title, "[행정처분] 전 제조업무정지 3개월(2026. 9. 21. ~ 2026. 12. 20.) — 승원산업");
    assert.equal(dr[0].externalId, "3422");
    assert.equal(dr[0].url, "https://emedi.mfds.go.kr/disps/view/MNU20266?portalAdmDispsSeq=3422");
    assert.equal(dr[0].publishedAt?.toISOString(), "2026-09-20T15:00:00.000Z", "공개일자 기준");
    assert.ok(dr[0].raw?.includes("위반내용: 품질책임자 미지정(2차)"));
    const dposts = calls.filter((c) => c.path === "/disps/MNU20266");
    const dform = dposts[0].form!;
    assert.equal(dform.searchYn, "true");
    assert.equal(dposts.length, 1, "총 2건 < 10 이므로 1페이지에서 끝");
    assert.ok(dform.dispsStartDate < "2026-08-01", "처분일 검색은 since 보다 넉넉히 앞당김 (공개 지연 흡수): " + dform.dispsStartDate);
    // 소스 메타·카탈로그 연결
    assert.equal(describeSource("mfds_emedi:recall").name, "의료기기안심책방 회수/판매중지");
    assert.equal(describeSource("mfds_emedi:disps").jurisdiction, "KR");
    const keys = allAdapters().map((a) => a.key);
    assert.ok(keys.includes("mfds_emedi:recall") && keys.includes("mfds_emedi:disps") && !keys.includes("mfds_rss:plc0139"));
    const { CATALOG } = await import("@/lib/catalog");
    const vig = CATALOG.find((c) => c.id === "kr-vigilance")!;
    assert.ok(vig.sources.includes("mfds_emedi:recall") && vig.sources.includes("mfds_emedi:disps"));
    // 분류: 제목에 "의료기기" 가 없어도(품목명·업체명뿐) 시판후 관리 규격으로 매칭되어야 리포트에 실린다
    const { classifyOne } = await import("@/lib/classify");
    const asRow = (u: typeof first) => ({ id: "x", source: u.source, external_id: u.externalId, jurisdiction: u.jurisdiction, title: u.title, url: u.url ?? null, published_at: null, raw: u.raw ?? null, summary_ko: null, impact: null, catalog_ids: [], matched_keywords: [], classified_at: null, created_at: "" });
    const c1 = classifyOne(asRow(first) as never);
    assert.deepEqual(c1.catalog_ids, ["kr-vigilance"], "회수는 시판후 관리 규격에만: " + JSON.stringify(c1));
    assert.equal(c1.impact, "low");
    assert.equal(classifyOne(asRow({ ...first, title: "[회수·판매중지] 시행 기준 개정 고시 적용 품목 — 업체" }) as never).impact, "low", "제목에 개정·고시가 섞여도 참고");
    const disWithLaw = { ...dr[0], raw: (dr[0].raw ?? "") + "\n위반법령: 「의료기기법」 제6조, 「의료기기법 시행규칙」 제36조 · 표시·기재 · 광고 · 공급내역 보고" };
    const c2 = classifyOne(asRow(disWithLaw) as never);
    assert.deepEqual(c2.catalog_ids, ["kr-vigilance"], "행정처분은 발췌에 법령명이 있어도 시판후 관리 규격에만: " + JSON.stringify(c2));
    assert.equal(c2.impact, "low");
  });

  globalThis.fetch = realFetch;
  console.log(`\\n${process.exitCode ? "실패한 항목이 있습니다." : `모든 검증 통과 (${passed}개)`}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
