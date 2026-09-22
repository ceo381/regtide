import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, cookieOptions } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin/login", req.url), 303);
  res.cookies.set(ADMIN_COOKIE, "", cookieOptions(0));
  return res;
}
