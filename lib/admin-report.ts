import { CATALOG_BY_ID } from "@/lib/catalog";
import { resendMailer, type Mailer } from "@/lib/digest";
import { supabaseAdmin, type SubscriberRow } from "@/lib/supabase";

/**
 * 운영자용 리포트 (구독자 현황) — 매일 아침 발송 + 구독자 수가 N의 배수에 도달할 때 즉시 발송
 *   ADMIN_EMAIL      : 리포트 수신 주소 (기본 ceo@breathings.co.kr)
 *   MILESTONE_EVERY  : 구독자 N명마다 알림 (기본 10)
 */
/**
 * 운영 리포트 수신자. 구독자에게 절대 가지 않도록 운영자 도메인(@breathings.co.kr) 주소만 허용하고,
 * 그 외 주소가 설정되어 있으면 발송을 거부한다. (ADMIN_EMAIL_DOMAIN 으로 도메인 변경 가능)
 */
export const ADMIN_EMAIL = () => {
  const to = (process.env.ADMIN_EMAIL ?? "ceo@breathings.co.kr").trim().toLowerCase();
  const domain = (process.env.ADMIN_EMAIL_DOMAIN ?? "breathings.co.kr").toLowerCase();
  if (!to.endsWith(`@${domain}`)) throw new Error(`[admin-report] 운영 리포트 수신자(${to})가 허용 도메인(@${domain})이 아니어서 발송을 거부합니다.`);
  return to;
};
export const MILESTONE_EVERY = () => Math.max(1, Number(process.env.MILESTONE_EVERY ?? 10) || 10);

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const fmtKst = (d: Date | string) =>
  new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export interface AdminStats {
  now: Date;
  totalActive: number;
  newSubscribers: (SubscriberRow & { created_at: string })[];
  updates24h: Record<string, number>; // jurisdiction → count
  matched24h: number;
  weekDeliveries: Record<string, number>; // status → count
  topCatalog: { id: string; label: string; count: number }[];
}

/** 활성 구독자 수 */
export async function countActiveSubscribers(): Promise<number> {
  const sb = supabaseAdmin();
  const { count, error } = await sb.from("subscribers").select("id", { count: "exact", head: true }).eq("active", true);
  if (error) throw error;
  return count ?? 0;
}

export async function collectAdminStats(now = new Date(), hours = 24): Promise<AdminStats> {
  const sb = supabaseAdmin();
  const since = new Date(now.getTime() - hours * 3600_000).toISOString();

  const totalActive = await countActiveSubscribers();

  const { data: newSubs, error: e1 } = await sb
    .from("subscribers")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (e1) throw e1;

  const { data: ups, error: e2 } = await sb.from("updates").select("jurisdiction,catalog_ids").gte("created_at", since);
  if (e2) throw e2;
  const updates24h: Record<string, number> = {};
  let matched24h = 0;
  for (const u of (ups ?? []) as { jurisdiction: string; catalog_ids: string[] }[]) {
    updates24h[u.jurisdiction] = (updates24h[u.jurisdiction] ?? 0) + 1;
    if (u.catalog_ids?.length) matched24h++;
  }

  const kst = new Date(now.getTime() + 9 * 3600_000);
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)));
  const { data: dels, error: e3 } = await sb.from("deliveries").select("status").gte("week_start", monday.toISOString().slice(0, 10));
  if (e3) throw e3;
  const weekDeliveries: Record<string, number> = {};
  for (const d of (dels ?? []) as { status: string }[]) weekDeliveries[d.status] = (weekDeliveries[d.status] ?? 0) + 1;

  const { data: allSubs, error: e4 } = await sb.from("subscribers").select("catalog_ids").eq("active", true);
  if (e4) throw e4;
  const tally = new Map<string, number>();
  for (const s of (allSubs ?? []) as { catalog_ids: string[] }[]) for (const id of s.catalog_ids ?? []) tally.set(id, (tally.get(id) ?? 0) + 1);
  const topCatalog = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, label: CATALOG_BY_ID[id]?.label ?? id, count }));

  return { now, totalActive, newSubscribers: (newSubs ?? []) as AdminStats["newSubscribers"], updates24h, matched24h, weekDeliveries, topCatalog };
}

