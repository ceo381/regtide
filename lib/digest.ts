import { Resend } from "resend";
import { CATALOG_BY_ID, JURISDICTION_LABEL, type Jurisdiction } from "@/lib/catalog";
import { supabaseAdmin, type SubscriberRow, type UpdateRow } from "@/lib/supabase";

const IMPACT_LABEL: Record<string, { text: string; color: string }> = {
  high: { text: "즉시 조치", color: "#b42318" },
  medium: { text: "검토 필요", color: "#b54708" },
  low: { text: "참고", color: "#175cd3" },
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * 주간 집계 구간
 *  - start/end : 이번 발송에 포함할 updates 의 created_at 범위.
 *                크론은 월요일 09:00(KST)에 "수집 → 분류 → 발송"을 한 번에 실행하므로,
 *                그 실행에서 방금 저장된 항목(created_at = 월요일 09:00)이 포함되어야 한다.
 *                따라서 start = 이번 주 월요일 00:00(KST), end = 지금. 지난주 월요일 실행분(created_at = 지난주 월 09:00)은
 *                start 이전이라 자연히 제외되어 중복 발송이 없다.
 *  - weekStart  : 중복 발송 방지 키(deliveries.week_start). 이번 주 월요일 날짜.
 *  - periodStart/periodEnd : 이메일 상단에 표시할 "지난 한 주" 기간(지난주 월 ~ 일). 표시용.
 */
export function weekWindow(now = new Date(), opts: { recent?: boolean } = {}) {
  if (opts.recent) {
    // 테스트용: 최근 8일 (주중에 파이프라인을 돌려볼 때 사용)
    const start = new Date(now.getTime() - 8 * 86400_000);
    return { start, end: now, weekStart: now.toISOString().slice(0, 10), periodStart: start, periodEnd: now };
  }
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const day = kst.getUTCDay(); // 0=일
  const diffToMonday = (day + 6) % 7;
  const thisMondayKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - diffToMonday); // 월 00:00 KST (KST 눈금)
  const thisMondayUtc = new Date(thisMondayKst - 9 * 3600_000);
  return {
    start: thisMondayUtc,
    end: now,
    weekStart: new Date(thisMondayKst).toISOString().slice(0, 10),
    periodStart: new Date(thisMondayUtc.getTime() - 7 * 86400_000),
    periodEnd: thisMondayUtc,
  };
}

export function relevantUpdates(sub: SubscriberRow, updates: UpdateRow[]): UpdateRow[] {
  const mine = new Set(sub.catalog_ids);
  return updates
    .filter((u) => u.impact && u.impact !== "none" && u.catalog_ids.some((id) => mine.has(id)))
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      return (rank[a.impact!] ?? 3) - (rank[b.impact!] ?? 3) || (b.published_at ?? "").localeCompare(a.published_at ?? "");
    });
}

export function renderDigestHtml(sub: SubscriberRow, updates: UpdateRow[], period: { start: Date; end: Date }) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const unsub = `${site}/api/unsubscribe?token=${encodeURIComponent(sub.unsubscribe_token)}`;
  const byJ: Partial<Record<Jurisdiction, UpdateRow[]>> = {};
  for (const u of updates) (byJ[u.jurisdiction as Jurisdiction] ??= []).push(u);

  const productLine = sub.products.length
    ? `<p style="margin:0 0 16px;color:#475467;font-size:14px">모니터링 품목: ${sub.products.map((p) => esc(p.name)).join(", ")}</p>`
    : "";

  const sections = (Object.keys(byJ) as Jurisdiction[])
    .map((j) => {
      const items = byJ[j]!
        .map((u) => {
          const imp = IMPACT_LABEL[u.impact ?? "low"] ?? IMPACT_LABEL.low;
          const tags = u.catalog_ids
            .filter((id) => sub.catalog_ids.includes(id) && CATALOG_BY_ID[id])
            .map((id) => `<span style="display:inline-block;background:#f2f4f7;color:#344054;border-radius:4px;padding:2px 8px;font-size:12px;margin:0 4px 4px 0">${esc(CATALOG_BY_ID[id].label)}</span>`)
            .join("");
          return `
          <tr><td style="padding:16px 0;border-bottom:1px solid #eaecf0">
            <div style="margin-bottom:6px"><span style="display:inline-block;background:${imp.color};color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600">${imp.text}</span>
            <span style="color:#667085;font-size:12px;margin-left:8px">${fmtDate(u.published_at)}</span></div>
            <a href="${esc(u.url ?? "#")}" style="color:#101828;font-weight:600;font-size:16px;text-decoration:none">${esc(u.title)}</a>
            <p style="margin:8px 0;color:#344054;font-size:14px;line-height:1.6">${esc(u.summary_ko ?? "")}</p>
            ${u.matched_keywords?.length ? `<p style="margin:0 0 6px;color:#667085;font-size:12px">매칭 키워드: ${esc(u.matched_keywords.slice(0, 6).join(", "))}</p>` : ""}
            <div>${tags}</div>
          </td></tr>`;
        })
        .join("");
      return `<h2 style="font-size:18px;margin:28px 0 4px;color:#101828">${esc(JURISDICTION_LABEL[j])}</h2>
      <table width="100%" cellpadding="0" cellspacing="0">${items}</table>`;
    })
    .join("");

  const empty = `<p style="color:#475467;font-size:15px;padding:24px 0">이번 주에는 선택하신 규격·인증에 해당하는 변경 사항이 감지되지 않았습니다.</p>`;

  return `<!doctype html><html lang="ko"><body style="margin:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:32px">
      <p style="margin:0 0 4px;color:#667085;font-size:13px;letter-spacing:.04em">REGTIDE · 주간 리포트</p>
      <h1 style="margin:0 0 8px;font-size:22px;color:#101828">의료기기 규격·인증 업데이트</h1>
      <p style="margin:0 0 16px;color:#475467;font-size:14px">${fmtDate(period.start.toISOString())} ~ ${fmtDate(new Date(period.end.getTime() - 1).toISOString())} · 총 ${updates.length}건</p>
      ${productLine}
      ${updates.length ? sections : empty}
      <hr style="border:0;border-top:1px solid #eaecf0;margin:32px 0 16px">
      <p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0 0 8px"><strong style="color:#667085">이용 안내 및 면책</strong><br>
      본 메일은 식약처, 국가법령정보센터, 미국 Federal Register, EU Commission, ISO/IEC 등 공개된 규제 정보 소스를 자동으로 수집·분류하여 제공하는 <strong>참고용 정보</strong>입니다. 법률·규제 자문이 아니며 법적 효력이 없습니다. 발췌문은 원문의 일부이므로 정확한 내용과 시행일은 반드시 원문 링크에서 확인하시기 바랍니다.<br>
      수집 소스의 변경, 사이트 접근 제한, 분류 규칙의 한계 등으로 일부 변경 사항이 누락되거나 지연되거나 관련 없는 항목이 포함될 수 있습니다. 본 정보를 바탕으로 한 인허가·품질·사업상 판단과 그 결과에 대한 책임은 이용자에게 있으며, RegTide 는 이에 대해 책임을 지지 않습니다. 각 원문의 저작권은 해당 발행 기관에 있습니다. 전문은 <a href="${esc(site)}/disclaimer" style="color:#667085">이용 안내 및 면책조항</a>을 참고하세요.</p>
      <p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0">
      더 이상 수신을 원치 않으시면 <a href="${esc(unsub)}" style="color:#667085">구독해지</a>를 눌러주세요. 구독해지 시 이메일 주소는 즉시 삭제됩니다.</p>
    </div>
  </div></body></html>`;
}

