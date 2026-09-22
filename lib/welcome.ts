import { CATALOG_BY_ID, JURISDICTION_LABEL, productLabel, type Jurisdiction } from "@/lib/catalog";
import { COVERAGE } from "@/lib/source-info";
import { CANDIDATE_DAYS, resendMailer, type Mailer } from "@/lib/digest";
import { EMAIL_FONT, EMAIL_HEAD, disclaimerFooterHtml, esc, forwardUrl, roadmapBlockHtml, siteUrl } from "@/lib/email-common";
import { mailFrom, type SubscriberRow } from "@/lib/supabase";
import { loadVoteSummary, type VoteSummary } from "@/lib/votes";

/**
 * 구독 확인 메일 — 구독 신청 직후 신청한 주소로 1회 발송.
 *  - 신규 구독: "구독이 완료되었습니다"  /  기존 구독자의 설정 변경: "구독 설정이 변경되었습니다"
 *  - 내용: 등록 품목·선택 규격, 모니터링 대상 기관, 발송 주기와 첫 리포트 예정일, 면책 고지, 구독해지 링크
 *  - 동의 범위: 개인정보처리방침에 "구독 신청 확인 메일(1회)" 로 명시. 홍보·안내성 내용 없음.
 *  - 발송 실패는 구독 처리에 영향을 주지 않는다 (호출 측에서 catch)
 */

let mailerForTest: Mailer | null = null;
export function __setWelcomeMailerForTest(m: Mailer | null) { mailerForTest = m; }

/** 다음 월요일 09:00 KST (지금이 월요일 09:00 전이면 오늘) */
export function nextMondaySend(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const day = kst.getUTCDay(); // 0=일
  let add = (8 - day) % 7 || 7; // 다음 월요일까지 일수 (월요일이면 7)
  if (day === 1 && kst.getUTCHours() < 9) add = 0; // 월요일 09:00 전이면 오늘 발송분에 포함
  const mondayKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + add, 9, 0, 0);
  return new Date(mondayKst - 9 * 3600_000);
}

function fmtKst(d: Date) {
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }) + " KST";
}

