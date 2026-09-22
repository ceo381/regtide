"use client";
import { useEffect, useState } from "react";

interface OpenRound { id: string; title: string; show_results: boolean; total: number | null; options: { id: string; label: string; description: string | null; count: number | null }[] }

/**
 * 기능 투표 상자 — 구독자 전용 (/vote 페이지에서만 사용). auth = 메일 링크의 s·t.
 * mine 이 비어 있지 않으면 이미 참여한 라운드 → 선택 결과만 보여주고 잠근다.
 */
export default function VoteBox({ title, sub, auth, mine }: { title: string; sub: string; auth: { s: string; t: string }; mine: string[] }) {
  const [round, setRound] = useState<OpenRound | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<string[]>(mine);
  const locked = mine.length > 0;
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vote?s=${encodeURIComponent(auth.s)}&t=${encodeURIComponent(auth.t)}`).then((r) => r.json()).then((j) => setRound(j.open ?? null)).catch(() => {}).finally(() => setLoaded(true));
  }, [auth.s, auth.t]);

  if (!loaded || !round) return null;

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const submit = async () => {
    setErr(null);
    if (chosen.length === 0 && !other.trim()) return setErr("후보를 고르거나 의견을 적어 주세요.");
    setBusy(true);
    try {
      let ref = "";
      try { ref = (JSON.parse(localStorage.getItem("regtide_ref") ?? "null") as { ref?: string } | null)?.ref ?? ""; } catch { /* ignore */ }
      const res = await fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId: round.id, optionIds: chosen, other, ref, s: auth.s, t: auth.t }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "오류가 발생했습니다.");
      setDone(`감사합니다. ${j.voted ? `${j.voted}개 후보에 표를 주셨습니다.` : ""}${j.suggested ? " 의견도 잘 받았습니다." : ""} 결과는 다음 기능이 열릴 때 주간 리포트로 알려드립니다.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vote" id="vote">
      <h3>{title}</h3>
      <p className="sub">{sub}</p>
      {done ? (
        <div className="notice ok">{done}</div>
      ) : (
        <>
          <ul className="vote-options">
            {round.options.map((o) => (
              <li key={o.id}>
                <label>
                  <input type="checkbox" checked={chosen.includes(o.id)} onChange={() => !locked && toggle(o.id)} disabled={locked} />
                  <span className="vo-text"><strong>{o.label}</strong>{o.description && <span>{o.description}</span>}</span>
                  {round.show_results && o.count != null && <span className="vo-count">{o.count}표</span>}
                </label>
              </li>
            ))}
          </ul>
          {!locked && (
            <>
              <label className="vote-other">
                <span>목록에 없는 기능이 필요하다면 적어 주세요 (선택). 이름·연락처 등 개인정보는 적지 마세요.</span>
                <textarea value={other} onChange={(e) => setOther(e.target.value)} maxLength={1000} rows={2} />
              </label>
              <div className="row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "보내는 중…" : "투표하기"}</button>
                <span className="sub" style={{ margin: 0 }}>라운드당 1회 · 구독자 전용</span>
              </div>
            </>
          )}
          {err && <div className="notice err">{err}</div>}
        </>
      )}
    </div>
  );
}
