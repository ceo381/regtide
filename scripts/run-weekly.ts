/**
 * 로컬에서 주간 파이프라인을 수동 실행합니다.
 *   npx tsx --env-file=.env scripts/run-weekly.ts            # 전체
 *   npx tsx --env-file=.env scripts/run-weekly.ts collect     # 수집만
 *   npx tsx --env-file=.env scripts/run-weekly.ts classify    # 분류만
 *   npx tsx --env-file=.env scripts/run-weekly.ts send        # 발송만
 *   npx tsx --env-file=.env scripts/run-weekly.ts dry         # 수집 결과만 콘솔 출력 (DB 미사용)
 * 옵션:
 *   --recent      집계 구간을 "최근 8일"로 (주중 테스트용. 기본은 지난주 월~이번주 월)
 *   --send-empty  해당 항목이 없어도 메일 발송 (템플릿 확인용)
 *   --only=이메일  그 한 명에게만 테스트 발송 (deliveries 미기록). 로컬에서 send 는 --only 없이는 거부됨
 */
import { collectUpdates } from "../lib/collect";
import { classifyPending } from "../lib/classify";
import { sendWeeklyDigests } from "../lib/digest";
import { allAdapters } from "../lib/sources";

async function main() {
  const step = process.argv[2] ?? "all";
  const since = new Date(Date.now() - 8 * 86400_000);

  if (step === "dry") {
    for (const a of allAdapters()) {
      if (a.key.startsWith("page_watch")) continue; // 스냅샷 DB 필요
      try {
        const items = await a.fetch(since);
        console.log(`\n■ ${a.label} (${a.key}) — ${items.length}건`);
        for (const it of items.slice(0, 5)) console.log(`  - [${it.publishedAt?.toISOString().slice(0, 10) ?? "----"}] ${it.title}\n    ${it.url}`);
      } catch (e) {
        console.log(`\n■ ${a.label} — 실패: ${(e as Error).message}`);
      }
    }
    return;
  }
  if (step === "all" || step === "collect") console.log("collect", await collectUpdates(since));
  if (step === "all" || step === "classify") console.log("classify", await classifyPending());
  if (step === "all" || step === "send") {
    const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
    if (!only && !process.argv.includes("--confirm-all")) {
      console.error("전체 구독자 발송은 --confirm-all 을 붙여야 합니다. 한 명 테스트: --only=이메일");
      process.exit(1);
    }
    console.log("send", await sendWeeklyDigests(new Date(), { sendEmpty: process.argv.includes("--send-empty"), recent: process.argv.includes("--recent"), only }));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
