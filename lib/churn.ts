import { supabaseAdmin } from "@/lib/supabase";

/**
 * 구독해지 모니터링 — 해지 시 구독자 행은 즉시 삭제하되, 식별 불가 통계 한 줄을 unsubscribes 에 남긴다.
 * 저장하지 않는 것: 이메일, 도메인, 구독자 id, 토큰, 품목명, IP.
 * 실패해도 해지 처리는 진행돼야 하므로 예외를 던지지 않는다 (호출 측은 결과를 로그로만 사용).
 */
const PERSONAL_MAIL = new Set(["naver.com", "gmail.com", "daum.net", "hanmail.net", "nate.com", "kakao.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "me.com"]);

export interface ChurnSource {
  id: string;
  email: string;
  ref?: string | null;
  created_at?: string | null;
  catalog_ids?: string[] | null;
  products?: { category: string }[] | null;
  last_sent_at?: string | null;
}

export interface UnsubscribeRow {
  unsubscribed_at: string;
  reason: "user" | "admin";
  ref: string | null;
  subscribed_at: string | null;
  tenure_days: number | null;
  catalog_count: number | null;
  categories: string[];
  deliveries_received: number | null;
  last_sent_at: string | null;
  mail_type: "company" | "personal" | null;
}

export function anonymizeForChurn(sub: ChurnSource, reason: "user" | "admin", deliveriesReceived: number | null, now = new Date()): UnsubscribeRow {
  const domain = (sub.email.split("@")[1] ?? "").toLowerCase();
  const subscribedAt = sub.created_at ? new Date(sub.created_at) : null;
  return {
    unsubscribed_at: now.toISOString(),
    reason,
    ref: sub.ref?.trim() || null,
    subscribed_at: subscribedAt ? subscribedAt.toISOString() : null,
    tenure_days: subscribedAt ? Math.max(0, Math.floor((now.getTime() - subscribedAt.getTime()) / 86400_000)) : null,
    catalog_count: sub.catalog_ids?.length ?? null,
    categories: [...new Set((sub.products ?? []).map((p) => p.category).filter(Boolean))],
    deliveries_received: deliveriesReceived,
    last_sent_at: sub.last_sent_at ?? null,
    mail_type: domain ? (PERSONAL_MAIL.has(domain) ? "personal" : "company") : null,
  };
}

/**
 * 구독자 행 삭제 **후** 호출 (삭제가 실패하면 통계도 남기지 않도록). 받은 리포트 수는 삭제 전에 세어 넘긴다.
 * deliveriesReceived 를 생략하면 여기서 세어 보지만, 삭제 뒤라면 0 이 나오므로 호출 측에서 넘기는 것이 맞다.
 */
export async function recordUnsubscribe(sub: ChurnSource, reason: "user" | "admin", now = new Date(), deliveriesReceived?: number | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = supabaseAdmin();
    let received = deliveriesReceived;
    if (received === undefined) {
      const { count } = await sb.from("deliveries").select("id", { count: "exact", head: true }).eq("subscriber_id", sub.id).eq("status", "sent");
      received = count ?? null;
    }
    const row = anonymizeForChurn(sub, reason, received, now);
    const { error } = await sb.from("unsubscribes").insert(row);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}
