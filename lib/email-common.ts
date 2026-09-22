import { EMAIL_ROADMAP_HEADLINE, EMAIL_ROADMAP_SUB, EMAIL_VOTE_ASK, EMAIL_VOTE_DONE, EMAIL_VOTE_LINK, EMAIL_VOTE_LINK_NOTE } from "@/lib/roadmap";
import { recentlyReleased, type VoteSummary } from "@/lib/votes";
import { voteUrl as voteUrlFor } from "@/lib/vote-token";
/**
 * 구독자에게 나가는 모든 메일(주간 리포트·구독 확인)이 공유하는 조각.
 * 면책 고지는 여기 한 곳에만 두어, 어떤 메일이든 같은 문구·같은 구독해지 안내가 실리도록 한다.
 * (상태 점검 lib/health.ts 와 selftest 가 이 문구의 필수 표현을 검사한다)
 */

export function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const EMAIL_FONT = "Pretendard,'Pretendard Variable',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',Roboto,sans-serif";
const PRETENDARD_CSS = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css";

/** <head> — Pretendard 웹폰트(지원하는 메일 앱에서만 적용, 나머지는 시스템 한글 폰트) */
export const EMAIL_HEAD = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${PRETENDARD_CSS}"><style>@import url("${PRETENDARD_CSS}");body,td,p,a,h1,h2,h3,span,strong,li{font-family:${EMAIL_FONT} !important}</style></head>`;

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

