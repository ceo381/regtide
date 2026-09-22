import { Resend } from "resend";
import { createHash } from "node:crypto";
import { CATALOG, CATALOG_BY_ID, JURISDICTION_LABEL, productLabel, type Jurisdiction } from "@/lib/catalog";
import { mailFrom, selectAll, supabaseAdmin, type SubscriberRow, type UpdateRow } from "@/lib/supabase";
import { COVERAGE, describeSource, sourcesUsed } from "@/lib/source-info";
import { COLLECT_LOOKBACK_DAYS } from "@/lib/collect";
import { loadVoteSummary, type VoteSummary } from "@/lib/votes";
import { EMAIL_FONT, EMAIL_HEAD, disclaimerFooterHtml, esc, forwardedNoticeHtml, roadmapBlockHtml, shareBlockHtml } from "@/lib/email-common";

const IMPACT_LABEL: Record<string, { text: string; color: string }> = {
  high: { text: "즉시 조치", color: "#b42318" },
  medium: { text: "검토 필요", color: "#b54708" },
  low: { text: "참고", color: "#175cd3" },
};

function fmtDate(s: string | null) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 날짜+시각(KST). 시각 정보가 없는 값(자정 UTC = 날짜만 제공되는 소스)은 날짜만 표시 */
function fmtDateTime(s: string | Date | null) {
  if (!s) return "";
  const d = new Date(s);
  // UTC 자정(Federal Register 등 날짜만 주는 소스) 또는 KST 자정(국가법령정보 공포일자)이면 시각 정보가 없는 값
  const h = d.getUTCHours(), m = d.getUTCMinutes(), sec = d.getUTCSeconds();
  const dateOnly = m === 0 && sec === 0 && (h === 0 || h === 15);
  if (dateOnly) return fmtDate(d.toISOString());
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
}

/** 발송 후보로 삼는 최대 되돌아보기 일수. 매일 수집되므로 지난 발송 이후 7일 + 여유 */
export const CANDIDATE_DAYS = 14;

/**
 * 주간 집계 구간
 *  - start/end : 이번 발송의 "후보" updates 의 created_at 범위 = 최근 CANDIDATE_DAYS 일.
 *                수집이 매일 돌기 때문에(일일 크론) 항목의 created_at 은 한 주에 걸쳐 흩어져 있다.
 *                따라서 "이번 주 월요일 이후"로 자르면 화~일요일에 수집된 항목이 전부 빠진다.
 *                대신 넉넉히 14일을 후보로 잡고, **이미 그 구독자에게 보낸 항목(deliveries.update_ids)은 제외**해서
 *                누락도 중복도 없게 한다.
 *  - weekStart  : 중복 발송 방지 키(deliveries.week_start). 이번 주 월요일 날짜.
 *  - periodStart/periodEnd : 이메일 상단에 표시할 "지난 한 주" 기간(지난주 월 ~ 일). 표시용.
 */
