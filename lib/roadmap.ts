/**
 * 로드맵 티저 문구 — 랜딩 카드와 메일 블록이 공유. 구체적 기능은 밝히지 않고 기대만 만든다.
 *  - "앞으로도 무료" 같은 미래 약속은 쓰지 않는다 (유료화 여지). 현재형 "지금 무료" 만.
 *  - 다음 기능의 후보와 투표는 lib/votes.ts (DB 라운드) 가 담당. 여기엔 문구만.
 */
export const ROADMAP_HEADLINE = "매주 월요일, 인허가·품질 담당자의 일이 하나씩 줄어듭니다.";
export const ROADMAP_SUB = "새 기능은 예고 없이 주간 리포트 안에서 먼저 열립니다. 지금 무료로 시작하세요.";
/** 랜딩에 참여 인원을 보여주기 시작하는 최소 인원 — 적은 숫자는 오히려 역효과라 그 전에는 숨긴다 */
export const VOTE_SHOW_PARTICIPANTS_MIN = 30;
/** 참여 인원 표시 문구: 100명 미만은 그대로, 이상은 "100명 이상"처럼 내림 */
export function participantsLabel(n: number) {
  if (n < VOTE_SHOW_PARTICIPANTS_MIN) return "";
  if (n < 100) return `지금까지 ${n}명 참여`;
  return `지금까지 ${Math.floor(n / 50) * 50}명 이상 참여`;
}
export const VOTE_TITLE = "다음 기능은 RA·QA 실무자가 고릅니다.";

/**
 * 메일 블록 전용 문구 — 받는 사람은 이미 구독자이므로 "지금 무료로 시작하세요" 같은 랜딩용 권유를 쓰지 않는다.
 *  - 아직 투표 전: 한 표 부탁
 *  - 이미 투표함: 감사 + 결과는 기능이 열릴 때 리포트에서
 */
export const EMAIL_ROADMAP_HEADLINE = "리포트는 매주, 기능은 하나씩 늘어납니다.";
export const EMAIL_ROADMAP_SUB = "새 기능은 예고 없이 이 리포트 안에서 먼저 열립니다. 구독자께 가장 먼저 안내드립니다.";
export const EMAIL_VOTE_ASK = "신규 기능은 구독자가 고릅니다. 어떤 기능이 먼저 필요한지 한 표 남겨 주세요.";
export const EMAIL_VOTE_LINK = "신규 기능 투표하기";
export const EMAIL_VOTE_LINK_NOTE = "(30초 · 라운드당 1회)";
export const EMAIL_VOTE_DONE = "투표해 주셔서 감사합니다. 결과는 뽑힌 기능이 열릴 때 이 리포트에서 알려드립니다.";
export const VOTE_SUB = "필요한 기능에 표를 주세요. 여러 개 골라도 되고, 목록에 없으면 직접 적어 주셔도 됩니다. 구독자 전용이며 라운드당 한 번 참여할 수 있습니다.";
