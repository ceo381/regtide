import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CATALOG_BY_ID, PRODUCT_CATEGORIES } from "@/lib/catalog";
import { supabaseAdmin, type SubscriberRow } from "@/lib/supabase";
import { notifyMilestoneIfReached } from "@/lib/admin-report";
import { sendWelcomeEmail } from "@/lib/welcome";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  consent: z.literal(true, { errorMap: () => ({ message: "개인정보 수집·이용에 동의해야 합니다." }) }),
  products: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        category: z.enum(PRODUCT_CATEGORIES),
        catalogIds: z.array(z.string()).min(1).max(60),
      }),
    )
    .min(1, "품목을 1개 이상 등록하세요.")
    .max(30),
  // 유입 채널 (선택). 링크의 ?ref=코드 를 브라우저가 기억했다가 함께 보냄
  ref: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/).optional().or(z.literal("").transform(() => undefined)),
  landedAt: z.string().datetime().optional().or(z.literal("").transform(() => undefined)),
  referrer: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
});

// 아주 단순한 IP 기준 rate limit (서버리스 인스턴스 단위)
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 10;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다." }, { status: 400 });
  }
  const { email, products, ref, landedAt, referrer } = parsed.data;

  const catalogIds = [...new Set(products.flatMap((p) => p.catalogIds))].filter((id) => CATALOG_BY_ID[id]);
  if (catalogIds.length === 0) return NextResponse.json({ error: "유효한 규격·인증을 선택하세요." }, { status: 400 });

  const sb = supabaseAdmin();
  // 신규 구독인지 확인 (기존 구독자의 설정 변경이면 마일스톤 알림 대상이 아님)
  const { data: existing } = await sb.from("subscribers").select("id, ref, landed_at, referrer, updated_at").eq("email", email).maybeSingle();
  const isNew = !existing;
  // 유입 채널은 최초 유입(first-touch)만 기록. 기존 값이 있으면 필드별로 유지하고, 비어 있던 필드만 채운다
  const ex = (existing ?? {}) as { ref?: string | null; landed_at?: string | null; referrer?: string | null };
  const channel = {
    ref: ex.ref ?? ref ?? null,
    landed_at: ex.landed_at ?? landedAt ?? null,
    referrer: ex.referrer ?? referrer ?? null,
  };

  const now = new Date();
  const { data: saved, error } = await sb
    .from("subscribers")
    .upsert(
      {
        email,
        products,
        catalog_ids: catalogIds,
        consent_at: now.toISOString(),
        consent_ip: ip,
        consent_version: "v1",
        active: true,
        updated_at: now.toISOString(),
        ...channel,
      },
      { onConflict: "email" },
    )
    .select("id, email, unsubscribe_token, products, catalog_ids, active, last_sent_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "저장 중 오류가 발생했습니다." }, { status: 500 });

  // 구독 확인 메일 — 신청한 주소로 1회. 기존 구독자의 설정 변경은 1시간에 한 번만(같은 주소로 반복 신청해 메일을 쏟아붓는 악용 방지).
  // 실패해도 구독은 성공 처리 (구독자 데이터가 우선). 운영자 주소로는 절대 가지 않음 — 수신자는 신청자 본인뿐.
  const prevUpdated = (existing as { updated_at?: string | null } | null)?.updated_at;
  const recentlyChanged = !!prevUpdated && now.getTime() - new Date(prevUpdated).getTime() < 3600_000;
  let welcome: "sent" | "skipped" | "failed" = "skipped";
  if (saved && (isNew || !recentlyChanged)) {
    try {
      await sendWelcomeEmail(saved as SubscriberRow, { isNew, now });
      welcome = "sent";
    } catch (e) {
      welcome = "failed";
      console.error("[subscribe] 구독 확인 메일 실패:", (e as Error).message ?? e);
    }
  }

  // 신규 구독으로 활성 구독자 수가 N의 배수(기본 10)에 도달하면 운영자에게 즉시 알림 (실패해도 구독은 성공 처리)
  if (isNew) await notifyMilestoneIfReached();

  return NextResponse.json({ ok: true, catalogCount: catalogIds.length, welcome });
}
