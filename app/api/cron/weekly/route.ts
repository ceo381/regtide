import { NextRequest, NextResponse } from "next/server";
import { COLLECT_LOOKBACK_DAYS, collectUpdates } from "@/lib/collect";
import { classifyAll } from "@/lib/classify";
import { sendWeeklyDigests, weekWindow } from "@/lib/digest";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro 기준. Hobby는 60초 → README 참고
export const dynamic = "force-dynamic";

/**
 * 매주 월요일 00:00 UTC (= 09:00 KST) Vercel Cron 이 호출.
 * 1) 지난 8일치 수집 → 2) 미분류 항목 규칙 기반 분류 → 3) 구독자별 다이제스트 발송
 * 수동 실행: curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/weekly
 * ?step=collect|classify|send 로 단계별 실행 가능 (타임아웃 회피용)
 * ?recent=1 집계 구간을 최근 8일로 (테스트용)
 * ?sendEmpty=0 변경 없는 구독자에게는 발송하지 않음 (기본은 변경이 없어도 "이번 주 변경 없음" 메일을 보냄)
 * ?only=이메일  그 한 명에게만 테스트 발송 (deliveries 미기록, 제목에 [테스트])
 *
 * 안전장치: Vercel Cron 이 아닌 수동 호출로 "전체 발송"(step=send 또는 step 생략)을 하려면 ?confirm=all 을 붙여야 한다.
 *          붙이지 않으면 400 으로 거부한다. 구독자 전체에게 실수로 보내는 일을 막기 위한 것.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const step = req.nextUrl.searchParams.get("step") ?? "all";
  const only = req.nextUrl.searchParams.get("only")?.trim() || undefined;
  const willSend = step === "all" || step === "send";
  const fromVercelCron = (req.headers.get("user-agent") ?? "").toLowerCase().includes("vercel-cron");
  if (willSend && !only && !fromVercelCron && req.nextUrl.searchParams.get("confirm") !== "all") {
    return NextResponse.json(
      {
        error: "refused",
        message: "수동 호출로 구독자 전체에게 발송하려면 ?confirm=all 을 붙이세요. 한 명에게만 테스트하려면 ?step=send&only=이메일 을 사용하세요. 수집·분류만 하려면 ?step=collect / ?step=classify.",
      },
      { status: 400 },
    );
  }
  const now = new Date();
  const since = new Date(now.getTime() - COLLECT_LOOKBACK_DAYS * 86400_000);
  const out: Record<string, unknown> = { ranAt: now.toISOString(), week: weekWindow(now).weekStart };

  // 단계별로 독립 실행: 수집·분류가 실패해도 이미 분류된 항목으로 발송은 진행 (월요일 메일이 통째로 빠지지 않도록)
  if (step === "all" || step === "collect") {
    try { out.collect = await collectUpdates(since); } catch (e) { out.collectError = String((e as Error).message ?? e); }
  }
  if (step === "all" || step === "classify") {
    try { out.classify = await classifyAll(); } catch (e) { out.classifyError = String((e as Error).message ?? e); }
  }
  if (step === "all" || step === "send") {
    try {
      out.send = await sendWeeklyDigests(now, { sendEmpty: req.nextUrl.searchParams.get("sendEmpty") !== "0", recent: req.nextUrl.searchParams.get("recent") === "1", only });
      if (only) out.testOnly = only;
    } catch (e) {
      out.sendError = String((e as Error).message ?? e);
      return NextResponse.json(out, { status: 500 });
    }
  }
  return NextResponse.json(out);
}