export function weekWindow(now = new Date(), opts: { recent?: boolean } = {}) {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const day = kst.getUTCDay(); // 0=일
  const diffToMonday = (day + 6) % 7;
  const thisMondayKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - diffToMonday); // 월 00:00 KST (KST 눈금)
  const thisMondayUtc = new Date(thisMondayKst - 9 * 3600_000);
  const start = new Date(now.getTime() - CANDIDATE_DAYS * 86400_000);
  if (opts.recent) {
    // 테스트용: 표시 기간을 최근 8일로 (중복 방지 키는 그대로 이번 주 월요일)
    const ps = new Date(now.getTime() - 8 * 86400_000);
    return { start, end: now, weekStart: new Date(thisMondayKst).toISOString().slice(0, 10), periodStart: ps, periodEnd: now };
  }
  return {
    start,
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

export function renderDigestHtml(sub: SubscriberRow, updates: UpdateRow[], period: { start: Date; end: Date; generatedAt?: Date; vote?: VoteSummary }) {
  const generatedAt = period.generatedAt ?? new Date();
  // 수집 기간 표기: 지난 발송(7일 전) 이후 매일 수집. 이전 메일에 안내한 항목은 제외됨
  const collectSince = new Date(generatedAt.getTime() - 7 * 86400_000);
  const byJ: Partial<Record<Jurisdiction, UpdateRow[]>> = {};
  for (const u of updates) (byJ[u.jurisdiction as Jurisdiction] ??= []).push(u);

  const productLine = sub.products.length
    ? `<p style="margin:0 0 16px;color:#475467;font-size:14px">모니터링 품목: ${sub.products.map((p, i) => esc(productLabel(p, i))).join(", ")}</p>`
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

  return `<!doctype html><html lang="ko">${EMAIL_HEAD}<body style="margin:0;background:#f9fafb;font-family:${EMAIL_FONT}">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:32px">
      ${forwardedNoticeHtml()}
      <p style="margin:0 0 4px;color:#667085;font-size:13px;letter-spacing:.04em">REGTIDE · 주간 리포트</p>
      <h1 style="margin:0 0 8px;font-size:22px;color:#101828">의료기기 규격·인증 업데이트</h1>
      <p style="margin:0 0 6px;color:#475467;font-size:14px">${fmtDate(period.start.toISOString())} ~ ${fmtDate(new Date(period.end.getTime() - 1).toISOString())} 주간 리포트 · 총 ${updates.length}건</p>
      <p style="margin:0 0 6px;color:#667085;font-size:12px;line-height:1.6"><strong style="color:#475467">정보 수집 기간</strong>: ${fmtDateTime(collectSince)} ~ ${fmtDateTime(generatedAt)} (매일 08:00 KST 수집, 각 기관이 최근 ${COLLECT_LOOKBACK_DAYS}일 내 발표·게재한 항목 기준, 이전 메일에 안내한 항목은 제외) · <strong style="color:#475467">리포트 생성</strong>: ${fmtDateTime(generatedAt)}</p>
      <p style="margin:0 0 16px;color:#667085;font-size:12px;line-height:1.6">모니터링 대상: ${COVERAGE.map((c) => `<strong style="color:#475467">${esc(c.country)}</strong>(${esc(c.agencies)})`).join(" · ")}</p>
      ${productLine}
      ${updates.length ? sections : empty}
      ${roadmapBlockHtml(generatedAt, period.vote)}
      ${shareBlockHtml()}
      <hr style="border:0;border-top:1px solid #eaecf0;margin:32px 0 16px">
      ${updates.length ? `<p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0 0 12px"><strong style="color:#667085">이번 메일의 출처</strong><br>
      ${sourcesUsed(updates.map((u) => u.source)).map((si) => `${si.url ? `<a href="${esc(si.url)}" style="color:#667085">${esc(si.agency)}</a>` : esc(si.agency)}${si.name ? ` — ${esc(si.name)}` : ""}`).join("<br>")}<br>
      "기관 발표"는 해당 기관이 원문에 표기한 게재 일시, "변경 감지"는 기관 페이지의 변경을 RegTide 가 확인한 시각입니다. 표기 시각은 모두 한국 표준시(KST)입니다.</p>` : ""}
      ${disclaimerFooterHtml(sub.unsubscribe_token)}
    </div>
  </div></body></html>`;
}

/** 동시 발송 방지 잠금 (수동 호출과 크론이 겹치는 경우). page_snapshots 에 잠금 행을 두고 10분 지나면 만료 */
const SEND_LOCK_KEY = "admin:send_lock";
const SEND_LOCK_MS = 10 * 60_000;
async function acquireSendLock(sb: ReturnType<typeof supabaseAdmin>): Promise<boolean> {
  const { data } = await sb.from("page_snapshots").select("content").eq("source_key", SEND_LOCK_KEY).maybeSingle();
  const prev = (data as { content?: string } | null)?.content;
  if (prev === undefined || prev === null) {
    // 잠금 행이 없으면 insert 로 생성 — 동시에 두 실행이 들어오면 PK 충돌로 한쪽만 성공
    const { error } = await sb.from("page_snapshots").insert({ source_key: SEND_LOCK_KEY, content_hash: "lock", content: String(Date.now()), fetched_at: new Date().toISOString() });
    return !error;
  }
  const held = Number(prev) || 0;
  if (held && Date.now() - held < SEND_LOCK_MS) return false;
  // compare-and-swap: 내가 읽은 값 그대로일 때만 갱신 → 동시 진입 시 한쪽만 성공
  const { data: sw, error } = await sb
    .from("page_snapshots")
    .update({ content: String(Date.now()), content_hash: "lock", fetched_at: new Date().toISOString() })
    .eq("source_key", SEND_LOCK_KEY)
    .eq("content", prev)
    .select("source_key");
  return !error && Array.isArray(sw) && sw.length === 1;
}
async function releaseSendLock(sb: ReturnType<typeof supabaseAdmin>) {
  await sb.from("page_snapshots").upsert({ source_key: SEND_LOCK_KEY, content_hash: "lock", content: "0", fetched_at: new Date().toISOString() }, { onConflict: "source_key" });
}

export interface SendResult {
  sent: number;
  skipped: number;
  failed: { email: string; error: string }[];
  /** 메일은 나갔지만 deliveries/last_sent_at 기록에 실패한 건 — 비어 있지 않으면 재실행 시 중복 발송 위험. 상태 점검이 표시 */
  recordErrors: string[];
}

/** 메일 발송 추상화 (테스트에서 가짜 발송기 주입용) */
export interface MailMessage { from: string; to: string; subject: string; html: string }
export interface SendOpts { idempotencyKey?: string }
export interface Mailer {
  send(msg: MailMessage, opts?: SendOpts): Promise<{ id?: string }>;
  /** 여러 통을 한 번의 API 호출로 발송 (Resend batch, 최대 100통). 없으면 send 를 반복 호출 */
  sendBatch?(msgs: MailMessage[], opts?: SendOpts): Promise<{ id?: string }[]>;
}

export function resendMailer(): Mailer {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(msg, opts) {
      // Idempotency-Key: 같은 키로 재요청하면 Resend 가 중복 발송하지 않음 (네트워크 오류 후 재시도 안전)
      const { data, error } = await resend.emails.send(msg, opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined);
      if (error) throw new Error(error.message);
      return { id: data?.id };
    },
    async sendBatch(msgs, opts) {
      const { data, error } = await resend.batch.send(msgs, opts?.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined);
      if (error) throw new Error(error.message);
      // SDK 버전에 따라 data 가 { data: [...] } 또는 [...] 형태
      const arr = (Array.isArray(data) ? data : (data as { data?: { id: string }[] } | null)?.data) ?? [];
      // 개수가 어긋나도 Resend 는 이미 접수했으므로 예외를 던지지 않는다 (던지면 개별 재발송 → 중복). id 만 비워둔다
      if (arr.length !== msgs.length) console.warn(`[digest] batch 응답 개수 불일치 (${arr.length}/${msgs.length}) — id 없이 기록`);
      return msgs.map((_, i) => ({ id: arr[i]?.id }));
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

  const updates = await selectAll<UpdateRow>(() =>
    sb.from("updates").select("*").not("classified_at", "is", null).gte("created_at", start.toISOString()).order("created_at", { ascending: true }).order("id", { ascending: true }),
  );
  let subs = await selectAll<SubscriberRow>(() => sb.from("subscribers").select("*").eq("active", true).order("created_at", { ascending: true }).order("id", { ascending: true }));

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

  const from = mailFrom();
  const vote = await loadVoteSummary(); // 새 기능 소식 블록용 (실패해도 빈 요약)
  const result: SendResult = { sent: 0, skipped: 0, failed: [], recordErrors: [] };
  // 멱등 키: 주(week_start) + 구독자 → 같은 주에 같은 사람에게는 재시도해도 한 번만 발송. 테스트 발송은 키 없음(매번 받아야 함)
  const idemKey = (subId: string) => (testOnly ? undefined : `regtide:${weekStart}:${subId}`);
  const batchKey = (ids: string[]) => (testOnly ? undefined : `regtide:${weekStart}:batch:${createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 24)}`);
  const nowIso = () => new Date().toISOString();

  // 발송 기록을 한 번에 조회 (구독자 수만큼 쿼리하지 않도록)
  //  - alreadySent : 이번 주에 이미 성공 발송한 구독자 (크론 재실행 안전)
  //  - deliveredIds: 구독자별로 과거 메일에 이미 실린 update id (매일 수집 체계에서 중복 안내 방지)
  const alreadySent = new Set<string>();
  const deliveredIds = new Map<string, Set<string>>();
  if (!testOnly) {
    const sinceDel = new Date(now.getTime() - (CANDIDATE_DAYS + 7) * 86400_000).toISOString();
    const dels = await selectAll<{ subscriber_id: string; status: string; week_start: string; update_ids: string[] }>(() =>
      sb.from("deliveries").select("subscriber_id, status, week_start, update_ids").eq("status", "sent").gte("sent_at", sinceDel).order("sent_at", { ascending: true }).order("id", { ascending: true }),
    );
    for (const d of dels) {
      if (d.week_start === weekStart) alreadySent.add(d.subscriber_id);
      if (!deliveredIds.has(d.subscriber_id)) deliveredIds.set(d.subscriber_id, new Set());
      for (const id of d.update_ids ?? []) deliveredIds.get(d.subscriber_id)!.add(id);
    }
  }

  // 테스트 발송은 deliveries 에 기록하지 않는다 (정기 발송의 중복 방지 키를 소모하지 않도록)
  const recordMany = async (rows: Record<string, unknown>[]) => {
    if (testOnly || rows.length === 0) return;
    const { error } = await sb
      .from("deliveries")
      .upsert(rows.map((r) => ({ week_start: weekStart, sent_at: nowIso(), ...r })), { onConflict: "subscriber_id,week_start" });
    if (error) {
      console.error("[digest] deliveries upsert failed:", error.message);
      result.recordErrors.push(`deliveries 기록 실패 (${rows.length}건): ${error.message}`);
    }
  };

  // 1) 구독자별 메시지 준비
  type Job = { sub: SubscriberRow; mine: UpdateRow[]; msg: MailMessage };
  const jobs: Job[] = [];
  const emptyRows: Record<string, unknown>[] = [];
  for (const sub of subs) {
    if (alreadySent.has(sub.id)) { result.skipped++; continue; }
    const seenIds = deliveredIds.get(sub.id);
    const mine = relevantUpdates(sub, seenIds ? updates.filter((u) => !seenIds.has(u.id)) : updates);
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
        html: renderDigestHtml(sub, mine, { start: periodStart, end: periodEnd, generatedAt: now, vote }),
      },
    });
  }
  await recordMany(emptyRows);

  // 2) 발송: batch 가 가능하면 50통씩 한 번에, 실패한 묶음은 개별 발송으로 재시도.
  //    묶음마다 발송 직후 deliveries·last_sent_at 을 기록한다 — 중간에 함수가 끊겨도 이미 보낸 사람이 다음 실행에서 또 받지 않도록.
  if (!testOnly && jobs.length) {
    if (!(await acquireSendLock(sb))) throw new Error("다른 발송 작업이 진행 중입니다 (10분 이내). 잠시 후 다시 시도하세요.");
  }
  try {
    const useBatch = !!mailer.sendBatch && !testOnly && jobs.length > 1;
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const chunk = jobs.slice(i, i + BATCH_SIZE);
      const sentRows: Record<string, unknown>[] = [];
      const failedRows: Record<string, unknown>[] = [];
      const sentIds: string[] = [];
      const markSent = (j: Job, id: string | undefined) => {
        sentRows.push({ subscriber_id: j.sub.id, update_ids: j.mine.map((u) => u.id), provider_message_id: id ?? null, status: "sent", error: null });
        sentIds.push(j.sub.id);
        result.sent++;
      };
      const sendOne = async (j: Job) => {
        try {
          markSent(j, (await mailer.send(j.msg, { idempotencyKey: idemKey(j.sub.id) })).id);
        } catch (e) {
          const msg = String((e as Error).message ?? e);
          failedRows.push({ subscriber_id: j.sub.id, update_ids: j.mine.map((u) => u.id), status: "failed", error: msg });
          result.failed.push({ email: j.sub.email, error: msg });
        }
      };

      let batched = false;
      if (useBatch) {
        // 같은 멱등 키로 최대 2회 시도 — 첫 시도가 접수됐는데 응답만 유실된 경우에도 Resend 가 중복 발송하지 않음
        const key = batchKey(chunk.map((j) => j.sub.id));
        for (let attempt = 0; attempt < 2 && !batched; attempt++) {
          try {
            const rs = await mailer.sendBatch!(chunk.map((j) => j.msg), { idempotencyKey: key });
            chunk.forEach((j, k) => markSent(j, rs[k]?.id));
            batched = true;
          } catch (e) {
            console.error(`[digest] batch send failed (attempt ${attempt + 1}/2):`, (e as Error).message);
          }
        }
        if (!batched) console.error("[digest] batch 2회 실패 — 개별 발송으로 대체 (개별 멱등 키 사용)");
      }
      if (!batched) for (const j of chunk) await sendOne(j);

      await recordMany([...sentRows, ...failedRows]);
      if (!testOnly && sentIds.length) {
        const { error } = await sb.from("subscribers").update({ last_sent_at: nowIso() }).in("id", sentIds);
        if (error) { console.error("[digest] last_sent_at update failed:", error.message); result.recordErrors.push(`last_sent_at 갱신 실패: ${error.message}`); }
      }
    }
  } finally {
    if (!testOnly && jobs.length) await releaseSendLock(sb).catch(() => {});
  }
  return result;
}
