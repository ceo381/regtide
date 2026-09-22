"use client";
import { Fragment, useState } from "react";

export interface ChannelView {
  code: string;
  name: string | null; // 등록되지 않은 채널(ref 만 있는 경우)은 null
  kind: string | null;
  audienceSize: number | null;
  postedAtLocal: string; // datetime-local 값(KST) 또는 ""
  notes: string;
  total: number;
  active: number;
  companyDomains: number;
  personal: number;
  last24h: number;
  last7d: number;
  firstAt: string;
  lastAt: string;
  convertMedian: string;
  quickRate: string;
  productsPerSub: string;
  highRiskShare: string;
  conversionRate: string;
  sincePost: string;
  within24h: string;
  within72h: string;
}

const KINDS = ["오픈채팅", "협회·조합", "교육기관", "매체", "링크드인", "커뮤니티", "파트너", "메일전달", "기타"];

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="copy">
      <code>{url}</code>
      <button type="button" className="btn ghost small" onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* ignore */ } }}>
        {done ? "복사됨" : "복사"}
      </button>
    </span>
  );
}

function ChannelForm({ site, initial, onClose }: { site: string; initial?: Partial<ChannelView>; onClose?: () => void }) {
  const editing = !!initial?.code;
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  return (
    <form method="post" action="/api/admin/run" className="channel-form">
      <input type="hidden" name="action" value="channel_save" />
      <input type="hidden" name="tab" value="channels" />
      <div className="grid2">
        <label>채널 이름 <span className="req">*</span>
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 카카오 오픈채팅 ‘의료기기 인허가 실무’" required maxLength={80} />
        </label>
        <label>코드 (링크의 ?ref= 값) <span className="req">*</span>
          <input name="code" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))} placeholder="예) openchat2" required pattern="[a-z0-9][a-z0-9_-]{0,39}" readOnly={editing} title="영문 소문자·숫자·_·- 만" />
        </label>
        <label>종류
          <select name="kind" defaultValue={initial?.kind ?? "오픈채팅"}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <label>대상 인원 (전환율 계산용)
          <input name="audience_size" type="number" min={0} defaultValue={initial?.audienceSize ?? ""} placeholder="예) 1632" />
        </label>
        <label>게시 일시 (KST)
          <input name="posted_at" type="datetime-local" defaultValue={initial?.postedAtLocal ?? ""} />
        </label>
        <label className="span2">메모 (게시 문구·담당자·특이사항)
          <textarea name="notes" defaultValue={initial?.notes ?? ""} rows={2} maxLength={2000} />
        </label>
      </div>
      {code && <p className="sub" style={{ margin: "8px 0" }}>안내 링크: <CopyLink url={`${site}/?ref=${code}`} /></p>}
      <div className="row">
        <button className="btn primary">{editing ? "수정 저장" : "채널 만들기"}</button>
        {onClose && <button type="button" className="btn ghost" onClick={onClose}>취소</button>}
      </div>
    </form>
  );
}