export function renderAdminHtml(s: AdminStats, opts: { title: string; lead?: string }) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#667085;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#101828;font-weight:600">${v}</td></tr>`;

  const newList = s.newSubscribers.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#344054;font-size:14px">${s.newSubscribers
        .map((x) => `<li>${esc(x.email)} — ${x.products.map((p) => esc(p.name)).join(", ") || "품목 없음"} (${x.catalog_ids.length}개 규격) · ${fmtKst(x.created_at)}</li>`)
        .join("")}</ul>`
    : `<p style="margin:8px 0 0;color:#667085;font-size:14px">신규 구독 없음</p>`;

  const upd = Object.entries(s.updates24h);
  const updLine = upd.length ? upd.map(([j, n]) => `${esc(j)} ${n}건`).join(" · ") + ` (규격 매칭 ${s.matched24h}건)` : "0건";
  const delv = Object.entries(s.weekDeliveries);
  const delLine = delv.length ? delv.map(([st, n]) => `${esc(st)} ${n}`).join(" · ") : "이번 주 발송 기록 없음";
  const top = s.topCatalog.length
    ? `<ol style="margin:8px 0 0;padding-left:18px;color:#344054;font-size:14px">${s.topCatalog.map((t) => `<li>${esc(t.label)} — ${t.count}명</li>`).join("")}</ol>`
    : `<p style="margin:8px 0 0;color:#667085;font-size:14px">데이터 없음</p>`;

  return `<!doctype html><html lang="ko"><body style="margin:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,'Malgun Gothic',sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:12px;padding:28px 28px 20px;border:1px solid #eaecf0">
    <p style="margin:0 0 4px;color:#667085;font-size:13px">RegTide 운영 리포트 · ${esc(fmtKst(s.now))}</p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#101828">${esc(opts.title)}</h1>
    ${opts.lead ? `<p style="margin:0 0 16px;color:#344054;font-size:15px">${esc(opts.lead)}</p>` : ""}
    <table style="border-collapse:collapse;font-size:15px;margin-bottom:16px">
      ${row("활성 구독자", `${s.totalActive}명`)}
      ${row("최근 24시간 신규 구독", `${s.newSubscribers.length}명`)}
      ${row("최근 24시간 수집", updLine)}
      ${row("이번 주 발송", delLine)}
    </table>
    <h3 style="margin:16px 0 0;font-size:15px;color:#101828">신규 구독자</h3>${newList}
    <h3 style="margin:20px 0 0;font-size:15px;color:#101828">많이 선택된 규격·인증</h3>${top}
    <p style="margin:24px 0 0;color:#98a2b3;font-size:12px">이 메일은 운영자에게만 발송됩니다. Supabase 대시보드에서 상세 데이터를 확인하세요.${site ? ` · <a href="${esc(site)}" style="color:#98a2b3">${esc(site)}</a>` : ""}</p>
  </div>
</div></body></html>`;
}

/** 매일 아침 운영 리포트 */
export async function sendDailyAdminReport(now = new Date(), mailer: Mailer = resendMailer()) {
  const stats = await collectAdminStats(now);
  const kstDate = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const { id } = await mailer.send({
    from: process.env.MAIL_FROM!,
    to: ADMIN_EMAIL(),
    subject: `[RegTide 운영] ${kstDate} 구독자 ${stats.totalActive}명 · 신규 ${stats.newSubscribers.length}명`,
    html: renderAdminHtml(stats, { title: "일일 구독자 현황" }),
  });
  return { id, totalActive: stats.totalActive, newSubscribers: stats.newSubscribers.length };
}

const MILESTONE_STATE_KEY = "admin:milestone_notified";

/** 마지막으로 알림을 보낸 마일스톤(예: 10, 20). 별도 테이블 없이 page_snapshots 에 key-value 로 보관 */
async function readLastMilestone(): Promise<number> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("page_snapshots").select("content").eq("source_key", MILESTONE_STATE_KEY).maybeSingle();
  const n = Number((data as { content?: string } | null)?.content ?? 0);
  return Number.isFinite(n) ? n : 0;
}
async function writeLastMilestone(n: number) {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("page_snapshots")
    .upsert({ source_key: MILESTONE_STATE_KEY, content_hash: String(n), content: String(n), fetched_at: new Date().toISOString() }, { onConflict: "source_key" });
  if (error) throw error;
}

/**
 * 활성 구독자 수가 마지막 알림 이후 새로운 MILESTONE_EVERY 배수를 넘었으면 운영자에게 알림.
 *  - 신규 구독 직후와 일일 리포트 크론에서 호출 (배포 전에 이미 넘어간 구간, 발송 실패 등도 다음 호출에서 따라잡음)
 *  - 정확히 배수일 때만이 아니라 "넘었을 때" 판정 (예: 9→11 이면 10 마일스톤 알림)
 *  - 실패해도 구독 처리에는 영향을 주지 않도록 예외를 삼킨다.
 */
export async function notifyMilestoneIfReached(mailer?: Mailer): Promise<{ sent: boolean; total: number; milestone: number }> {
  try {
    const every = MILESTONE_EVERY();
    const total = await countActiveSubscribers();
    const milestone = Math.floor(total / every) * every;
    const last = await readLastMilestone();
    if (milestone === 0 || milestone <= last) return { sent: false, total, milestone: last };
    if (!mailer && !process.env.RESEND_API_KEY) return { sent: false, total, milestone: last };
    const stats = await collectAdminStats(new Date());
    await (mailer ?? resendMailer()).send({
      from: process.env.MAIL_FROM!,
      to: ADMIN_EMAIL(),
      subject: `[RegTide 운영] 🎉 구독자 ${milestone}명 달성 (현재 ${total}명)`,
      html: renderAdminHtml(stats, { title: `구독자 ${milestone}명 달성`, lead: `활성 구독자가 ${total}명이 되어 ${milestone}명 구간을 넘었습니다. 최근 24시간 현황을 함께 보냅니다.` }),
    });
    await writeLastMilestone(milestone);
    return { sent: true, total, milestone };
  } catch (e) {
    console.error("[admin-report] milestone notify failed:", (e as Error).message);
    return { sent: false, total: -1, milestone: -1 };
  }
}
