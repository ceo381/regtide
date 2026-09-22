import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { COLLECT_LOOKBACK_DAYS, collectUpdates } from "@/lib/collect";
import { classifyPending } from "@/lib/classify";
import { sendWeeklyDigests } from "@/lib/digest";
import { ADMIN_EMAIL, sendDailyAdminReport } from "@/lib/admin-report";
import { supabaseAdmin } from "@/lib/supabase";
import { deleteChannel, upsertChannel, validateChannel } from "@/lib/channels";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * 대시보드 액션 (관리자 세션 필수). form POST → 처리 후 /admin 으로 리다이렉트(결과 메시지 쿠키 대신 쿼리로 전달)
 *   action=collect     지난 8일 수집
 *   action=classify    미분류 항목 분류
 *   action=testsend    운영자에게만 테스트 다이제스트 (recent 창)
 *   action=dailyreport 운영 리포트 즉시 발송
 *   action=deactivate  구독자 비활성화 (id)
 *   action=delete      구독자 삭제 (id)
 *   action=channel_save    채널 등록/수정 (code,name,kind,audience_size,posted_at,notes)
 *   action=channel_delete  채널 등록 삭제 (code) — 구독자의 ref 값은 그대로 남음
 * 전체 구독자 발송은 의도적으로 제공하지 않음 (월요일 크론 전용).
 */
export async function POST(req: NextRequest) {
  if (!(await getAdminSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const tab = String(form.get("tab") ?? "").replace(/[^a-z]/g, "");
  const back = (msg: string) => NextResponse.redirect(new URL(`/admin?msg=${encodeURIComponent(msg)}${tab ? `#${tab}` : ""}`, req.url), 303);

  try {
    if (action === "collect") {
      const r = await collectUpdates(new Date(Date.now() - COLLECT_LOOKBACK_DAYS * 86400_000));
      return back(`수집 완료: 가져옴 ${r.fetched} · 신규 ${r.inserted} · 건너뜀 ${r.skipped.length} · 오류 ${r.errors.length}`);
    }
    if (action === "classify") {
      const r = await classifyPending();
      return back(`분류 완료: ${r.classified}건 처리 · ${r.matched}건 규격 매칭 · 오류 ${r.errors.length}`);
    }
    if (action === "testsend") {
      const r = await sendWeeklyDigests(new Date(), { sendEmpty: true, recent: true, only: ADMIN_EMAIL() });
      return back(r.sent ? `테스트 다이제스트를 ${ADMIN_EMAIL()} 로 보냈습니다.` : `테스트 발송 실패: ${r.failed[0]?.error ?? "알 수 없음"}`);
    }
    if (action === "dailyreport") {
      const r = await sendDailyAdminReport(new Date());
      return back(`운영 리포트 발송: 구독자 ${r.totalActive}명 · 신규 ${r.newSubscribers}명`);
    }
    if (action === "deactivate" || action === "delete") {
      const id = String(form.get("id") ?? "");
      if (!id) return back("구독자 id 가 없습니다.");
      const sb = supabaseAdmin();
      if (action === "delete") {
        const { error } = await sb.from("subscribers").delete().eq("id", id);
        if (error) throw error;
        return back("구독자를 삭제했습니다.");
      }
      const { error } = await sb.from("subscribers").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
      return back("구독자를 비활성화했습니다. (발송 대상에서 제외)");
    }
    if (action === "channel_save") {
      const v = validateChannel(Object.fromEntries(form.entries()));
      if (!v.ok) return back(`채널 저장 실패: ${v.error}`);
      await upsertChannel(v.value);
      return back(`채널 "${v.value.name}" (${v.value.code}) 저장. 링크: ${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/?ref=${v.value.code}`);
    }
    if (action === "channel_delete") {
      const code = String(form.get("code") ?? "").trim();
      if (!code) return back("채널 코드가 없습니다.");
      await deleteChannel(code);
      return back(`채널 등록 "${code}" 을 삭제했습니다. (구독자의 채널 값은 유지됩니다)`);
    }
    return back("알 수 없는 작업입니다.");
  } catch (e) {
    return back(`오류: ${String((e as Error).message ?? e)}`);
  }
}
