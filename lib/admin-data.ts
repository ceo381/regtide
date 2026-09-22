import { supabaseAdmin, type SubscriberRow, type UpdateRow } from "@/lib/supabase";
import { collectAdminStats, type AdminStats } from "@/lib/admin-report";
import { computeHealth, type HealthReport } from "@/lib/health";

/** 대시보드용 데이터 묶음 (서버 컴포넌트에서 1회 호출) */
export interface DashboardData {
  stats: AdminStats;
  subscribers: (SubscriberRow & { created_at: string; consent_at: string | null; last_sent_at: string | null })[];
  recentUpdates: UpdateRow[];
  deliveriesThisWeek: { email: string; status: string; sent_at: string; error: string | null; update_count: number }[];
  signupsByDay: { day: string; count: number }[]; // 최근 14일, KST 날짜
  weekStart: string;
  health: HealthReport;
}

function kstDay(iso: string) {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export async function loadDashboard(now = new Date()): Promise<DashboardData> {
  const sb = supabaseAdmin();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)));
  const weekStart = monday.toISOString().slice(0, 10);

  // 통계·구독자·수집항목·발송기록을 한 번에 병렬 조회
  const [stats, subsQ, upsQ, delsQ] = await Promise.all([
    collectAdminStats(now),
    sb.from("subscribers").select("*").order("created_at", { ascending: false }),
    sb.from("updates").select("*").order("created_at", { ascending: false }).limit(60),
    sb.from("deliveries").select("subscriber_id, status, sent_at, error, update_ids").eq("week_start", weekStart).order("sent_at", { ascending: false }),
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

  return {
    stats,
    subscribers: subs as DashboardData["subscribers"],
    recentUpdates: (upsQ.data ?? []) as UpdateRow[],
    deliveriesThisWeek,
    signupsByDay: Object.entries(days).map(([day, count]) => ({ day, count })),
    weekStart,
    health,
  };
}
