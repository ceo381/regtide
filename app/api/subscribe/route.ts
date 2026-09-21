import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CATALOG_BY_ID, PRODUCT_CATEGORIES } from "@/lib/catalog";
import { supabaseAdmin } from "@/lib/supabase";
import { notifyMilestoneIfReached } from "@/lib/admin-report";

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
  const { email, products } = parsed.data;

  const catalogIds = [...new Set(products.flatMap((p) => p.catalogIds))].filter((id) => CATALOG_BY_ID[id]);
  if (catalogIds.length === 0) return NextResponse.json({ error: "유효한 규격·인증을 선택하세요." }, { status: 400 });

  const sb = supabaseAdmin();
  // 신규 구독인지 확인 (기존 구독자의 설정 변경이면 마일스톤 알림 대상이 아님)
  const { data: existing } = await sb.from("subscribers").select("id").eq("email", email).maybeSingle();
  const isNew = !existing;

  const { error } = await sb.from("subscribers").upsert(
    {
      email,
      products,
      catalog_ids: catalogIds,
      consent_at: new Date().toISOString(),
      consent_ip: ip,
      consent_version: "v1",
      active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  if (error) return NextResponse.json({ error: "저장 중 오류가 발생했습니다." }, { status: 500 });

  // 신규 구독으로 활성 구독자 수가 N의 배수(기본 10)에 도달하면 운영자에게 즉시 알림 (실패해도 구독은 성공 처리)
  if (isNew) await notifyMilestoneIfReached();

  return NextResponse.json({ ok: true, catalogCount: catalogIds.length });
}
