import { supabaseAdmin, type SubscriberRow, type UpdateRow } from "@/lib/supabase";
import { collectAdminStats, type AdminStats } from "@/lib/admin-report";
import { computeHealth, type HealthReport } from "@/lib/health";
import { listChannels, type ChannelRow } from "@/lib/channels";

/** 대시보드용 데이터 묶음 (서버 컴포넌트에서 1회 호출) */
export interface DashboardData {
  stats: AdminStats;
  subscribers: (SubscriberRow & { created_at: string; consent_at: string | null; last_sent_at: string | null; ref?: string | null; landed_at?: string | null; referrer?: string | null })[];
  recentUpdates: UpdateRow[];
  deliveriesThisWeek: { email: string; status: string; sent_at: string; error: string | null; update_count: number }[];
  signupsByDay: { day: string; count: number }[]; // 최근 14일, KST 날짜
  weekStart: string;
  health: HealthReport;
  channels: ChannelStat[];
  channelDaily: { day: string; counts: Record<string, number> }[]; // 최근 14일 채널별 신규
}

export interface ChannelStat {
  ref: string; // "(직접/미상)" 포함
  total: number;
  active: number;
  companyDomains: number;
  personal: number;
  last7d: number;
  last24h: number;
  firstAt: string | null;
  lastAt: string | null;
  /** landed_at → created_at 중앙값(분). landed_at 없는 구독자는 제외 */
  medianConvertMin: number | null;
  /** 접속 후 10분 내 구독 비율 (즉시 전환) */
  quickRate: number | null;
  productsPerSub: number;
  highRiskShare: number; // 3·4등급 품목 비율
  /** 등록부 정보 (등록된 채널만) */
  registry: ChannelRow | null;
  /** 구독자 / 대상 인원 (등록부에 audience_size 가 있을 때) */
  conversionRate: number | null;
  /** 게시 후 경과 시간(시간 단위). posted_at 이 있을 때 */
  hoursSincePost: number | null;
  /** 게시 후 24시간 / 72시간 내 구독 수 (posted_at 기준) */
  within24h: number | null;
  within72h: number | null;
}

