import { NextRequest, NextResponse } from "next/server";
import { notifyMilestoneIfReached, sendDailyAdminReport } from "@/lib/admin-report";
import { COLLECT_LOOKBACK_DAYS, collectUpdates } from "@/lib/collect";
import { classifyAll } from "@/lib/classify";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Hobby(Fluid) 최대. 수집은 어댑터당 40초 상한이 별도로 있음
export const dynamic = "force-dynamic";

/**
 * 매일 23:00 UTC (= 08:00 KST) Vercel Cron 이 호출.
 *  1) 수집 + 분류 — 수집 누락 방지의 핵심. 식약처 RSS 는 최근 20~30건만 제공하므로 주 1회 수집이면
 *     게시가 많은 피드(보도자료·공지)에서 의료기기 항목이 목록 밖으로 밀려나 영구 누락될 수 있다.
 *     매일 수집하면 8일 되돌아보기와 겹쳐 하루이틀 실패해도 따라잡는다. 발송은 하지 않는다(월요일 크론 전용).
 *  2) 마일스톤(구독자 N명 달성) 미발송분 확인
 *  3) 운영자 일일 리포트
 * 수동 실행: curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/daily-report
 *   ?only=milestone : 마일스톤 확인만
 *   ?skipCollect=1  : 수집·분류 생략 (리포트만)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const out: Record<string, unknown> = { ranAt: now.toISOString() };
  try {
    if (req.nextUrl.searchParams.get("only") === "milestone") {
      out.milestone = await notifyMilestoneIfReached();
      return NextResponse.json(out);
    }
    if (req.nextUrl.searchParams.get("skipCollect") !== "1") {
      try {
        out.collect = await collectUpdates(new Date(now.getTime() - COLLECT_LOOKBACK_DAYS * 86400_000));
        out.classify = await classifyAll();
      } catch (e) {
        // 수집이 실패해도 리포트는 보내야 운영자가 알 수 있다
        out.collectError = String((e as Error).message ?? e);
      }
    }
    out.milestone = await notifyMilestoneIfReached();
    out.daily = await sendDailyAdminReport(now);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ...out, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
