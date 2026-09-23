import { ADMIN_EMAIL } from "@/lib/admin-report";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * 테스트 다이제스트 추가 수신자 — 관리자 대시보드(운영 작업 탭)에서 추가·삭제.
 *  - 저장: page_snapshots 의 "admin:test_emails" 행(JSON 배열). 새 테이블·마이그레이션 없음.
 *  - 선택: Vercel 환경변수 TEST_EMAILS="a@gmail.com,b@naver.com" 도 함께 인정(대시보드에서는 삭제 불가로 표시).
 *  - 용도: 메일 앱별 표시·스팸함 분류 확인용 운영자 본인 주소. 테스트 메일만 가며(제목 [테스트], 발송 기록 없음),
 *    운영 리포트(일일·마일스톤)는 여전히 ADMIN_EMAIL(운영자 도메인)로만 간다.
 */
const KEY = "admin:test_emails";
export const TEST_RECIPIENTS_MAX = 5;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(s: string) {
  return s.trim().toLowerCase();
}
export function isValidEmail(s: string) {
  return EMAIL_RE.test(s) && s.length <= 254;
}
function envList(): string[] {
  return (process.env.TEST_EMAILS ?? "").split(/[,\s]+/).map(normalizeEmail).filter(isValidEmail);
}

/** 대시보드에서 등록한 주소 (없거나 읽기 실패 시 빈 배열) */
export async function listStoredTestEmails(): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin().from("page_snapshots").select("content").eq("source_key", KEY).maybeSingle();
    const arr = JSON.parse((data as { content?: string } | null)?.content ?? "[]");
    return Array.isArray(arr) ? arr.map(String).map(normalizeEmail).filter(isValidEmail) : [];
  } catch {
    return [];
  }
}

async function save(list: string[]) {
  const { error } = await supabaseAdmin()
    .from("page_snapshots")
    .upsert({ source_key: KEY, content_hash: String(list.length), content: JSON.stringify(list), fetched_at: new Date().toISOString() }, { onConflict: "source_key" });
  if (error) throw new Error(error.message);
}

export async function addTestEmail(raw: string): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) return { ok: false, message: "이메일 형식이 올바르지 않습니다." };
  if (email === ADMIN_EMAIL()) return { ok: false, message: "운영자 주소는 이미 테스트 수신자입니다." };
  const cur = await listStoredTestEmails();
  if (cur.includes(email) || envList().includes(email)) return { ok: false, message: `${email} 은(는) 이미 등록되어 있습니다.` };
  if (cur.length >= TEST_RECIPIENTS_MAX) return { ok: false, message: `테스트 수신자는 최대 ${TEST_RECIPIENTS_MAX}개까지 등록할 수 있습니다.` };
  await save([...cur, email]);
  return { ok: true, message: `테스트 수신자에 ${email} 을(를) 추가했습니다.` };
}

export async function removeTestEmail(raw: string): Promise<{ ok: boolean; message: string }> {
  const email = normalizeEmail(raw);
  const cur = await listStoredTestEmails();
  if (!cur.includes(email)) return { ok: false, message: `${email} 은(는) 대시보드에 등록된 주소가 아닙니다.` };
  await save(cur.filter((e) => e !== email));
  return { ok: true, message: `테스트 수신자에서 ${email} 을(를) 삭제했습니다.` };
}

/** 테스트 다이제스트를 받을 전체 주소: 운영자 → 대시보드 등록분 → 환경변수분 (중복 제거) */
export async function testRecipients(): Promise<{ email: string; source: "admin" | "dashboard" | "env" }[]> {
  const out: { email: string; source: "admin" | "dashboard" | "env" }[] = [{ email: ADMIN_EMAIL(), source: "admin" }];
  const seen = new Set(out.map((o) => o.email));
  for (const e of await listStoredTestEmails()) if (!seen.has(e)) { seen.add(e); out.push({ email: e, source: "dashboard" }); }
  for (const e of envList()) if (!seen.has(e)) { seen.add(e); out.push({ email: e, source: "env" }); }
  return out.slice(0, 1 + TEST_RECIPIENTS_MAX * 2);
}
