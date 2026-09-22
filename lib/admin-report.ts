import { productLabel, CATALOG_BY_ID } from "@/lib/catalog";
import { resendMailer, type Mailer } from "@/lib/digest";
import { mailFrom, selectAll, supabaseAdmin, type SubscriberRow } from "@/lib/supabase";
import { consecutiveZeroRuns, readLastCollect, type LastCollect } from "@/lib/collect";
import { describeSource } from "@/lib/source-info";
import { computeHealth, type HealthReport } from "@/lib/health";

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
  lastCollect: LastCollect | null;
  /** 같은 회사(도메인)에서 2명 이상 구독 — 조직 내 확산 지표. 개인 메일 도메인 제외 */
  multiSeatDomains: { domain: string; count: number }[];
  companyDomains: number; // 회사 도메인 수 (개인 메일 제외)
  personalMailCount: number;
  /** 최근 24시간 / 7일 구독해지 (unsubscribes 테이블). 테이블 없으면 null */
  unsubscribes24h: number | null;
  unsubscribes7d: number | null;
  votes24h: number | null;
  suggestions24h: number | null;
  health?: HealthReport;
}

/** 개인용 메일 도메인 — 조직 확산 지표에서 제외 */
const PERSONAL_MAIL = new Set(["naver.com", "gmail.com", "daum.net", "hanmail.net", "nate.com", "kakao.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "me.com"]);
const OWN_DOMAIN = () => (process.env.ADMIN_EMAIL_DOMAIN ?? "breathings.co.kr").toLowerCase();

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
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)));

  // 모든 조회를 병렬로 (Vercel ↔ Supabase 왕복을 1회로 줄임)
  const weekAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const [totalActive, newSubsQ, upsQ, delsQ, allSubsQ, lastCollect, unsub24, unsub7, votes24, sugg24] = await Promise.all([
    countActiveSubscribers(),
    sb.from("subscribers").select("*").gte("created_at", since).order("created_at", { ascending: false }),
    sb.from("updates").select("jurisdiction,catalog_ids").gte("created_at", since),
    sb.from("deliveries").select("status").gte("week_start", monday.toISOString().slice(0, 10)),
    selectAll<{ email: string; catalog_ids: string[] }>(() => sb.from("subscribers").select("email, catalog_ids").eq("active", true).order("created_at", { ascending: true }).order("id", { ascending: true })).then((data) => ({ data, error: null as null })),
    readLastCollect().catch(() => null),
    sb.from("unsubscribes").select("id", { count: "exact", head: true }).gte("unsubscribed_at", since).then((r) => (r.error ? null : r.count ?? 0), () => null),
    sb.from("unsubscribes").select("id", { count: "exact", head: true }).gte("unsubscribed_at", weekAgo).then((r) => (r.error ? null : r.count ?? 0), () => null),
    sb.from("votes").select("id", { count: "exact", head: true }).gte("created_at", since).then((r) => (r.error ? null : r.count ?? 0), () => null),
    sb.from("suggestions").select("id", { count: "exact", head: true }).gte("created_at", since).then((r) => (r.error ? null : r.count ?? 0), () => null),
  ]);
  if (newSubsQ.error) throw newSubsQ.error;
  if (upsQ.error) throw upsQ.error;
  if (delsQ.error) throw delsQ.error;
  if (allSubsQ.error) throw allSubsQ.error;

  const updates24h: Record<string, number> = {};
  let matched24h = 0;
  for (const u of (upsQ.data ?? []) as { jurisdiction: string; catalog_ids: string[] }[]) {
    updates24h[u.jurisdiction] = (updates24h[u.jurisdiction] ?? 0) + 1;
    if (u.catalog_ids?.length) matched24h++;
  }

  const weekDeliveries: Record<string, number> = {};
  for (const d of (delsQ.data ?? []) as { status: string }[]) weekDeliveries[d.status] = (weekDeliveries[d.status] ?? 0) + 1;

  const tally = new Map<string, number>();
  const domainTally = new Map<string, number>();
  let personalMailCount = 0;
  for (const s of (allSubsQ.data ?? []) as { email: string; catalog_ids: string[] }[]) {
    for (const id of s.catalog_ids ?? []) tally.set(id, (tally.get(id) ?? 0) + 1);
    const domain = (s.email.split("@")[1] ?? "").toLowerCase();
    if (!domain) continue;
    if (PERSONAL_MAIL.has(domain)) { personalMailCount++; continue; }
    if (domain === OWN_DOMAIN()) continue; // 운영자 테스트 계정 제외
    domainTally.set(domain, (domainTally.get(domain) ?? 0) + 1);
  }
  const multiSeatDomains = [...domainTally.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({ domain, count }));
  const companyDomains = domainTally.size;
  const topCatalog = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, label: CATALOG_BY_ID[id]?.label ?? id, count }));

  const health = await computeHealth(lastCollect, now).catch(() => undefined);
  return { now, totalActive, newSubscribers: (newSubsQ.data ?? []) as AdminStats["newSubscribers"], updates24h, matched24h, weekDeliveries, topCatalog, lastCollect, multiSeatDomains, companyDomains, personalMailCount, unsubscribes24h: unsub24, unsubscribes7d: unsub7, votes24h: votes24, suggestions24h: sugg24, health };
}