const PERSONAL = new Set(["naver.com", "gmail.com", "daum.net", "hanmail.net", "nate.com", "kakao.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "me.com"]);
export const NO_REF = "(직접/미상)";

export function computeChannels(subs: DashboardData["subscribers"], now = new Date(), registry: ChannelRow[] = []): { channels: ChannelStat[]; channelDaily: DashboardData["channelDaily"] } {
  const reg = new Map(registry.map((r) => [r.code, r]));
  const groups = new Map<string, DashboardData["subscribers"]>();
  for (const s of subs) {
    const k = (s.ref && s.ref.trim()) || NO_REF;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const h24 = now.getTime() - 24 * 3600_000;
  const d7 = now.getTime() - 7 * 86400_000;
  const median = (xs: number[]) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

  // 등록만 되고 아직 구독자가 없는 채널도 0명으로 표시
  for (const r of registry) if (!groups.has(r.code)) groups.set(r.code, []);

  const channels: ChannelStat[] = [...groups.entries()].map(([ref, list]) => {
    const domains = new Set<string>();
    let personal = 0;
    const convert: number[] = [];
    let products = 0, highRisk = 0, totalProducts = 0;
    let firstAt: string | null = null, lastAt: string | null = null;
    for (const s of list) {
      const dom = (s.email.split("@")[1] ?? "").toLowerCase();
      if (PERSONAL.has(dom)) personal++; else if (dom) domains.add(dom);
      if (s.landed_at && Number.isFinite(ms(s.created_at))) convert.push((ms(s.created_at) - ms(s.landed_at)) / 60_000);
      products += s.products.length;
      for (const pr of s.products) { totalProducts++; if (/^[34]등급/.test(pr.category)) highRisk++; }
      if (s.created_at) {
        if (!firstAt || s.created_at < firstAt) firstAt = s.created_at;
        if (!lastAt || s.created_at > lastAt) lastAt = s.created_at;
      }
    }
    const quick = convert.filter((m) => m >= 0 && m <= 10).length;
    const r = reg.get(ref) ?? null;
    const postedMs = r?.posted_at ? ms(r.posted_at) : NaN;
    const within = (h: number) => (Number.isFinite(postedMs) ? list.filter((s) => { const t = ms(s.created_at); return t >= postedMs && t <= postedMs + h * 3600_000; }).length : null);
    return {
      registry: r,
      conversionRate: r?.audience_size ? list.length / r.audience_size : null,
      hoursSincePost: Number.isFinite(postedMs) ? (now.getTime() - postedMs) / 3600_000 : null,
      within24h: within(24),
      within72h: within(72),
      ref, total: list.length, active: list.filter((s) => s.active).length,
      companyDomains: domains.size, personal,
      last7d: list.filter((s) => ms(s.created_at) >= d7).length,
      last24h: list.filter((s) => ms(s.created_at) >= h24).length,
      firstAt, lastAt,
      medianConvertMin: median(convert.filter((m) => m >= 0)),
      quickRate: convert.length ? quick / convert.length : null,
      productsPerSub: list.length ? products / list.length : 0,
      highRiskShare: totalProducts ? highRisk / totalProducts : 0,
    };
  }).sort((a, b) => b.total - a.total || (b.registry?.created_at ?? "").localeCompare(a.registry?.created_at ?? ""));

  const kst = new Date(now.getTime() + 9 * 3600_000);
  const channelDaily: DashboardData["channelDaily"] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(kst.getTime() - i * 86400_000).toISOString().slice(0, 10);
    const counts: Record<string, number> = {};
    for (const [ref, list] of groups) counts[ref] = list.filter((s) => kstDay(s.created_at) === day).length;
    channelDaily.push({ day, counts });
  }
  return { channels, channelDaily };
}

function kstDay(iso: string | null | undefined) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 10) : "";
}
const ms = (iso: string | null | undefined) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : NaN; };

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const sb = supabaseAdmin();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)));
  const weekStart = monday.toISOString().slice(0, 10);

  // 통계·구독자·수집항목·발송기록을 한 번에 병렬 조회
  const [stats, subsQ, upsQ, delsQ, registry] = await Promise.all([
    collectAdminStats(now),
    sb.from("subscribers").select("*").order("created_at", { ascending: false }),
    sb.from("updates").select("*").order("created_at", { ascending: false }).limit(60),
    sb.from("deliveries").select("subscriber_id, status, sent_at, error, update_ids").eq("week_start", weekStart).order("sent_at", { ascending: false }),
    listChannels().catch(() => [] as ChannelRow[]), // channels 테이블이 아직 없으면 빈 목록
  ]);
  if (subsQ.error) throw subsQ.error;
  if (upsQ.error) throw upsQ.error;
  if (delsQ.error) throw delsQ.error;
  const subs = subsQ.data ?? [];
  const health = await computeHealth(stats.lastCollect, now);

  const subById = new Map(subs.map((s) => [s.id as string, s.email as string]));
  const deliveriesThisWeek = ((delsQ.data ?? []) as { subscriber_id: string; status: string; sent_at: string; error: string | null; update_ids: string[] }[]).map((d) => ({
    email: subById.get(d.subscriber_id) ?? "(삭제된 구독자)",
    status: d.status,
    sent_at: d.sent_at,
    error: d.error,
    update_count: d.update_ids?.length ?? 0,
  }));

  const days: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(kst.getTime() - i * 86400_000).toISOString().slice(0, 10);
    days[d] = 0;
  }
  for (const s of subs as { created_at: string }[]) {
    const d = kstDay(s.created_at);
    if (d in days) days[d]++;
  }

  const { channels, channelDaily } = computeChannels(subs as DashboardData["subscribers"], now, registry);
  return {
    stats,
    channels,
    channelDaily,
    subscribers: subs as DashboardData["subscribers"],
    recentUpdates: (upsQ.data ?? []) as UpdateRow[],
    deliveriesThisWeek,
    signupsByDay: Object.entries(days).map(([day, count]) => ({ day, count })),
    weekStart,
    health,
  };
}
