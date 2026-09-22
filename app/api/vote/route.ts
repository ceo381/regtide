import { NextRequest, NextResponse } from "next/server";
import { castVote, loadVoteSummary } from "@/lib/votes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  — 현재 열린 라운드와 후보 (득표는 show_results 일 때만 포함)
 * POST — 투표 {roundId, optionIds[], other?, ref?}. 익명: IP 는 분당 제한에만 메모리로 쓰고 저장하지 않음
 */
const hits = new Map<string, { n: number; t: number }>();
function limited(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false; }
  h.n++;
  return h.n > 5;
}

export async function GET() {
  const s = await loadVoteSummary();
  if (!s.open) return NextResponse.json({ open: null, released: s.released.map((o) => ({ label: o.label, released_at: o.released_at })) });
  const { id, title, show_results, total, options } = s.open;
  return NextResponse.json({
    open: { id, title, show_results, total: show_results ? total : null, options: options.map((o) => ({ id: o.id, label: o.label, description: o.description, count: show_results ? o.count : null })) },
    released: s.released.map((o) => ({ label: o.label, released_at: o.released_at })),
  });
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (limited(ip)) return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }, { status: 429 });
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { roundId?: unknown; optionIds?: unknown; other?: unknown; ref?: unknown } | null;
  const roundId = typeof body?.roundId === "string" ? body.roundId.slice(0, 40) : "";
  const optionIds = Array.isArray(body?.optionIds) ? body!.optionIds.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  const other = typeof body?.other === "string" ? body.other : "";
  const ref = typeof body?.ref === "string" ? body.ref.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) : "";
  if (!roundId) return NextResponse.json({ error: "라운드가 없습니다." }, { status: 400 });
  const r = await castVote({ roundId, optionIds, other, ref });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json(r);
}