export default function ChannelManager({ site, channels, daily }: { site: string; channels: ChannelView[]; daily: { day: string; counts: Record<string, number> }[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const keys = channels.map((c) => c.code);
  const isPseudo = (code: string) => code.startsWith("("); // "(직접/미상)" — ref 없이 온 구독자 묶음. 링크·편집 없음

  return (
    <>
      <section className="card">
        <div className="row between">
          <div>
            <h2>채널 태그</h2>
            <p className="sub" style={{ margin: 0 }}>채널을 만들면 전용 링크가 생깁니다. 그 링크로 처음 접속한 사람의 구독이 이 채널로 집계됩니다(최초 유입 기준).</p>
          </div>
          {!creating && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ 새 채널</button>}
        </div>
        {creating && <ChannelForm site={site} onClose={() => setCreating(false)} />}
      </section>

      <section className="card">
        <h2>채널별 추적</h2>
        <p className="sub">전환율 = 구독자 ÷ 대상 인원 · 게시 후 = 게시 일시 이후 경과, 24h/72h 는 그 시간 안에 들어온 구독자 · 전환 소요 = 링크 접속 → 구독 완료 중앙값, 즉시 = 10분 내 구독 비율.</p>
        <div className="table-wrap">
          <table className="admin-table compact">
            <thead>
              <tr>
                <th>채널</th>
                <th>종류</th>
                <th className="num">구독자</th>
                <th className="num">전환율</th>
                <th className="num">게시 후</th>
                <th className="num">회사 / 개인</th>
                <th className="num">24시간 · 7일</th>
                <th className="num">전환 소요</th>
                <th className="num">3·4등급</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <Fragment key={c.code}>
                  <tr className={c.total === 0 ? "inactive" : ""}>
                    <td>
                      <strong>{c.name ?? c.code}</strong>
                      <span className="cell-sub">
                        {isPseudo(c.code) ? "ref 없이 접속" : <><code>{c.code}</code>{c.name == null && <span className="tag-warn"> 미등록</span>}</>}
                      </span>
                    </td>
                    <td>{c.kind ?? "—"}</td>
                    <td className="num"><strong>{c.total}</strong><span className="cell-sub">활성 {c.active}</span></td>
                    <td className="num">{c.conversionRate}<span className="cell-sub">{c.audienceSize != null ? `대상 ${c.audienceSize.toLocaleString()}` : "대상 미입력"}</span></td>
                    <td className="num">{c.sincePost}<span className="cell-sub">24h {c.within24h} · 72h {c.within72h}</span></td>
                    <td className="num">{c.companyDomains} / {c.personal}</td>
                    <td className="num">{c.last24h} · {c.last7d}</td>
                    <td className="num">{c.convertMedian}<span className="cell-sub">즉시 {c.quickRate}</span></td>
                    <td className="num">{c.highRiskShare}<span className="cell-sub">품목/인 {c.productsPerSub}</span></td>
                    <td className="actions">
                      {!isPseudo(c.code) && (
                        <>
                          <button type="button" className="btn ghost small" onClick={() => setOpen(open === c.code ? null : c.code)}>{open === c.code ? "닫기" : "상세"}</button>
                          <button type="button" className="btn ghost small" onClick={() => setEditing(editing === c.code ? null : c.code)}>{c.name == null ? "등록" : "수정"}</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {open === c.code && (
                    <tr>
                      <td colSpan={10} className="detail">
                        <div className="grid2">
                          <div>
                            <div><strong>안내 링크</strong> <CopyLink url={`${site}/?ref=${c.code}`} /></div>
                            <div>첫 구독 {c.firstAt} · 마지막 구독 {c.lastAt}</div>
                            <div>품목/인 {c.productsPerSub} · 대상 인원 {c.audienceSize ?? "—"} · 게시 {c.postedAtLocal ? c.postedAtLocal.replace("T", " ") : "—"}</div>
                          </div>
                          <div>
                            <div><strong>메모</strong></div>
                            <div style={{ whiteSpace: "pre-wrap" }}>{c.notes || "—"}</div>
                          </div>
                        </div>
                        <form method="post" action="/api/admin/run" onSubmit={(e) => { if (!confirm(`채널 등록 "${c.code}" 을 삭제할까요? 구독자의 채널 값은 그대로 남습니다.`)) e.preventDefault(); }} style={{ marginTop: 8 }}>
                          <input type="hidden" name="action" value="channel_delete" /><input type="hidden" name="code" value={c.code} /><input type="hidden" name="tab" value="channels" />
                          {c.name != null && <button className="btn danger small">등록 삭제</button>}
                        </form>
                      </td>
                    </tr>
                  )}
                  {editing === c.code && (
                    <tr>
                      <td colSpan={10} className="detail">
                        <ChannelForm site={site} initial={c.name == null ? { code: c.code } : c} onClose={() => setEditing(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>최근 14일 채널별 신규 구독 (일별)</h2>
        <div className="table-wrap">
          <table className="admin-table compact">
            <thead><tr><th>날짜</th>{keys.map((k) => { const n = channels.find((c) => c.code === k)?.name ?? k; return <th key={k} className="num" title={n}>{n.length > 14 ? `${n.slice(0, 14)}…` : n}<span className="cell-sub" style={{ fontWeight: 400 }}>{isPseudo(k) ? "" : k}</span></th>; })}<th className="num">합계</th></tr></thead>
            <tbody>
              {daily.map((row) => {
                const sum = keys.reduce((a, k) => a + (row.counts[k] || 0), 0);
                return (
                  <tr key={row.day} className={sum === 0 ? "inactive" : ""}>
                    <td>{row.day.slice(5)}</td>
                    {keys.map((k) => <td key={k} className="num">{row.counts[k] || ""}</td>)}
                    <td className="num"><strong>{sum || ""}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