export function unsubscribeUrl(token: string) {
  return `${siteUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * 이용 안내 및 면책 + 구독해지 안내.
 * lead: 첫 문장(메일 종류에 따라 다름). 필수 표현: 참고용 정보 / 법적 효력이 없습니다 / 원문 링크에서 확인 /
 * 책임은 이용자에게 / /disclaimer 링크 / /api/unsubscribe?token= 링크. AI 언급·'수신거부' 금지.
 */
export function disclaimerFooterHtml(unsubscribeToken: string, lead = "본 메일은") {
  const site = siteUrl();
  const unsub = unsubscribeUrl(unsubscribeToken);
  return `<p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0 0 8px"><strong style="color:#667085">이용 안내 및 면책</strong><br>
      ${esc(lead)} 식약처, 국가법령정보센터, 미국 Federal Register, EU Commission, ISO/IEC 등 공개된 규제 정보 소스를 자동으로 수집·분류하여 제공하는 <strong>참고용 정보</strong>입니다. 법률·규제 자문이 아니며 법적 효력이 없습니다. 발췌문은 원문의 일부이므로 정확한 내용과 시행일은 반드시 원문 링크에서 확인하시기 바랍니다.<br>
      수집 소스의 변경, 사이트 접근 제한, 분류 규칙의 한계 등으로 일부 변경 사항이 누락되거나 지연되거나 관련 없는 항목이 포함될 수 있습니다. 본 정보를 바탕으로 한 인허가·품질·사업상 판단과 그 결과에 대한 책임은 이용자에게 있으며, RegTide 는 이에 대해 책임을 지지 않습니다. 각 원문의 저작권은 해당 발행 기관에 있습니다. 전문은 <a href="${esc(site)}/disclaimer" style="color:#667085">이용 안내 및 면책조항</a>을 참고하세요.</p>
      <p style="color:#98a2b3;font-size:12px;line-height:1.6;margin:0">
      더 이상 수신을 원치 않으시면 <a href="${esc(unsub)}" style="color:#667085">구독해지</a>를 누른 뒤 확인 화면에서 해지를 선택해 주세요. 구독해지 시 이메일 주소는 즉시 삭제됩니다.</p>`;
}

/** 전달 유입 채널 코드 — 메일을 전달받은 사람이 이 링크로 구독하면 대시보드 채널 통계에 "fwd" 로 잡힌다 */
export const FORWARD_REF = "fwd";
export function forwardUrl() {
  return `${siteUrl()}/?ref=${FORWARD_REF}`;
}

/** 메일 상단 — 전달받은 사람을 위한 한 줄 안내 (수신자 본인에게는 거슬리지 않게 작게) */
export function forwardedNoticeHtml() {
  return `<p style="margin:0 0 14px;padding:8px 12px;background:#f2f4f7;border-radius:6px;color:#475467;font-size:12px;line-height:1.6">이 메일을 동료에게 전달받으셨나요? <a href="${esc(forwardUrl())}" style="color:#175cd3;font-weight:600">내 품목 기준으로 직접 받기</a> — 무료, 회원가입 없음. 아래 구독해지 링크는 원 수신자 전용이니 누르지 마세요.</p>`;
}

/**
 * 새 기능 소식 블록 — 주간 리포트·확인 메일 안에만 실린다 (별도 메일 없음, 처리방침 1항 고지 범위).
 *  - 최근 21일 안에 출시 표시된 투표 후보가 있으면 "여러분이 뽑은 기능이 열렸습니다"
 *  - 열린 라운드가 있으면 개인 투표 링크. 이미 투표한 구독자에게는 링크 대신 감사 문구
 *  - 요약이 없으면(상태 점검 렌더링·마이그레이션 전) 티저 문구만
 *  문구는 구독자 대상(lib/roadmap.ts EMAIL_*) — 랜딩의 "지금 무료로 시작하세요" 류 권유는 쓰지 않는다
 */
export function roadmapBlockHtml(now = new Date(), summary?: VoteSummary, subscriberId?: string) {
  const released = summary ? recentlyReleased(summary, now) : [];
  const open = summary?.open ?? null;
  const voteUrl = subscriberId && subscriberId !== "test" && subscriberId !== "health" ? voteUrlFor(siteUrl(), subscriberId) : `${siteUrl()}/#roadmap`;
  const lines: string[] = [];
  if (released.length) lines.push(`<p style="margin:0 0 6px;color:#101828;font-size:14px;font-weight:600">여러분이 뽑은 기능이 열렸습니다.</p><ul style="margin:0 0 8px;padding-left:18px;color:#344054;font-size:13px;line-height:1.6">${released.map((o) => `<li><strong>${esc(o.label)}</strong>${o.description ? ` <span style="color:#667085">— ${esc(o.description)}</span>` : ""}</li>`).join("")}</ul>`);
  else lines.push(`<p style="margin:0 0 6px;color:#101828;font-size:14px;font-weight:600">${esc(EMAIL_ROADMAP_HEADLINE)}</p><p style="margin:0 0 8px;color:#475467;font-size:13px;line-height:1.6">${esc(EMAIL_ROADMAP_SUB)}</p>`);
  if (open) {
    const voted = !!subscriberId && open.voters.includes(subscriberId);
    if (voted) lines.push(`<p style="margin:0;color:#344054;font-size:13px;line-height:1.6">${esc(EMAIL_VOTE_DONE)}</p>`);
    else lines.push(`<p style="margin:0;color:#344054;font-size:13px;line-height:1.6">${esc(EMAIL_VOTE_ASK)}<br><a href="${esc(voteUrl)}" style="color:#175cd3;font-weight:600">${esc(EMAIL_VOTE_LINK)}</a> <span style="color:#667085">${esc(EMAIL_VOTE_LINK_NOTE)}</span></p>`);
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0"><tr><td style="padding:14px 16px;border:1px solid #eaecf0;border-radius:8px;background:#fcfcfd">${lines.join("")}</td></tr></table>`;
}

/** 메일 하단 — 공유 요청 블록 */
export function shareBlockHtml() {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0"><tr><td style="padding:14px 16px;border:1px solid #d0d5dd;border-radius:8px;background:#fcfcfd">
      <p style="margin:0 0 4px;color:#101828;font-size:14px;font-weight:600">이 리포트가 도움이 되셨다면 같은 팀 동료에게 전달해 주세요.</p>
      <p style="margin:0;color:#475467;font-size:13px;line-height:1.6">전달받은 분은 아래 링크에서 본인 품목 기준으로 30초 만에 구독할 수 있습니다.<br><a href="${esc(forwardUrl())}" style="color:#175cd3;font-weight:600">${esc(forwardUrl())}</a></p>
    </td></tr></table>`;
}