export function renderAdminHtml(s: AdminStats, opts: { title: string; lead?: string }) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#667085;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#101828;font-weight:600">${v}</td></tr>`;

  const newList = s.newSubscribers.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#344054;font-size:14px">${s.newSubscribers
        .map((x) => `<li>${esc(x.email)} — ${x.products.map((p, i) => esc(productLabel(p, i))).join(", ") || "품목 없음"} (${x.catalog_ids.length}개 규격) · ${fmtKst(x.created_at)}</li>`)
        .join("")}</ul>`
    : `<p style="margin:8px 0 0;color:#667085;font-size:14px">신규 구독 없음</p>`;

  const upd = Object.entries(s.updates24h);
  const updLine = upd.length ? upd.map(([j, n]) => `${esc(j)} ${n}건`).join(" · ") + ` (규격 매칭 ${s.matched24h}건)` : "0건";
  const delv = Object.entries(s.weekDeliveries);
  const delLine = delv.length ? delv.map(([st, n]) => `${esc(st)} ${n}`).join(" · ") : "이번 주 발송 기록 없음";
  const top = s.topCatalog.length
    ? `<ol style="margin:8px 0 0;padding-left:18px;color:#344054;font-size:14px">${s.topCatalog.map((t) => `<li>${esc(t.label)} — ${t.count}명</li>`).join("")}</ol>`
    : `<p style="margin:8px 0 0;color:#667085;font-size:14px">데이터 없음</p>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"><style>@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css");body,td,p,a,h1,h2,h3,span,strong{font-family:Pretendard,'Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',Roboto,sans-serif !important}</style></head><body style="margin:0;background:#f4f6f8;font-family:Pretendard,'Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',Roboto,sans-serif">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:#fff;border-radius:12px;padding:28px 28px 20px;border:1px solid #eaecf0">
    <p style="margin:0 0 4px;color:#667085;font-size:13px">RegTide 운영 리포트 · ${esc(fmtKst(s.now))}</p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#101828">${esc(opts.title)}</h1>
    ${opts.lead ? `<p style="margin:0 0 16px;color:#344054;font-size:15px">${esc(opts.lead)}</p>` : ""}
    ${renderHealth(s.health)}
    <table style="border-collapse:collapse;font-size:15px;margin-bottom:16px">
      ${row("활성 구독자", `${s.totalActive}명`)}
      ${row("최근 24시간 신규 구독", `${s.newSubscribers.length}명`)}
      ${row("기능 투표·건의 (24시간)", s.votes24h == null ? "집계 전" : `투표 ${s.votes24h}표 · 건의 ${s.suggestions24h ?? 0}건 — 대시보드 투표·건의 탭`)}
      ${row("구독해지", s.unsubscribes24h == null ? "집계 전 (unsubscribes 테이블 필요)" : `24시간 ${s.unsubscribes24h}명 · 7일 ${s.unsubscribes7d ?? 0}명`)}
      ${row("최근 24시간 수집", updLine)}
      ${row("이번 주 발송", delLine)}
      ${row("구독자 구성", `회사 도메인 ${s.companyDomains}곳 · 개인 메일 ${s.personalMailCount}명`)}
      ${row("같은 회사 2명 이상", s.multiSeatDomains.length ? s.multiSeatDomains.map((d) => `${esc(d.domain)} ${d.count}명`).join(" · ") : `<span style="color:#667085;font-weight:400">아직 없음 (조직 내 확산 지표)</span>`)}
    </table>
    <h3 style="margin:16px 0 0;font-size:15px;color:#101828">신규 구독자</h3>${newList}
    <h3 style="margin:20px 0 0;font-size:15px;color:#101828">많이 선택된 규격·인증</h3>${top}
    <h3 style="margin:20px 0 0;font-size:15px;color:#101828">수집 소스 상태 (마지막 수집)</h3>${renderCollectStatus(s.lastCollect)}
    <p style="margin:24px 0 0;color:#98a2b3;font-size:12px">이 메일은 운영자에게만 발송됩니다. Supabase 대시보드에서 상세 데이터를 확인하세요.${site ? ` · <a href="${esc(site)}" style="color:#98a2b3">${esc(site)}</a>` : ""}</p>
  </div>
