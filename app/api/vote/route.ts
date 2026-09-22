import { NextRequest, NextResponse } from "next/server";
import { castVote, loadVoteSummary, myVotes } from "@/lib/votes";
import { verifyVoteToken } from "@/lib/vote-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  — 현재 열린 라운드와 후보 (득표는 show_results 일 때만). ?s=&t= 가 유효하면 그 구독자의 참여 여부(mine)도 포함
 * POST — 투표 {roundId, optionIds[], other?, ref?, s, t}. 구독자 전용: s(구독자 id)+t(HMAC) 검증. IP 는 분당 제한에만 메모리로 쓰고 저장하지 않음
 */
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 5;
}

export async function GET(req: NextRequest) {
  const s = await loadVoteSummary();
  if (!s.open) return NextResponse.json({ open: null, released: s.released.map((o) => ({ label: o.label, released_at: o.released_at })) });
  const { id, title, show_results, total, options, participants } = s.open;
  const sid = req.nextUrl.searchParams.get("s") ?? "", tok = req.nextUrl.searchParams.get("t") ?? "";
  const verified = verifyVoteToken(sid, tok);
  const mine = verified ? await myVotes(id, sid) : null;
  return NextResponse.json({
    open: { id, title, show_results, participants, total: show_results ? total : null, options: options.map((o) => ({ id: o.id, label: o.label, description: o.description, count: show_results ? o.count : null })) },
    released: s.released.map((o) => ({ label: o.label, released_at: o.released_at })),
    verified,
    mine,
  });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { roundId?: unknown; optionIds?: unknown; other?: unknown; ref?: unknown; s?: unknown; t?: unknown } | null;
  const sid = typeof body?.s === "string" ? body.s.slice(0, 64) : "", tok = typeof body?.t === "string" ? body.t.slice(0, 64) : "";
  if (!verifyVoteToken(sid, tok)) return NextResponse.json({ error: "구독자 전용 링크가 아니거나 만료되었습니다. 확인 메일 또는 주간 리포트의 투표 링크로 들어와 주세요." }, { status: 401 });
  const roundId = typeof body?.roundId === "string" ? body.roundId.slice(0, 40) : "";
  const optionIds = Array.isArray(body?.optionIds) ? body!.optionIds.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  const other = typeof body?.other === "string" ? body.other : "";
  const ref = typeof body?.ref === "string" ? body.ref.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  if (!roundId) return NextResponse.json({ error: "라운드가 없습니다." }, { status: 400 });
  const r = await castVote({ roundId, optionIds, other, ref, subscriberId: sid });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
