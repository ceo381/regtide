import { supabaseAdmin } from "@/lib/supabase";

/** 채널 등록부 — 대시보드에서 만드는 채널 태그. 링크의 ?ref=code 와 1:1 */
export interface ChannelRow {
  code: string;
  name: string;
  kind: string;
  audience_size: number | null;
  posted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const CHANNEL_KINDS = ["오픈채팅", "협회·조합", "교육기관", "매체", "링크드인", "커뮤니티", "파트너", "메일전달", "기타"] as const;
export const CODE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** 이름에서 코드 자동 생성: 한글은 제거되므로 영문 이름이거나 코드를 직접 입력하는 것을 권장 */
export function slugify(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s_-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40);
}

export async function listChannels(): Promise<ChannelRow[]> {
  const { data, error } = await supabaseAdmin().from("channels").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ChannelRow[];
}

export interface ChannelInput {
  code: string;
  name: string;
  kind?: string;
  audience_size?: number | null;
  posted_at?: string | null;
  notes?: string | null;
}

export function validateChannel(raw: Record<string, unknown>): { ok: true; value: ChannelInput } | { ok: false; error: string } {
  const code = String(raw.code ?? "").trim().toLowerCase();
  const name = String(raw.name ?? "").trim();
  if (!CODE_RE.test(code)) return { ok: false, error: "코드는 영문 소문자·숫자·_·- 만, 40자 이내여야 합니다 (예: openchat2, kmdia, press-mdtoday)." };
  if (!name || name.length > 80) return { ok: false, error: "채널 이름을 1~80자로 입력하세요." };
  const kind = String(raw.kind ?? "기타").trim();
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "채널 종류가 올바르지 않습니다." };
  const sizeRaw = String(raw.audience_size ?? "").trim();
  const audience_size = sizeRaw ? Number(sizeRaw.replace(/,/g, "")) : null;
  if (audience_size != null && (!Number.isFinite(audience_size) || audience_size < 0 || audience_size > 10_000_000)) return { ok: false, error: "대상 인원은 0 이상의 숫자여야 합니다." };
  const postedRaw = String(raw.posted_at ?? "").trim();
  let posted_at: string | null = null;
  if (postedRaw) {
    // <input type="datetime-local"> 값(KST 로 입력) → UTC ISO
    const d = new Date(postedRaw.length === 16 ? `${postedRaw}:00+09:00` : postedRaw);
    if (isNaN(d.getTime())) return { ok: false, error: "게시 일시 형식이 올바르지 않습니다." };
    posted_at = d.toISOString();
  }
  const notes = String(raw.notes ?? "").trim().slice(0, 2000) || null;
  return { ok: true, value: { code, name, kind, audience_size, posted_at, notes } };
}

export async function upsertChannel(v: ChannelInput) {
  const { error } = await supabaseAdmin()
    .from("channels")
    .upsert({ ...v, updated_at: new Date().toISOString() }, { onConflict: "code" });
  if (error) throw error;
}

export async function deleteChannel(code: string) {
  const { error } = await supabaseAdmin().from("channels").delete().eq("code", code);
  if (error) throw error;
}