</div></body></html>`;
}

function renderHealth(h: HealthReport | undefined) {
  if (!h) return "";
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const actionable = h.issues.filter((i) => i.level !== "info");
  if (actionable.length === 0) {
    return `<div style="background:#ecfdf3;border:1px solid #abefc6;border-radius:8px;padding:10px 14px;margin:0 0 16px;color:#067647;font-size:14px;font-weight:600">상태 정상 — 수집 누락·면책 고지·발송·설정 점검 통과${h.counts.info ? ` <span style="font-weight:400;color:#667085">(참고 ${h.counts.info}건은 대시보드에서)</span>` : ""}</div>`;
  }
  const color = h.counts.critical ? "#b42318" : "#b54708";
  const bg = h.counts.critical ? "#fffbfa" : "#fffcf5";
  const border = h.counts.critical ? "#fecdca" : "#fedf89";
  const items = actionable
    .map((i) => `<li style="margin:0 0 8px"><strong style="color:${i.level === "critical" ? "#b42318" : "#b54708"}">[${i.level === "critical" ? "즉시" : "확인"} · ${esc(i.area)}]</strong> ${esc(i.title)}<br><span style="color:#344054">${esc(i.detail)}</span>${i.action ? `<br><span style="color:#1d4ed8">→ ${esc(i.action)}</span>` : ""}</li>`)
    .join("");
  return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:12px 14px;margin:0 0 16px">
    <p style="margin:0 0 8px;color:${color};font-size:15px;font-weight:700">${h.counts.critical ? `문제 ${h.counts.critical}건 — 즉시 조치 필요` : `확인 필요 ${h.counts.warning}건`}</p>
    <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${items}</ul>
    ${site ? `<p style="margin:8px 0 0;font-size:12px"><a href="${esc(site)}/admin" style="color:#667085">관리자 대시보드에서 자세히 보기</a></p>` : ""}
  </div>`;
}

function renderCollectStatus(c: AdminStats["lastCollect"]) {
  if (!c) return `<p style="margin:8px 0 0;color:#667085;font-size:14px">수집 기록 없음 (월요일 크론 실행 전)</p>`;
  const rows = Object.entries(c.bySource ?? {})
    .sort((a, b) => a[1] - b[1])
    .map(([k, n]) => {
      const si = describeSource(k);
      const color = n === 0 ? "#b54708" : "#101828";
      return `<tr><td style="padding:3px 10px 3px 0;color:#667085">${esc(si.agency)} · ${esc(si.name || k)}</td><td style="padding:3px 0;color:${color};font-weight:600;text-align:right">${n}건</td></tr>`;
    })
    .join("");
  // 수집 누락 경보: 페이지 감시가 아닌 소스가 7회 이상 연속 0건이면 피드 구조 변경·차단 가능성
  const stale = Object.keys(c.bySource ?? {})
    .filter((k) => !k.startsWith("page_watch:"))
    .map((k) => ({ k, n: consecutiveZeroRuns(c.history, k) }))
    .filter((x) => x.n >= 7)
    .map((x) => `<li style="color:#b42318"><strong>수집 누락 경보</strong>: ${esc(describeSource(x.k).agency)} · ${esc(describeSource(x.k).name || x.k)} 가 ${x.n}회 연속 0건 — 피드 URL·구조 변경 또는 차단 여부를 확인하세요.</li>`)
    .join("");
  const skipped = stale + (c.skipped ?? []).map((x) => `<li>건너뜀: ${esc(x.source)} — ${esc(x.reason)}</li>`).join("");
  const errors = (c.errors ?? []).map((x) => `<li style="color:#b42318">오류: ${esc(x.source)} — ${esc(x.error)}</li>`).join("");
  return `<p style="margin:8px 0 4px;color:#667085;font-size:13px">실행 ${esc(fmtKst(c.ranAt))} · 수집 기간 ${esc(fmtKst(c.since))} 이후 · 가져옴 ${c.fetched}건 / 신규 저장 ${c.inserted}건 · 이력 ${c.history?.length ?? 1}회</p>
    <table style="border-collapse:collapse;font-size:13px">${rows}</table>
    ${skipped || errors ? `<ul style="margin:8px 0 0;padding-left:18px;color:#344054;font-size:13px">${skipped}${errors}</ul>` : ""}
    <p style="margin:6px 0 0;color:#98a2b3;font-size:12px">0건 소스가 여러 주 계속되면 피드 구조 변경·차단을 의심하세요. 페이지 감시(EU·ISO·IEC) 소스는 변경이 없으면 0건이 정상입니다.</p>`;
}

/** 매일 아침 운영 리포트 */
export async function sendDailyAdminReport(now = new Date(), mailer: Mailer = resendMailer()) {
  const stats = await collectAdminStats(now);
  const kstDate = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const { id } = await mailer.send({
    from: mailFrom(),
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
      from: mailFrom(),
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
