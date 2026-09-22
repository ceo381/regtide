"use client";
import { useEffect, useState } from "react";

interface OpenRound { id: string; title: string; show_results: boolean; total: number | null; options: { id: string; label: string; description: string | null; count: number | null }[] }

/**
 * 기능 투표 상자 — 익명. 이메일·IP 저장 없음. 브라우저에 "이 라운드에 투표함" 표시만 남긴다(localStorage, 개인 식별 아님).
 * 라운드가 없거나(마이그레이션 전) 로딩 실패 시 조용히 빈 상태.
 */
export default function VoteBox({ title, sub }: { title: string; sub: string }) {
  const [round, setRound] = useState<OpenRound | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vote").then((r) => r.json()).then((j) => {
      setRound(j.open ?? null);
      try { if (j.open && localStorage.getItem(`regtide_voted_${j.open.id}`)) setDone("이미 이 라운드에 참여하셨습니다. 감사합니다."); } catch { /* ignore */ }
    }).catch(() => {}).finally(() => setLoaded(true));
  }, []);

  if (!loaded || !round) return null;

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const submit = async () => {
    setErr(null);
    if (chosen.length === 0 && !other.trim()) return setErr("후보를 고르거나 의견을 적어 주세요.");
    setBusy(true);
    try {
      let ref = "";
      try { ref = (JSON.parse(localStorage.getItem("regtide_ref") ?? "null") as { ref?: string } | null)?.ref ?? ""; } catch { /* ignore */ }
      const res = await fetch("/api/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId: round.id, optionIds: chosen, other, ref }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "오류가 발생했습니다.");
      try { localStorage.setItem(`regtide_voted_${round.id}`, "1"); } catch { /* ignore */ }
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
                  <input type="checkbox" checked={chosen.includes(o.id)} onChange={() => toggle(o.id)} />
                  <span className="vo-text"><strong>{o.label}</strong>{o.description && <span>{o.description}</span>}</span>
                  {round.show_results && o.count != null && <span className="vo-count">{o.count}표</span>}
                </label>
              </li>
            ))}
          </ul>
          <label className="vote-other">
            <span>목록에 없는 기능이 필요하다면 (선택) — 이름·연락처 등 개인정보는 적지 마세요</span>
            <textarea value={other} onChange={(e) => setOther(e.target.value)} maxLength={1000} rows={2} />
          </label>
          <div className="row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "보내는 중…" : "투표하기"}</button>
            <span className="sub" style={{ margin: 0 }}>익명 · 이메일 없이 참여</span>
          </div>
          {err && <div className="notice err">{err}</div>}
        </>
      )}
    </div>
  );
}
