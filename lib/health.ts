import { allAdapters } from "@/lib/sources";
import { consecutiveZeroRuns, enabled, everHadItems, type LastCollect } from "@/lib/collect";
import { describeSource } from "@/lib/source-info";
import { renderDigestHtml } from "@/lib/digest";
import { renderWelcomeHtml } from "@/lib/welcome";
import { supabaseAdmin, type SubscriberRow } from "@/lib/supabase";

/**
 * 상태 점검 — 운영자가 대시보드 최상단·일일 리포트에서 "문제가 있는가"를 한눈에 보게 한다.
 * 두 핵심 기준(수집 누락 방지, 면책 고지)을 중심으로 점검하고, 발송·설정 문제도 함께 본다.
 *
 * level: critical(즉시 조치) / warning(확인 필요) / info(참고)
 */
export type HealthLevel = "critical" | "warning" | "info";
export interface HealthIssue {
  level: HealthLevel;
  area: "수집" | "면책·고지" | "발송" | "설정";
  title: string;
  detail: string;
  action?: string;
}
export interface HealthReport {
  checkedAt: string;
  issues: HealthIssue[];
  counts: Record<HealthLevel, number>;
  ok: boolean; // critical·warning 이 없으면 true
}

const HOURS = 3600_000;

/** 면책 고지 자체 점검 — 실제 템플릿을 렌더링해 필수 문구가 모두 있는지 확인 */
export function checkDisclaimerTemplate(): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const sub: SubscriberRow = { id: "health", email: "health@check.local", unsubscribe_token: "x", products: [], catalog_ids: [], active: true, last_sent_at: null };
  // 구독자에게 나가는 모든 템플릿(주간 리포트·구독 확인)을 렌더링해 같은 기준으로 검사
  const templates: [string, () => string][] = [
    ["주간 리포트", () => renderDigestHtml(sub, [], { start: new Date(), end: new Date(), generatedAt: new Date() })],
    ["구독 확인", () => renderWelcomeHtml(sub, { isNew: true })],
  ];
  const must: [string, string][] = [
    ["참고용 정보", "'참고용' 명시"],
    ["법적 효력이 없습니다", "법적 효력 부인"],
    ["원문 링크에서 확인", "원문 확인 안내"],
    ["책임은 이용자에게", "책임 귀속 문구"],
    ["/disclaimer", "면책조항 전문 링크"],
    ["/api/unsubscribe?token=", "구독해지 링크"],
  ];
  for (const [name, render] of templates) {
    let html = "";
    try {
      html = render();
    } catch (e) {
      issues.push({ level: "critical", area: "면책·고지", title: `${name} 메일 템플릿 렌더링 실패`, detail: String((e as Error).message ?? e), action: "lib/digest.ts · lib/welcome.ts 확인" });
      continue;
    }
    const at = html.indexOf("이용 안내 및 면책");
    const footer = at >= 0 ? html.slice(at) : "";
    for (const [needle, label] of must) {
      if (!footer.includes(needle)) issues.push({ level: "critical", area: "면책·고지", title: `${name} 메일 면책 고지 누락: ${label}`, detail: `템플릿 하단에 "${needle}" 가 없습니다.`, action: "lib/email-common.ts 의 면책 문구를 복구하고 selftest 실행" });
    }
    if (/\bAI\b|인공지능|자동 요약|생성형/.test(footer)) issues.push({ level: "critical", area: "면책·고지", title: `${name} 메일 면책 문구에 AI 언급`, detail: "운영 방침상 면책·안내 문구에 AI 를 언급하지 않습니다.", action: "lib/email-common.ts 문구 수정" });
    if (html.includes("수신거부")) issues.push({ level: "warning", area: "면책·고지", title: `${name} 메일에 '수신거부' 용어 사용`, detail: "'구독해지' 로 통일해야 합니다.", action: "템플릿 문구 수정" });
  }
  if (!(process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://")) issues.push({ level: "warning", area: "설정", title: "사이트 URL 이 https 가 아님", detail: `NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL ?? "(미설정)"} — 메일의 구독해지·면책 링크가 이 값으로 생성됩니다.`, action: "Vercel 환경변수 확인" });
  return issues;
}

export function checkCollection(last: LastCollect | null, now = new Date()): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (!last) {
    issues.push({ level: "warning", area: "수집", title: "수집 기록 없음", detail: "아직 한 번도 수집이 실행되지 않았습니다.", action: "대시보드 운영 작업 → 수집 실행" });
    return issues;
  }
  const ageH = (now.getTime() - new Date(last.ranAt).getTime()) / HOURS;
  if (ageH > 36) issues.push({ level: "critical", area: "수집", title: `마지막 수집이 ${Math.floor(ageH)}시간 전`, detail: "일일 크론(08:00 KST)이 실행되지 않고 있습니다. 수집 공백이 길어지면 RSS 목록에서 밀려난 항목은 복구할 수 없습니다.", action: "Vercel → Cron Jobs / Logs 에서 /api/cron/daily-report 실행 여부 확인" });

  for (const e of last.errors ?? []) issues.push({ level: "critical", area: "수집", title: `소스 오류: ${describeSource(e.source).agency}`, detail: `${e.source} — ${e.error}`, action: "오류 메시지대로 소스 어댑터 점검" });
  for (const s of last.skipped ?? []) issues.push({ level: "warning", area: "수집", title: `소스 건너뜀: ${s.source}`, detail: s.reason, action: "차단(403)이 지속되면 DISABLED_SOURCES 로 명시적으로 끄고 대체 소스 검토" });

  // 활성 어댑터 중 마지막 수집 결과에 아예 없는 소스 (코드에 있는데 실행되지 않음)
  const expected = [...new Set(enabled(allAdapters()).map((a) => a.key))];
  const seen = new Set(Object.keys(last.bySource ?? {}));
  const erroredOrSkipped = new Set([...(last.errors ?? []).map((e) => e.source), ...(last.skipped ?? []).map((s) => s.source.split(" ")[0])]);
  for (const k of expected) {
    if (!seen.has(k) && !erroredOrSkipped.has(k)) issues.push({ level: "warning", area: "수집", title: `소스 결과 없음: ${describeSource(k).agency} · ${describeSource(k).name || k}`, detail: "마지막 수집 결과에 이 소스가 포함되지 않았습니다(배포 전 코드 또는 실행 중단).", action: "재배포 후 수집 실행" });
  }

  // 연속 0건 (원본 건수 기준 — 피드 자체가 비었을 때만). 페이지 감시 제외.
  //  - 예전에 항목이 오던 소스가 7회 연속 비면 "조용해짐" → 즉시 조치
  //  - 한 번도 항목이 없던 소스는 아직 판단 불가 → 7회 이상이면 확인 등급
  for (const k of Object.keys(last.bySource ?? {})) {
    if (k.startsWith("page_watch:")) continue;
    const n = consecutiveZeroRuns(last.history, k);
    const name = `${describeSource(k).agency} · ${describeSource(k).name || k}`;
    if (n >= 7 && everHadItems(last.history, k)) issues.push({ level: "critical", area: "수집", title: `수집 누락 경보: ${name}`, detail: `이전에는 항목이 오던 소스가 ${n}회 연속 빈 응답. 피드 URL·구조 변경 또는 차단 가능성.`, action: "브라우저에서 피드 URL 을 직접 열어 항목이 있는지 대조" });
    else if (n >= 7) issues.push({ level: "warning", area: "수집", title: `${name} — ${n}회 연속 빈 응답`, detail: "이 소스에서 아직 한 번도 항목을 받지 못했습니다. 피드가 원래 비어 있거나 URL 이 잘못됐을 수 있습니다.", action: "브라우저에서 피드 URL 을 직접 열어 확인" });
  }
  if (!(process.env.LAW_GO_KR_OC ?? "").trim()) issues.push({ level: "info", area: "수집", title: "국가법령정보 Open API 미연결", detail: "LAW_GO_KR_OC 가 없어 법령·행정규칙 개정 이력 소스가 꺼져 있습니다.", action: "승인 후 Vercel 에 LAW_GO_KR_OC 추가 → Redeploy" });
  return issues;
}

