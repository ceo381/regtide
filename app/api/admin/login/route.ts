import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, checkCredentials, cookieOptions, issueToken, loginRateLimited } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (loginRateLimited(ip)) return NextResponse.redirect(new URL("/admin/login?error=rate", req.url), 303);

  const form = await req.formData();
  const user = String(form.get("user") ?? "");
  const password = String(form.get("password") ?? "");
  if (!checkCredentials(user, password)) {
    return NextResponse.redirect(new URL("/admin/login?error=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/admin", req.url), 303);
  res.cookies.set(ADMIN_COOKIE, issueToken(user), cookieOptions(12 * 3600));
  return res;
}
