import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * 구독해지
 *  GET  : 확인 페이지를 보여준다 (삭제하지 않음). 메일 보안 스캐너(Outlook Safe Links, Gmail 미리보기 등)가
 *         링크를 자동으로 열어 구독이 본인 의사와 무관하게 해지되는 사고를 막기 위함.
 *  POST : 토큰 일치 시 구독자 레코드(이메일 포함)를 즉시 삭제하고 사이트로 리다이렉트.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(token: string, site: string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>구독해지 · RegTide</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>body{margin:0;background:#f7f8fa;font-family:Pretendard,'Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',Roboto,sans-serif;color:#101828}.box{max-width:440px;margin:80px auto;background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 8px}p{color:#475467;font-size:14px;line-height:1.6;margin:0 0 20px}button{width:100%;padding:12px;border-radius:8px;border:1px solid #b42318;background:#fff;color:#b42318;font-size:15px;font-weight:600;cursor:pointer}button:hover{background:#fef3f2}a{display:block;text-align:center;margin-top:12px;color:#667085;font-size:13px}</style></head>
<body><div class="box"><h1>RegTide 구독을 해지할까요?</h1><p>해지하면 이메일 주소를 포함한 모든 구독 정보가 즉시 삭제되며, 되돌릴 수 없습니다. 다시 받아보시려면 사이트에서 새로 구독하시면 됩니다.</p>
<form method="post" action="/api/unsubscribe"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">구독해지</button></form>
<a href="${esc(site || "/")}">취소하고 돌아가기</a></div></body></html>`;
}

const siteOf = (req: NextRequest) => (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const site = siteOf(req);
  if (!token) return NextResponse.redirect(`${site}/?unsub=invalid`);
  return new NextResponse(page(token, site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const site = siteOf(req);
  let token = "";
  try {
    const form = await req.formData();
    token = String(form.get("token") ?? "").trim();
  } catch {
    token = req.nextUrl.searchParams.get("token") ?? "";
  }
  if (!token) return NextResponse.redirect(`${site}/?unsub=invalid`, 303);
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("subscribers").delete().eq("unsubscribe_token", token).select("id");
  if (error || !data?.length) return NextResponse.redirect(`${site}/?unsub=invalid`, 303);
  return NextResponse.redirect(`${site}/?unsub=ok`, 303);
}
