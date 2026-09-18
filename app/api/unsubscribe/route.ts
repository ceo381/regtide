import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** 수신거부: 토큰 일치 시 구독자 레코드(이메일 포함)를 즉시 삭제 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!token) return NextResponse.redirect(`${site}/?unsub=invalid`);
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("subscribers").delete().eq("unsubscribe_token", token).select("id");
  if (error || !data?.length) return NextResponse.redirect(`${site}/?unsub=invalid`);
  return NextResponse.redirect(`${site}/?unsub=ok`);
}