export interface SendResult {
  sent: number;
  skipped: number;
  failed: { email: string; error: string }[];
}

/** 메일 발송 추상화 (테스트에서 가짜 발송기 주입용) */
export interface Mailer {
  send(msg: { from: string; to: string; subject: string; html: string }): Promise<{ id?: string }>;
}

export function resendMailer(): Mailer {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(msg) {
      const { data, error } = await resend.emails.send(msg);
      if (error) throw new Error(error.message);
      return { id: data?.id };
    },
  };
}

export async function sendWeeklyDigests(
  now = new Date(),
  opts: { sendEmpty?: boolean; recent?: boolean } = {},
  mailer: Mailer = resendMailer(),
): Promise<SendResult> {
  const sb = supabaseAdmin();
  const { start, end, weekStart, periodStart, periodEnd } = weekWindow(now, { recent: opts.recent });

  const { data: updatesData, error: uErr } = await sb
    .from("updates")
    .select("*")
    .not("classified_at", "is", null)
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString());
  if (uErr) throw uErr;
  const updates = (updatesData ?? []) as UpdateRow[];

  const { data: subsData, error: sErr } = await sb.from("subscribers").select("*").eq("active", true);
  if (sErr) throw sErr;
  const subs = (subsData ?? []) as SubscriberRow[];

  const from = process.env.MAIL_FROM ?? "RegTide <onboarding@resend.dev>";
  const result: SendResult = { sent: 0, skipped: 0, failed: [] };

  for (const sub of subs) {
    // 같은 주에 이미 "성공 발송"했으면 건너뜀 (크론 재실행 안전). failed / skipped_empty 는 재시도 허용
    const { data: already } = await sb.from("deliveries").select("id, status").eq("subscriber_id", sub.id).eq("week_start", weekStart).maybeSingle();
    if (already?.status === "sent") { result.skipped++; continue; }

    const record = (row: Record<string, unknown>) =>
      sb.from("deliveries").upsert({ subscriber_id: sub.id, week_start: weekStart, sent_at: new Date().toISOString(), ...row }, { onConflict: "subscriber_id,week_start" });

    const mine = relevantUpdates(sub, updates);
    if (mine.length === 0 && !opts.sendEmpty) {
      await record({ update_ids: [], status: "skipped_empty", error: null });
      result.skipped++;
      continue;
    }

    try {
      const sent = await mailer.send({
        from,
        to: sub.email,
        subject: `[RegTide] 이번 주 의료기기 규제 업데이트 ${mine.length}건 (${weekStart} 주)`,
        html: renderDigestHtml(sub, mine, { start: periodStart, end: periodEnd }),
      });
      await record({ update_ids: mine.map((u) => u.id), provider_message_id: sent.id ?? null, status: "sent", error: null });
      await sb.from("subscribers").update({ last_sent_at: new Date().toISOString() }).eq("id", sub.id);
      result.sent++;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      await record({ update_ids: mine.map((u) => u.id), status: "failed", error: msg });
      result.failed.push({ email: sub.email, error: msg });
    }
  }
  return result;
}
