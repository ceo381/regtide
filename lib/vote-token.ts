import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 구독자별 투표 링크 토큰 — DB 컬럼 없이 HMAC 으로 검증. /vote?s=<구독자 id>&t=<hmac>
 * 키는 ADMIN_SESSION_SECRET(없으면 CRON_SECRET). 키가 바뀌면 지난 메일의 링크는 무효가 된다.
 */
function key() {
  return process.env.ADMIN_SESSION_SECRET || process.env.CRON_SECRET || "";
}
export function voteToken(subscriberId: string) {
  return createHmac("sha256", key()).update(`vote:${subscriberId}`).digest("base64url").slice(0, 32);
}
export function verifyVoteToken(subscriberId: string, token: string) {
  if (!key() || !subscriberId || !token) return false;
  const a = Buffer.from(voteToken(subscriberId)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function voteUrl(site: string, subscriberId: string) {
  return `${site}/vote?s=${encodeURIComponent(subscriberId)}&t=${voteToken(subscriberId)}`;
}
