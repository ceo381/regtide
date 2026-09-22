import { selectAll, supabaseAdmin } from "@/lib/supabase";

/**
 * 기능 투표·건의 — 익명. 저장하지 않는 것: 이메일, IP, 브라우저 식별값.
 * 라운드(vote_rounds) 하나가 열려 있으면 랜딩·메일에 투표 상자가 보이고, 마감·출시 표시는 대시보드에서 한다.
 */
export interface VoteRound { id: string; title: string; status: "open" | "closed"; show_results: boolean; release_note: string | null; opened_at: string; closed_at: string | null }
export interface VoteOption { id: string; round_id: string; label: string; description: string | null; sort: number; released_at: string | null }
export interface SuggestionRow { id: string; round_id: string | null; message: string; ref: string | null; created_at: string }

export interface VoteSummary {
  open: (VoteRound & { options: (VoteOption & { count: number })[]; total: number }) | null;
  /** 출시 표시된 후보 (최근 순) — 랜딩 "출시된 기능" 이력, 메일 "여러분이 뽑은 기능이 열렸습니다" */
  released: (VoteOption & { round_title: string })[];
  closedRounds: (VoteRound & { options: (VoteOption & { count: number })[]; total: number })[];
}

const EMPTY: VoteSummary = { open: null, released: [], closedRounds: [] };

/** 라운드·후보·득표를 한 번에 (테이블이 없으면 빈 요약 — 마이그레이션 전에도 사이트는 동작) */
export async function loadVoteSummary(): Promise<VoteSummary> {
  try {
    const sb = supabaseAdmin();
    const [rounds, options, votes] = await Promise.all([
      selectAll<VoteRound>(() => sb.from("vote_rounds").select("*").order("opened_at", { ascending: false }).order("id", { ascending: true })),
      selectAll<VoteOption>(() => sb.from("vote_options").select("*").order("sort", { ascending: true }).order("id", { ascending: true })),
      selectAll<{ option_id: string; round_id: string }>(() => sb.from("votes").select("option_id, round_id").order("created_at", { ascending: true }).order("id", { ascending: true })),
    ]);
    const countBy = new Map<string, number>();
    for (const v of votes) countBy.set(v.option_id, (countBy.get(v.option_id) ?? 0) + 1);
    options.sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    const withCounts = (r: VoteRound) => {
      const opts = options.filter((o) => o.round_id === r.id).map((o) => ({ ...o, count: countBy.get(o.id) ?? 0 }));
      return { ...r, options: opts, total: opts.reduce((a, o) => a + o.count, 0) };
    };
    const openRound = rounds.find((r) => r.status === "open") ?? null;
    const closedRounds = rounds.filter((r) => r.status === "closed").map(withCounts);
    const titleOf = new Map(rounds.map((r) => [r.id, r.title]));
    const released = options
      .filter((o) => o.released_at)
      .sort((a, b) => (b.released_at ?? "").localeCompare(a.released_at ?? ""))
      .map((o) => ({ ...o, round_title: titleOf.get(o.round_id) ?? "" }));
    return { open: openRound ? withCounts(openRound) : null, released, closedRounds };
  } catch {
    return EMPTY;
  }
}

/** 최근 N일 안에 출시 표시된 후보 */
export function recentlyReleased(s: VoteSummary, now = new Date(), days = 21) {
  const since = now.getTime() - days * 86400_000;
  return s.released.filter((o) => o.released_at && new Date(o.released_at).getTime() >= since);
}

export interface CastInput { roundId: string; optionIds: string[]; other?: string; ref?: string }

