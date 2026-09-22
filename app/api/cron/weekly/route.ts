import { NextRequest, NextResponse } from "next/server";
import { COLLECT_LOOKBACK_DAYS, collectUpdates } from "@/lib/collect";
import { classifyPending } from "@/lib/classify";
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
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const step = req.nextUrl.searchParams.get("step") ?? "all";
  const now = new Date();
  const since = new Date(now.getTime() - COLLECT_LOOKBACK_DAYS * 86400_000);
  const out: Record<string, unknown> = { ranAt: now.toISOString(), week: weekWindow(now).weekStart };

  try {
    if (step === "all" || step === "collect") out.collect = await collectUpdates(since);
    if (step === "all" || step === "classify") out.classify = await classifyPending();
    if (step === "all" || step === "send") out.send = await sendWeeklyDigests(now, { sendEmpty: req.nextUrl.searchParams.get("sendEmpty") !== "0", recent: req.nextUrl.searchParams.get("recent") === "1" });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ...out, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
