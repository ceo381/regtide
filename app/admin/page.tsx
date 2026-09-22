import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { loadDashboard } from "@/lib/admin-data";
import { CATALOG_BY_ID, JURISDICTION_LABEL, type Jurisdiction } from "@/lib/catalog";
import { describeSource } from "@/lib/source-info";
import { ADMIN_EMAIL, MILESTONE_EVERY } from "@/lib/admin-report";
import AdminTabs from "./AdminTabs";
import SubscriberTable from "./SubscriberTable";

export const metadata = { title: "관리자 대시보드 · RegTide", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const fmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }) : "—");

const IMPACT: Record<string, string> = { high: "즉시 조치", medium: "검토 필요", low: "참고", none: "무관" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  const { msg } = await searchParams;

  const t0 = Date.now();
  const d = await loadDashboard();
  const loadMs = Date.now() - t0;
  const { stats } = d;
  const maxDay = Math.max(1, ...d.signupsByDay.map((x) => x.count));
  const nextMilestone = Math.ceil((stats.totalActive + 1) / MILESTONE_EVERY()) * MILESTONE_EVERY();
  const delCount = (st: string) => d.deliveriesThisWeek.filter((x) => x.status === st).length;

  const overview = (
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
          <table className="admin-table"><tbody>
            {stats.topCatalog.map((t) => <tr key={t.id}><td>{t.label}</td><td className="num">{t.count}명</td></tr>)}
          </tbody></table>
        </section>
        <section className="card">
          <h2>수집 소스 상태 (마지막 수집)</h2>
          {stats.lastCollect ? (
            <>
              <p className="sub">실행 {fmt(stats.lastCollect.ranAt)} · 가져옴 {stats.lastCollect.fetched} · 신규 {stats.lastCollect.inserted}</p>
              <table className="admin-table"><tbody>
                {Object.entries(stats.lastCollect.bySource ?? {}).sort((a, b) => a[1] - b[1]).map(([k, n]) => {
                  const si = describeSource(k);
                  return <tr key={k}><td>{si.agency} · {si.name || k}</td><td className={`num${n === 0 ? " warn" : ""}`}>{n}</td></tr>;
                })}
              </tbody></table>
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
  );

  const subscribers = (
    <section className="card">
      <SubscriberTable
        rows={d.subscribers.map((s) => ({
          id: s.id,
          email: s.email,
          productsLabel: s.products.map((p) => `${p.name} (${p.category})`).join(", "),
          productSearch: s.products.map((p) => p.name).join(" ").toLowerCase(),
          catalogCount: s.catalog_ids.length,
          createdLabel: fmtDay(s.created_at),
          lastSentLabel: fmtDay(s.last_sent_at),
          active: s.active,
        }))}
      />
    </section>
  );

  const updates = (
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
  );

  const deliveries = (
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
  );

  const ops = (
    <section className="card">
      <h2>운영 작업</h2>
      <p className="sub">구독자 전체 발송은 여기서 할 수 없습니다(월요일 크론 전용). 테스트 발송은 운영자({ADMIN_EMAIL()})에게만 갑니다. 수집·분류는 10~40초 걸릴 수 있습니다.</p>
      <div className="ops-grid">
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="collect" /><input type="hidden" name="tab" value="ops" /><button className="btn">수집 실행</button><p>지난 8일치 소스를 모두 가져와 새 항목만 저장합니다. 메일 발송 없음.</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="classify" /><input type="hidden" name="tab" value="ops" /><button className="btn">분류 실행</button><p>미분류 항목에 영향도·규격 매칭을 부여합니다. 메일 발송 없음.</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="testsend" /><input type="hidden" name="tab" value="ops" /><button className="btn">테스트 다이제스트 → 운영자</button><p>최근 8일 항목으로 전체 규격 기준 미리보기 메일을 운영자에게 1통 보냅니다.</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="dailyreport" /><input type="hidden" name="tab" value="ops" /><button className="btn">운영 리포트 지금 발송</button><p>내일 아침에 올 일일 리포트를 지금 받아봅니다.</p></form>
      </div>
    </section>
  );

  return (
    <main className="admin">
      <header className="admin-header">
        <div>
          <p className="eyebrow">RegTide 관리자</p>
          <h1>대시보드</h1>
        </div>
        <div className="admin-header-right">
          <span className="admin-user">{session.user} · 로드 {loadMs}ms</span>
          <a href="/admin" className="btn ghost">새로고침</a>
          <a href="/" target="_blank" className="btn ghost">사이트 보기</a>
          <form method="post" action="/api/admin/logout"><button className="btn ghost">로그아웃</button></form>
        </div>
      </header>

      {msg && <div className="admin-flash">{msg}</div>}

      <section className={`health ${d.health.counts.critical ? "crit" : d.health.counts.warning ? "warn" : "ok"}`}>
        <div className="health-head">
          <h2>
            {d.health.counts.critical ? `문제 ${d.health.counts.critical}건 — 즉시 조치 필요` : d.health.counts.warning ? `확인 필요 ${d.health.counts.warning}건` : "상태 정상"}
          </h2>
          <span className="sub">수집 누락 · 면책 고지 · 발송 · 설정 점검 · {fmt(d.health.checkedAt)}{d.health.counts.info ? ` · 참고 ${d.health.counts.info}건` : ""}</span>
        </div>
        {d.health.issues.length > 0 && (
          <ul className="health-list">
            {d.health.issues.map((i, k) => (
              <li key={k} className={`health-item ${i.level}`}>
                <span className="health-badge">{i.level === "critical" ? "즉시" : i.level === "warning" ? "확인" : "참고"}</span>
                <span className="health-area">{i.area}</span>
                <div>
                  <strong>{i.title}</strong>
                  <div className="health-detail">{i.detail}</div>
                  {i.action && <div className="health-action">→ {i.action}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="admin-kpis">
        <div className="kpi"><span>활성 구독자</span><strong>{stats.totalActive}</strong><small>다음 마일스톤 {nextMilestone}명</small></div>
        <div className="kpi"><span>24시간 신규</span><strong>{stats.newSubscribers.length}</strong><small>최근 14일 합계 {d.signupsByDay.reduce((a, b) => a + b.count, 0)}</small></div>
        <div className="kpi"><span>회사 도메인</span><strong>{stats.companyDomains}</strong><small>개인 메일 {stats.personalMailCount}명</small></div>
        <div className="kpi"><span>같은 회사 2명+</span><strong>{stats.multiSeatDomains.length}</strong><small>{stats.multiSeatDomains.length ? stats.multiSeatDomains.slice(0, 3).map((x) => `${x.domain} ${x.count}`).join(" · ") : "조직 확산 지표"}</small></div>
        <div className="kpi"><span>이번 주 발송 ({d.weekStart})</span><strong>{delCount("sent")}</strong><small>실패 {delCount("failed")} · 해당없음 {delCount("skipped_empty")}</small></div>
      </section>

      <AdminTabs
        tabs={[
          { id: "overview", label: "개요", content: overview },
          { id: "subscribers", label: `구독자 (${d.subscribers.length})`, content: subscribers },
          { id: "updates", label: "수집 항목", content: updates },
          { id: "deliveries", label: "발송 기록", content: deliveries },
          { id: "ops", label: "운영 작업", content: ops },
        ]}
      />
    </main>
  );
}
