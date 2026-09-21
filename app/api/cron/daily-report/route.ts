import { NextRequest, NextResponse } from "next/server";
import { notifyMilestoneIfReached, sendDailyAdminReport } from "@/lib/admin-report";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * 매일 23:00 UTC (= 08:00 KST) Vercel Cron 이 호출 → 운영자(ADMIN_EMAIL)에게 구독자 현황 리포트 발송.
 * 먼저 마일스톤(구독자 N명 달성) 미발송분을 확인해 보내고, 이어서 일일 리포트를 보낸다.
 * 수동 실행: curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/cron/daily-report
 *   ?only=milestone : 마일스톤 확인만 (일일 리포트는 보내지 않음)
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  try {
    const milestone = await notifyMilestoneIfReached();
    if (req.nextUrl.searchParams.get("only") === "milestone") return NextResponse.json({ ranAt: now.toISOString(), milestone });
    const daily = await sendDailyAdminReport(now);
    return NextResponse.json({ ranAt: now.toISOString(), milestone, daily });
  } catch (e) {
    return NextResponse.json({ ranAt: now.toISOString(), error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
