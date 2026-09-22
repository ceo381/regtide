import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * 유입(방문) 집계 — 랜딩 페이지가 로드될 때 브라우저가 한 번 호출 (브라우저 세션당 1회, sessionStorage 로 중복 방지).
 * 저장 항목: ref(채널 코드), referrer 호스트, 시각. IP·쿠키·방문자 식별값은 저장하지 않는다 (개인정보처리방침 1항 "접속 통계").
 * 실패해도 페이지 동작에 영향 없음.
 */
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 30;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return NextResponse.json({ ok: false }, { status: 429 });
  // 사이트 자체 페이지에서 온 요청만 집계 (다른 사이트·curl 로 부풀리기 방지). 브라우저는 Sec-Fetch-Site 를 자동으로 붙인다
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return NextResponse.json({ ok: false }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { ref?: unknown; referrer?: unknown } | null;
  const ref = typeof body?.ref === "string" ? body.ref.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  const referrer = typeof body?.referrer === "string" ? body.referrer.replace(/[^a-z0-9.\-:]/gi, "").slice(0, 120) : "";
  const { error } = await supabaseAdmin().from("visits").insert({ ref: ref || null, referrer: referrer || null, landed_at: new Date().toISOString() });
  return NextResponse.json({ ok: !error });
}