/** 투표 저장. 열린 라운드의 후보만 인정. 기타 입력은 suggestions 로 */
export async function castVote(input: CastInput): Promise<{ ok: true; voted: number; suggested: boolean } | { ok: false; error: string }> {
  const sb = supabaseAdmin();
  const { data: round } = await sb.from("vote_rounds").select("id, status").eq("id", input.roundId).maybeSingle();
  if (!round || (round as { status: string }).status !== "open") return { ok: false, error: "진행 중인 투표가 아닙니다." };
  const { data: opts } = await sb.from("vote_options").select("id").eq("round_id", input.roundId);
  const valid = new Set(((opts ?? []) as { id: string }[]).map((o) => o.id));
  const chosen = [...new Set(input.optionIds)].filter((id) => valid.has(id)).slice(0, 8);
  const other = (input.other ?? "").trim().slice(0, 1000);
  if (chosen.length === 0 && !other) return { ok: false, error: "후보를 고르거나 의견을 적어 주세요." };
  const ref = input.ref?.trim() || null;
  if (chosen.length) {
    const { error } = await sb.from("votes").insert(chosen.map((option_id) => ({ round_id: input.roundId, option_id, ref, created_at: new Date().toISOString() })));
    if (error) return { ok: false, error: "저장 중 오류가 발생했습니다." };
  }
  if (other) {
    const { error } = await sb.from("suggestions").insert({ round_id: input.roundId, message: other, ref, created_at: new Date().toISOString() });
    if (error) return { ok: false, error: "저장 중 오류가 발생했습니다." };
  }
  return { ok: true, voted: chosen.length, suggested: !!other };
}

export async function listSuggestions(limit = 200): Promise<SuggestionRow[]> {
  try {
    const { data, error } = await supabaseAdmin().from("suggestions").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) return [];
    return (data ?? []) as SuggestionRow[];
  } catch {
    return [];
  }
}

// ── 운영자 작업 ─────────────────────────────────────────────
export async function createRound(title: string, optionLines: string[]): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin();
  const t = title.trim().slice(0, 120);
  const opts = optionLines.map((l) => l.trim()).filter(Boolean).slice(0, 12);
  if (!t) return { ok: false, error: "라운드 제목을 입력하세요." };
  if (opts.length < 2) return { ok: false, error: "후보를 2개 이상 입력하세요 (한 줄에 하나, '제목 | 설명' 형식)." };
  const { data: openRound } = await sb.from("vote_rounds").select("id").eq("status", "open").maybeSingle();
  if (openRound) return { ok: false, error: "진행 중인 라운드가 있습니다. 먼저 마감하세요." };
  const { data: r, error } = await sb.from("vote_rounds").insert({ title: t, status: "open", show_results: false, opened_at: new Date().toISOString() }).select("id").maybeSingle();
  if (error || !r) return { ok: false, error: error?.message ?? "라운드 생성 실패" };
  const rows = opts.map((l, i) => { const [label, ...rest] = l.split("|"); return { round_id: (r as { id: string }).id, label: label.trim().slice(0, 80), description: rest.join("|").trim().slice(0, 200) || null, sort: i + 1 }; });
  const { error: e2 } = await sb.from("vote_options").insert(rows);
  if (e2) return { ok: false, error: e2.message };
  return { ok: true };
}

export async function closeRound(roundId: string, releaseNote: string) {
  const { error } = await supabaseAdmin().from("vote_rounds").update({ status: "closed", closed_at: new Date().toISOString(), release_note: releaseNote.trim().slice(0, 500) || null }).eq("id", roundId);
  return { ok: !error, error: error?.message };
}

export async function toggleResults(roundId: string, show: boolean) {
  const { error } = await supabaseAdmin().from("vote_rounds").update({ show_results: show }).eq("id", roundId);
  return { ok: !error, error: error?.message };
}

export async function markReleased(optionId: string, released: boolean) {
  const { error } = await supabaseAdmin().from("vote_options").update({ released_at: released ? new Date().toISOString() : null }).eq("id", optionId);
  return { ok: !error, error: error?.message };
}

export async function deleteSuggestion(id: string) {
  const { error } = await supabaseAdmin().from("suggestions").delete().eq("id", id);
  return { ok: !error, error: error?.message };
}