export function renderWelcomeHtml(sub: SubscriberRow, opts: { isNew: boolean; now?: Date; vote?: VoteSummary }) {
  const now = opts.now ?? new Date();
  const site = siteUrl();
  const firstSend = nextMondaySend(now);

  const products = sub.products.length
    ? `<ul style="margin:6px 0 0;padding-left:18px;color:#344054;font-size:14px;line-height:1.7">${sub.products.map((p, i) => `<li><strong>${esc(productLabel(p, i))}</strong>${p.name?.trim() ? ` <span style="color:#667085">(${esc(p.category)})</span>` : ""}</li>`).join("")}</ul>`
    : "";

  const byJ: Partial<Record<Jurisdiction, string[]>> = {};
  for (const id of sub.catalog_ids) {
    const c = CATALOG_BY_ID[id];
    if (c) (byJ[c.jurisdiction] ??= []).push(c.label);
  }
  const catalog = (Object.keys(byJ) as Jurisdiction[])
    .map((j) => `<p style="margin:8px 0 0;color:#475467;font-size:13px;line-height:1.6"><strong style="color:#344054">${esc(JURISDICTION_LABEL[j])}</strong><br>${byJ[j]!.map((l) => `<span style="display:inline-block;background:#f2f4f7;color:#344054;border-radius:4px;padding:2px 8px;font-size:12px;margin:4px 4px 0 0">${esc(l)}</span>`).join("")}</p>`)
    .join("");

  const title = opts.isNew ? "구독이 완료되었습니다" : "구독 설정이 변경되었습니다";
  const intro = opts.isNew
    ? "RegTide 를 구독해 주셔서 감사합니다. 아래 내용으로 규제 업데이트 모니터링을 시작합니다."
    : "구독 설정이 아래 내용으로 변경되었습니다. 다음 리포트부터 반영됩니다.";

  return `<!doctype html><html lang="ko">${EMAIL_HEAD}<body style="margin:0;background:#f9fafb;font-family:${EMAIL_FONT}">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px">
    <div style="background:#fff;border:1px solid #eaecf0;border-radius:12px;padding:32px">
      <p style="margin:0 0 4px;color:#667085;font-size:13px;letter-spacing:.04em">REGTIDE · 구독 확인</p>
      <h1 style="margin:0 0 12px;font-size:22px;color:#101828">${title}</h1>
      <p style="margin:0 0 20px;color:#475467;font-size:14px;line-height:1.7">${intro}</p>

      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eaecf0;border-radius:8px;background:#fcfcfd"><tr><td style="padding:16px 20px">
        <p style="margin:0;color:#667085;font-size:12px;letter-spacing:.04em">발송 안내</p>
        <p style="margin:6px 0 0;color:#101828;font-size:14px;line-height:1.7">
          <strong>매주 월요일 09:00 KST</strong> 에 지난 한 주의 변경 사항을 한 통으로 보내드립니다.<br>
          첫 리포트 예정: <strong>${fmtKst(firstSend)}</strong><br>
          <span style="color:#667085;font-size:13px">첫 리포트에는 최근 ${CANDIDATE_DAYS}일 안에 수집된 항목 중 선택하신 규격·인증에 해당하는 것이 함께 실립니다. 해당 항목이 없는 주에도 "이번 주 변경 없음"으로 짧게 안내드려, 모니터링이 계속되고 있음을 확인하실 수 있습니다.</span>
        </p>
      </td></tr></table>

      <h2 style="font-size:16px;margin:24px 0 4px;color:#101828">등록 품목</h2>
      ${products || `<p style="margin:6px 0 0;color:#667085;font-size:14px">등록된 품목이 없습니다.</p>`}

      <h2 style="font-size:16px;margin:24px 0 0;color:#101828">모니터링 규격·인증 (${sub.catalog_ids.length}개)</h2>
      ${catalog}

      <h2 style="font-size:16px;margin:24px 0 4px;color:#101828">모니터링 대상</h2>
      <p style="margin:0;color:#475467;font-size:13px;line-height:1.7">${COVERAGE.map((c) => `<strong style="color:#344054">${esc(c.country)}</strong> — ${esc(c.agencies)}`).join("<br>")}</p>
      <p style="margin:12px 0 0;color:#667085;font-size:13px;line-height:1.7">품목이나 규격을 바꾸려면 <a href="${esc(site)}" style="color:#175cd3">구독 페이지</a>에서 같은 이메일로 다시 신청하시면 됩니다. 기존 설정이 새 내용으로 바뀝니다.<br>같은 팀 동료에게도 필요하다면 이 링크를 전달해 주세요: <a href="${esc(forwardUrl())}" style="color:#175cd3">${esc(forwardUrl())}</a></p>

      ${roadmapBlockHtml(now, opts.vote, sub.id)}

      <p style="margin:16px 0 0;color:#98a2b3;font-size:12px;line-height:1.6">이 메일은 구독 신청 확인을 위해 신청하신 주소로 1회 발송됩니다. 이후에는 매주 월요일 리포트 외의 메일을 보내지 않으며, 새 기능 소식도 리포트 안에서만 안내드립니다.<br>본인이 신청하지 않으셨다면 아래 구독해지 링크를 눌러 확인 화면에서 해지해 주세요. 이메일 주소가 즉시 삭제되며 더 이상 메일이 가지 않습니다.</p>

      <hr style="border:0;border-top:1px solid #eaecf0;margin:24px 0 16px">
      ${disclaimerFooterHtml(sub.unsubscribe_token, "RegTide 가 보내드리는 리포트는")}
    </div>
  </div></body></html>`;
}

export async function sendWelcomeEmail(sub: SubscriberRow, opts: { isNew: boolean; now?: Date }) {
  const mailer = mailerForTest ?? resendMailer();
  const vote = await loadVoteSummary();
  const subject = opts.isNew ? "[RegTide] 구독이 완료되었습니다" : "[RegTide] 구독 설정이 변경되었습니다";
  return mailer.send({ from: mailFrom(), to: sub.email, subject, html: renderWelcomeHtml(sub, { ...opts, vote }) });
}