export async function checkDataAndDelivery(now = new Date()): Promise<HealthIssue[]> {
  const issues: HealthIssue[] = [];
  const sb = supabaseAdmin();
  const kst = new Date(now.getTime() + 9 * HOURS);
  const monday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((kst.getUTCDay() + 6) % 7)));
  const weekStart = monday.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 24 * HOURS).toISOString();

  const [unclassifiedQ, activeQ, delsQ] = await Promise.all([
    sb.from("updates").select("id", { count: "exact", head: true }).is("classified_at", null).lt("created_at", dayAgo),
    sb.from("subscribers").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("deliveries").select("status, error").eq("week_start", weekStart),
  ]);
  const unclassified = unclassifiedQ.count ?? 0;
  if (unclassified > 0) issues.push({ level: "warning", area: "수집", title: `분류되지 않은 항목 ${unclassified}건`, detail: "수집 후 24시간이 지났는데 분류가 안 된 항목이 있습니다. 분류가 안 되면 메일에 실리지 않습니다.", action: "대시보드 운영 작업 → 분류 실행" });

  const active = activeQ.count ?? 0;
  const dels = (delsQ.data ?? []) as { status: string; error: string | null }[];
  const failed = dels.filter((d) => d.status === "failed");
  if (failed.length) {
    const reasons = [...new Set(failed.map((f) => f.error ?? "").filter(Boolean))].slice(0, 2).join(" / ");
    issues.push({ level: "critical", area: "발송", title: `이번 주 발송 실패 ${failed.length}건`, detail: reasons || "원인 미기록", action: "발송 기록 탭에서 오류 확인. 실패 건은 다음 크론에서 자동 재시도" });
  }
  // 월요일 12:00 KST 이후인데 이번 주 발송 기록이 하나도 없으면 크론 미실행 (Hobby 크론은 최대 1시간 지연 가능)
  const mondayNoonKst = new Date(monday.getTime() + 12 * HOURS - 9 * HOURS);
  if (now >= mondayNoonKst && dels.length === 0 && active > 0) {
    issues.push({ level: "critical", area: "발송", title: "이번 주 정기 발송 기록 없음", detail: `월요일 09:00 KST 크론이 실행되지 않았거나 실패했습니다 (활성 구독자 ${active}명).`, action: "Vercel Logs 에서 /api/cron/weekly 확인 후 필요시 ?step=send&confirm=all 로 수동 발송" });
  }
  // 구독해지 급증 — 최근 7일 해지가 활성 구독자의 5% 이상(최소 3건)이면 확인, 10% 이상이면 즉시
  try {
    const weekAgo = new Date(now.getTime() - 7 * 24 * HOURS).toISOString();
    const { count: unsub7, error: ue } = await sb.from("unsubscribes").select("id", { count: "exact", head: true }).gte("unsubscribed_at", weekAgo);
    if (!ue && (unsub7 ?? 0) >= 3 && active > 0) {
      const rate = (unsub7 ?? 0) / (active + (unsub7 ?? 0));
      if (rate >= 0.05) issues.push({ level: rate >= 0.1 ? "critical" : "warning", area: "발송", title: `구독해지 증가: 최근 7일 ${unsub7}건 (${(rate * 100).toFixed(1)}%)`, detail: "발송 직후 해지가 몰리면 내용·빈도·분류 정확도 문제일 수 있습니다. 구독자 탭의 해지 통계(구독 기간·받은 리포트 수)로 원인을 좁히세요.", action: "최근 리포트의 '무관' 항목 비율과 카탈로그 키워드 점검" });
    }
  } catch { /* unsubscribes 테이블 없음 — 마이그레이션 전 */ }
  // Resend 일일 한도
  const limit = Number(process.env.RESEND_DAILY_LIMIT ?? 100) || 100;
  if (active + 5 >= limit) {
    issues.push({ level: active >= limit ? "critical" : "warning", area: "발송", title: `구독자 ${active}명 — 메일 일일 한도(${limit}통) 근접/초과`, detail: "Resend 무료 플랜은 하루 100통입니다. 한도를 넘으면 월요일 발송이 중간에 끊깁니다.", action: "Resend Pro 업그레이드 후 Vercel 에 RESEND_DAILY_LIMIT=50000 설정" });
  }
  if ((process.env.MAIL_FROM ?? "").includes("resend.dev")) {
    issues.push({ level: "critical", area: "발송", title: "발신 주소가 테스트용(onboarding@resend.dev)", detail: "Resend 테스트 모드에서는 운영자 본인 주소로만 발송됩니다. 구독자에게는 전부 실패합니다.", action: "도메인 인증 후 MAIL_FROM 을 인증 도메인 주소로 변경" });
  }
  return issues;
}

export async function computeHealth(last: LastCollect | null, now = new Date()): Promise<HealthReport> {
  const issues = [...checkDisclaimerTemplate(), ...checkCollection(last, now), ...(await checkDataAndDelivery(now).catch((e) => [{ level: "warning", area: "설정", title: "상태 점검 중 DB 조회 실패", detail: String((e as Error).message ?? e) } as HealthIssue]))];
  const order: Record<HealthLevel, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  const counts: Record<HealthLevel, number> = { critical: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.level]++;
  return { checkedAt: now.toISOString(), issues, counts, ok: counts.critical === 0 && counts.warning === 0 };
}
