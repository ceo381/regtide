import { Resend } from "resend";
import { CATALOG, CATALOG_BY_ID, JURISDICTION_LABEL, type Jurisdiction } from "@/lib/catalog";
import { supabaseAdmin, type SubscriberRow, type UpdateRow } from "@/lib/supabase";
import { COVERAGE, describeSource, sourcesUsed } from "@/lib/source-info";
import { COLLECT_LOOKBACK_DAYS } from "@/lib/collect";

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

/** 날짜+시각(KST). 시각 정보가 없는 값(자정 UTC = 날짜만 제공되는 소스)은 날짜만 표시 */
function fmtDateTime(s: string | Date | null) {
  if (!s) return "";
  const d = new Date(s);
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (dateOnly) return fmtDate(d.toISOString());
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
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

export function renderDigestHtml(sub: SubscriberRow, updates: UpdateRow[], period: { start: Date; end: Date; generatedAt?: Date }) {
  const generatedAt = period.generatedAt ?? new Date();
  // 수집 기간: 크론 실행 시점에서 COLLECT_LOOKBACK_DAYS 일 전 ~ 실행 시점 (각 기관이 이 기간에 발표·게재한 항목을 대상으로 함)
  const collectSince = new Date(generatedAt.getTime() - COLLECT_LOOKBACK_DAYS * 86400_000);
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
          const src = describeSource(u.source);
          const pubLabel = src.detectedOnly ? "변경 감지" : "기관 발표";
          return `
          <tr><td style="padding:16px 0;border-bottom:1px solid #eaecf0">
            <div style="margin-bottom:6px"><span style="display:inline-block;background:${imp.color};color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600">${imp.text}</span>
            <span style="color:#667085;font-size:12px;margin-left:8px">${fmtDate(u.published_at)}</span></div>
            <a href="${esc(u.url ?? "#")}" style="color:#101828;font-weight:600;font-size:16px;text-decoration:none">${esc(u.title)}</a>
            <p style="margin:6px 0 0;color:#667085;font-size:12px;line-height:1.6">
              출처: ${src.url ? `<a href="${esc(src.url)}" style="color:#667085">${esc(src.agency)}</a>` : esc(src.agency)}${src.name ? ` · ${esc(src.name)}` : ""}<br>
              ${esc(pubLabel)}일시: ${fmtDateTime(u.published_at) || "원문 참조"} · RegTide 수집: ${fmtDateTime(u.created_at)}
            </p>
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
      <p style="margin:0 0 6px;color:#475467;font-size:14px">${fmtDate(period.start.toISOString())} ~ ${fmtDate(new Date(period.end.getTime() - 1).toISOString())} 주간 리포트 · 총 ${updates.length}건</p>
      <p style="margin:0 0 6px;color:#667085;font-size:12px;line-height:1.6"><strong style="color:#475467">정보 수집 기간</strong>: ${fmtDateTime(collectSince)} ~ ${fmtDateTime(generatedAt)} (이 기간에 각 기관이 발표·게재한 항목, ${COLLECT_LOOKBACK_DAYS}일) · <strong style="color:#475467">리포트 생성</strong>: ${fmtDateTime(generatedAt)}</p>
      <p style="margin:0 0 16px;color:#667085;font-size:12px;line-height:1.6">모니터링 대상: ${COVERAGE.map((c) => `<strong style="color:#475467">${esc(c.country)}</strong>(${esc(c.agencies)})`).join(" · ")}</p>
      ${productLine}
      ${updates.length ? sections : empty}
      <hr style="border:0;border-top:1px solid #eaecf0;margin:32px 0 16px">
      ${updates.length ? `<p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0 0 12px"><strong style="color:#667085">이번 메일의 출처</strong><br>
      ${sourcesUsed(updates.map((u) => u.source)).map((si) => `${si.url ? `<a href="${esc(si.url)}" style="color:#667085">${esc(si.agency)}</a>` : esc(si.agency)}${si.name ? ` — ${esc(si.name)}` : ""}`).join("<br>")}<br>
      "기관 발표"는 해당 기관이 원문에 표기한 게재 일시, "변경 감지"는 기관 페이지의 변경을 RegTide 가 확인한 시각입니다. 표기 시각은 모두 한국 표준시(KST)입니다.</p>` : ""}
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
export interface MailMessage { from: string; to: string; subject: string; html: string }
export interface Mailer {
  send(msg: MailMessage): Promise<{ id?: string }>;
  /** 여러 통을 한 번의 API 호출로 발송 (Resend batch, 최대 100통). 없으면 send 를 반복 호출 */
  sendBatch?(msgs: MailMessage[]): Promise<{ id?: string }[]>;
}

export function resendMailer(): Mailer {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(msg) {
      const { data, error } = await resend.emails.send(msg);
      if (error) throw new Error(error.message);
      return { id: data?.id };
    },
    async sendBatch(msgs) {
      const { data, error } = await resend.batch.send(msgs);
      if (error) throw new Error(error.message);
      // SDK 버전에 따라 data 가 { data: [...] } 또는 [...] 형태
      const arr = (Array.isArray(data) ? data : (data as { data?: { id: string }[] } | null)?.data) ?? [];
      if (arr.length !== msgs.length) throw new Error(`batch 응답 개수 불일치 (${arr.length}/${msgs.length})`);
      return arr.map((d) => ({ id: d?.id }));
    },
  };
}

/** Resend batch 1회 최대 100통. 여유를 두고 50통씩 */
const BATCH_SIZE = 50;

export async function sendWeeklyDigests(
  now = new Date(),
  /**
   * only: 이 이메일 한 명에게만 "테스트 발송". deliveries 에 기록하지 않아 월요일 정기 발송에 영향이 없고,
   *       제목에 [테스트] 가 붙는다. 구독자가 아닌 주소면 모든 규격을 선택한 가상 구독자로 렌더링한다.
   */
  opts: { sendEmpty?: boolean; recent?: boolean; only?: string } = {},
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
  let subs = (subsData ?? []) as SubscriberRow[];

  const testOnly = opts.only?.trim().toLowerCase();
  if (testOnly) {
    const found = subs.find((x) => x.email.toLowerCase() === testOnly);
    subs = [
      found ?? {
        id: "test",
        email: testOnly,
        unsubscribe_token: "test",
        products: [{ name: "(테스트) 전체 규격", category: "2등급", catalogIds: CATALOG.map((c) => c.id) }],
        catalog_ids: CATALOG.map((c) => c.id),
        active: true,
        last_sent_at: null,
      },
    ];
  }

  const from = process.env.MAIL_FROM ?? "RegTide <onboarding@resend.dev>";
  const result: SendResult = { sent: 0, skipped: 0, failed: [] };
  const nowIso = () => new Date().toISOString();

  // 이번 주 발송 기록을 한 번에 조회 (구독자 수만큼 쿼리하지 않도록)
  const alreadySent = new Set<string>();
  if (!testOnly) {
    const { data: dels } = await sb.from("deliveries").select("subscriber_id, status").eq("week_start", weekStart);
    for (const d of (dels ?? []) as { subscriber_id: string; status: string }[]) if (d.status === "sent") alreadySent.add(d.subscriber_id);
  }

  // 테스트 발송은 deliveries 에 기록하지 않는다 (정기 발송의 중복 방지 키를 소모하지 않도록)
  const recordMany = async (rows: Record<string, unknown>[]) => {
    if (testOnly || rows.length === 0) return;
    const { error } = await sb
      .from("deliveries")
      .upsert(rows.map((r) => ({ week_start: weekStart, sent_at: nowIso(), ...r })), { onConflict: "subscriber_id,week_start" });
    if (error) console.error("[digest] deliveries upsert failed:", error.message);
  };

  // 1) 구독자별 메시지 준비
  type Job = { sub: SubscriberRow; mine: UpdateRow[]; msg: MailMessage };
  const jobs: Job[] = [];
  const emptyRows: Record<string, unknown>[] = [];
  for (const sub of subs) {
    if (alreadySent.has(sub.id)) { result.skipped++; continue; }
    const mine = relevantUpdates(sub, updates);
    if (mine.length === 0 && !opts.sendEmpty) {
      emptyRows.push({ subscriber_id: sub.id, update_ids: [], status: "skipped_empty", error: null });
      result.skipped++;
      continue;
    }
    jobs.push({
      sub,
      mine,
      msg: {
        from,
        to: sub.email,
        subject: `${testOnly ? "[테스트] " : ""}[RegTide] 이번 주 의료기기 규제 업데이트 ${mine.length}건 (${weekStart} 주)`,
        html: renderDigestHtml(sub, mine, { start: periodStart, end: periodEnd, generatedAt: now }),
      },
    });
  }
  await recordMany(emptyRows);

  // 2) 발송: batch 가 가능하면 50통씩 한 번에, 실패한 묶음은 개별 발송으로 재시도
  const sentRows: Record<string, unknown>[] = [];
  const failedRows: Record<string, unknown>[] = [];
  const sentIds: string[] = [];

  const sendOne = async (j: Job) => {
    try {
      const r = await mailer.send(j.msg);
      sentRows.push({ subscriber_id: j.sub.id, update_ids: j.mine.map((u) => u.id), provider_message_id: r.id ?? null, status: "sent", error: null });
      sentIds.push(j.sub.id);
      result.sent++;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      failedRows.push({ subscriber_id: j.sub.id, update_ids: j.mine.map((u) => u.id), status: "failed", error: msg });
      result.failed.push({ email: j.sub.email, error: msg });
    }
  };

  const useBatch = !!mailer.sendBatch && !testOnly && jobs.length > 1;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const chunk = jobs.slice(i, i + BATCH_SIZE);
    if (useBatch) {
      try {
        const rs = await mailer.sendBatch!(chunk.map((j) => j.msg));
        chunk.forEach((j, k) => {
          sentRows.push({ subscriber_id: j.sub.id, update_ids: j.mine.map((u) => u.id), provider_message_id: rs[k]?.id ?? null, status: "sent", error: null });
          sentIds.push(j.sub.id);
          result.sent++;
        });
        continue;
      } catch (e) {
        console.error("[digest] batch send failed, falling back to single sends:", (e as Error).message);
      }
    }
    for (const j of chunk) await sendOne(j);
  }

  await recordMany([...sentRows, ...failedRows]);
  if (!testOnly && sentIds.length) {
    const { error } = await sb.from("subscribers").update({ last_sent_at: nowIso() }).in("id", sentIds);
    if (error) console.error("[digest] last_sent_at update failed:", error.message);
  }
  return result;
}
