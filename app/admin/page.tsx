import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { loadDashboard } from "@/lib/admin-data";
import { CATALOG_BY_ID, JURISDICTION_LABEL, type Jurisdiction } from "@/lib/catalog";
import { describeSource } from "@/lib/source-info";
import { ADMIN_EMAIL, MILESTONE_EVERY } from "@/lib/admin-report";

export const metadata = { title: "관리자 대시보드 · RegTide", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }) : "—");

const IMPACT: Record<string, string> = { high: "즉시 조치", medium: "검토 필요", low: "참고", none: "무관" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ msg?: string; q?: string; tab?: string }> }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  const { msg, q = "", tab = "overview" } = await searchParams;

  const d = await loadDashboard();
  const { stats } = d;
  const query = q.trim().toLowerCase();
  const subs = query
    ? d.subscribers.filter((s) => s.email.toLowerCase().includes(query) || s.products.some((p) => p.name.toLowerCase().includes(query)))
    : d.subscribers;
  const maxDay = Math.max(1, ...d.signupsByDay.map((x) => x.count));
  const nextMilestone = Math.ceil((stats.totalActive + 1) / MILESTONE_EVERY()) * MILESTONE_EVERY();
  const delCount = (st: string) => d.deliveriesThisWeek.filter((x) => x.status === st).length;

  const Tab = ({ id, label }: { id: string; label: string }) => (
    <a href={`/admin?tab=${id}`} className={`admin-tab${tab === id ? " active" : ""}`}>{label}</a>
  );

  return (
    <main className="admin">
      <header className="admin-header">
        <div>
          <p className="eyebrow">RegTide 관리자</p>
          <h1>대시보드</h1>
        </div>
        <div className="admin-header-right">
          <span className="admin-user">{session.user}</span>
          <a href="/" target="_blank" className="btn ghost">사이트 보기</a>
          <form method="post" action="/api/admin/logout"><button className="btn ghost">로그아웃</button></form>
        </div>
      </header>

      {msg && <div className="admin-flash">{msg}</div>}

      <section className="admin-kpis">
        <div className="kpi"><span>활성 구독자</span><strong>{stats.totalActive}</strong><small>다음 마일스톤 {nextMilestone}명</small></div>
        <div className="kpi"><span>24시간 신규</span><strong>{stats.newSubscribers.length}</strong><small>최근 14일 합계 {d.signupsByDay.reduce((a, b) => a + b.count, 0)}</small></div>
        <div className="kpi"><span>회사 도메인</span><strong>{stats.companyDomains}</strong><small>개인 메일 {stats.personalMailCount}명</small></div>
        <div className="kpi"><span>같은 회사 2명+</span><strong>{stats.multiSeatDomains.length}</strong><small>{stats.multiSeatDomains.length ? stats.multiSeatDomains.slice(0, 3).map((x) => `${x.domain} ${x.count}`).join(" · ") : "조직 확산 지표"}</small></div>
        <div className="kpi"><span>이번 주 발송 ({d.weekStart})</span><strong>{delCount("sent")}</strong><small>실패 {delCount("failed")} · 해당없음 {delCount("skipped_empty")}</small></div>
      </section>

      <nav className="admin-tabs">
        <Tab id="overview" label="개요" />
        <Tab id="subscribers" label={`구독자 (${d.subscribers.length})`} />
        <Tab id="updates" label="수집 항목" />
        <Tab id="deliveries" label="발송 기록" />
        <Tab id="ops" label="운영 작업" />
      </nav>

      {tab === "overview" && (
        <>
          <section className="card">
            <h2>최근 14일 신규 구독</h2>
            <div className="bars" role="img" aria-label="일별 신규 구독자 수">
              {d.signupsByDay.map((x) => (
                <div key={x.day} className="bar-col" title={`${x.day}: ${x.count}명`}>
                  <div className="bar" style={{ height: `${Math.round((x.count / maxDay) * 100)}%` }} />
                  <span className="bar-n">{x.count || ""}</span>
                  <span className="bar-d">{x.day.slice(5)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="admin-grid">
            <section className="card">
              <h2>많이 선택된 규격·인증</h2>
              <table className="admin-table">
                <tbody>
                  {stats.topCatalog.map((t) => (
                    <tr key={t.id}><td>{t.label}</td><td className="num">{t.count}명</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card">
              <h2>수집 소스 상태 (마지막 수집)</h2>
              {stats.lastCollect ? (
                <>
                  <p className="sub">실행 {fmt(stats.lastCollect.ranAt)} · 가져옴 {stats.lastCollect.fetched} · 신규 {stats.lastCollect.inserted}</p>
                  <table className="admin-table">
                    <tbody>
                      {Object.entries(stats.lastCollect.bySource ?? {}).sort((a, b) => a[1] - b[1]).map(([k, n]) => {
                        const si = describeSource(k);
                        return <tr key={k}><td>{si.agency} · {si.name || k}</td><td className={`num${n === 0 ? " warn" : ""}`}>{n}</td></tr>;
                      })}
                    </tbody>
                  </table>
                  {(stats.lastCollect.skipped?.length || stats.lastCollect.errors?.length) ? (
                    <ul className="admin-issues">
                      {stats.lastCollect.skipped?.map((x, i) => <li key={`s${i}`}>건너뜀: {x.source} — {x.reason}</li>)}
                      {stats.lastCollect.errors?.map((x, i) => <li key={`e${i}`} className="err">오류: {x.source} — {x.error}</li>)}
                    </ul>
                  ) : null}
                </>
              ) : <p className="sub">수집 기록 없음</p>}
            </section>
          </div>
        </>
      )}

      {tab === "subscribers" && (
        <section className="card">
          <form method="get" action="/admin" className="admin-search">
            <input type="hidden" name="tab" value="subscribers" />
            <input name="q" defaultValue={q} placeholder="이메일 또는 품목명 검색" />
            <button className="btn">검색</button>
            {q && <a href="/admin?tab=subscribers" className="btn ghost">초기화</a>}
          </form>
          <p className="sub">{subs.length}명 표시 · 비활성화하면 발송 대상에서 제외되고, 삭제하면 이메일이 즉시 삭제됩니다(구독해지와 동일).</p>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>이메일</th><th>품목</th><th>규격</th><th>가입</th><th>마지막 발송</th><th>상태</th><th></th></tr></thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id} className={s.active ? "" : "inactive"}>
                    <td>{s.email}</td>
                    <td>{s.products.map((p) => `${p.name} (${p.category})`).join(", ") || "—"}</td>
                    <td className="num">{s.catalog_ids.length}</td>
                    <td>{fmtDay(s.created_at)}</td>
                    <td>{fmtDay(s.last_sent_at)}</td>
                    <td>{s.active ? "활성" : "비활성"}</td>
                    <td className="actions">
                      {s.active && (
                        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="deactivate" /><input type="hidden" name="id" value={s.id} /><button className="btn ghost small">비활성화</button></form>
                      )}
                      <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="delete" /><input type="hidden" name="id" value={s.id} /><button className="btn danger small">삭제</button></form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "updates" && (
        <section className="card">
          <h2>최근 수집 항목 (60건)</h2>
          <p className="sub">"무관"은 분류 규칙이 구독자 규격과 관련 없다고 판단한 항목입니다. 관련 있는데 무관으로 빠진 것이 보이면 카탈로그 키워드 보강 대상입니다.</p>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>수집</th><th>발표</th><th>관할</th><th>영향도</th><th>제목</th><th>출처</th><th>매칭 규격</th></tr></thead>
              <tbody>
                {d.recentUpdates.map((u) => {
                  const si = describeSource(u.source);
                  return (
                    <tr key={u.id} className={u.impact === "none" ? "inactive" : ""}>
                      <td>{fmtDay(u.created_at)}</td>
                      <td>{fmtDay(u.published_at)}</td>
                      <td>{JURISDICTION_LABEL[u.jurisdiction as Jurisdiction]?.split(" ")[0] ?? u.jurisdiction}</td>
                      <td><span className={`impact ${u.impact ?? "pending"}`}>{u.impact ? IMPACT[u.impact] : "미분류"}</span></td>
                      <td><a href={u.url ?? "#"} target="_blank" rel="noreferrer">{u.title}</a></td>
                      <td>{si.name || si.agency}</td>
                      <td>{u.catalog_ids.map((id) => CATALOG_BY_ID[id]?.label ?? id).join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "deliveries" && (
        <section className="card">
          <h2>이번 주 발송 기록 ({d.weekStart} 주)</h2>
          <p className="sub">sent 성공 · failed 실패(다음 크론에서 자동 재시도) · skipped_empty 해당 항목 없음</p>
          {d.deliveriesThisWeek.length === 0 ? <p className="sub">아직 발송 기록이 없습니다. 월요일 09:00 KST 크론 이후 채워집니다.</p> : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th>시각</th><th>이메일</th><th>상태</th><th>항목 수</th><th>오류</th></tr></thead>
                <tbody>
                  {d.deliveriesThisWeek.map((x, i) => (
                    <tr key={i}><td>{fmt(x.sent_at)}</td><td>{x.email}</td><td><span className={`status ${x.status}`}>{x.status}</span></td><td className="num">{x.update_count}</td><td className="err">{x.error ?? ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "ops" && (
        <section className="card">
          <h2>운영 작업</h2>
          <p className="sub">구독자 전체 발송은 여기서 할 수 없습니다(월요일 크론 전용). 테스트 발송은 운영자({ADMIN_EMAIL()})에게만 갑니다.</p>
          <div className="ops-grid">
            <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="collect" /><button className="btn">수집 실행</button><p>지난 8일치 소스를 모두 가져와 새 항목만 저장합니다. 메일 발송 없음.</p></form>
            <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="classify" /><button className="btn">분류 실행</button><p>미분류 항목에 영향도·규격 매칭을 부여합니다. 메일 발송 없음.</p></form>
            <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="testsend" /><button className="btn">테스트 다이제스트 → 운영자</button><p>최근 8일 항목으로 전체 규격 기준 미리보기 메일을 운영자에게 1통 보냅니다.</p></form>
            <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="dailyreport" /><button className="btn">운영 리포트 지금 발송</button><p>내일 아침에 올 일일 리포트를 지금 받아봅니다.</p></form>
          </div>
        </section>
      )}
    </main>
  );
}
