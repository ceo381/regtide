import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * 관리자 인증 — 단일 계정 (환경변수)
 *   ADMIN_USER            : 로그인 아이디 (기본 "admin")
 *   ADMIN_PASSWORD        : 비밀번호 (필수. 없으면 관리자 페이지 전체 비활성)
 *   ADMIN_SESSION_SECRET  : 세션 쿠키 서명 키 (없으면 CRON_SECRET 사용)
 *
 * 세션: HMAC-SHA256 서명된 httpOnly 쿠키. 만료 12시간. 서버에 상태 저장 없음.
 */
export const ADMIN_COOKIE = "regtide_admin";
const SESSION_HOURS = 12;

export function adminEnabled() {
  return !!process.env.ADMIN_PASSWORD && !!(process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET);
}

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET / CRON_SECRET 가 설정되지 않았습니다.");
  return s;
}

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkCredentials(user: string, password: string) {
  if (!adminEnabled()) return false;
  const u = process.env.ADMIN_USER ?? "admin";
  const a = safeEq(user.trim(), u);
  const b = safeEq(password, process.env.ADMIN_PASSWORD!);
  return a && b; // 둘 다 항상 비교 (아이디 유효성 타이밍 누설 방지)
}

/** 토큰 = base64url(payload).base64url(hmac) ; payload = { u, exp } */
export function issueToken(user: string) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string | undefined | null): { user: string } | null {
  if (!token || !adminEnabled()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!safeEq(sig, expect)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number };
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return { user: u };
  } catch {
    return null;
  }
}

/** 서버 컴포넌트/라우트에서 현재 관리자 세션 확인 */
export async function getAdminSession() {
  const jar = await cookies();
  return verifyToken(jar.get(ADMIN_COOKIE)?.value);
}

export function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    // 배포(https)에서만 Secure. 로컬 `npm run start`(http) 에서도 로그인이 되도록 사이트 URL 기준으로 판단
    secure: (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

// 로그인 시도 제한 (IP 기준, 서버리스 인스턴스 단위 — 완벽하진 않지만 무차별 대입을 늦춤)
const attempts = new Map<string, { n: number; t: number }>();
export function loginRateLimited(ip: string) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.t > 15 * 60_000) { attempts.set(ip, { n: 1, t: now }); return false; }
  a.n++;
  return a.n > 10;
}
