import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { loadDashboard } from "@/lib/admin-data";
import { CATALOG_BY_ID, JURISDICTION_LABEL, productLabel, type Jurisdiction } from "@/lib/catalog";
import { describeSource } from "@/lib/source-info";
import { ADMIN_EMAIL, MILESTONE_EVERY } from "@/lib/admin-report";
import { TEST_RECIPIENTS_MAX, testRecipients } from "@/lib/test-recipients";
import AdminTabs from "./AdminTabs";
import { NO_REF } from "@/lib/admin-data";
import ChannelManager from "./ChannelManager";
import SubscriberTable from "./SubscriberTable";
import UpdatesTable from "./UpdatesTable";
import DeliveriesTable from "./DeliveriesTable";
import VotePanel from "./VotePanel";

export const metadata = { title: "관리자 대시보드", robots: { index: false, follow: false } };
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
  const [d, recipients] = await Promise.all([loadDashboard(), testRecipients().catch(() => [{ email: ADMIN_EMAIL(), source: "admin" as const }])]);
  const loadMs = Date.now() - t0;
  const { stats } = d;
  const maxDay = Math.max(1, ...d.signupsByDay.map((x) => x.count));
  const nextMilestone = Math.ceil((stats.totalActive + 1) / MILESTONE_EVERY()) * MILESTONE_EVERY();
  const delCount = (st: string) => d.deliveriesThisWeek.filter((x) => x.status === st).length;

  const overview = (
    <>
      <section className="card">
        <h2>최근 14일 신규 구독 · 유입</h2>
        <p className="sub">막대 = 신규 구독자, 아래 숫자 = 그날 유입(방문)</p>
        <div className="bars" role="img" aria-label="일별 신규 구독자 수와 유입 수">
          {d.signupsByDay.map((x, i) => (
            <div key={x.day} className="bar-col" title={`${x.day}: 구독 ${x.count}명 · 유입 ${d.visitsByDay[i]?.count ?? 0}`}>
              <div className="bar" style={{ height: `${Math.round((x.count / maxDay) * 100)}%` }} />
              <span className="bar-n">{x.count || ""}</span>
              <span className="bar-d">{x.day.slice(5)}</span>
              <span className="bar-v">{d.visits.available ? (d.visitsByDay[i]?.count || "·") : ""}</span>
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

  const churnCard = (
    <section className="card">
      <h2>최근 구독해지 {d.churn.available ? `(누적 ${d.churn.total}건)` : ""}</h2>
      <p className="sub">해지 시 이메일 등 식별 정보는 즉시 삭제되고 아래 통계만 남습니다. 구독 기간이 짧고 받은 리포트가 0~1건이면 "기대와 다름", 여러 건 받은 뒤 해지면 "내용 불만족" 신호로 보세요.</p>
      {!d.churn.available ? <p className="sub">unsubscribes 테이블 마이그레이션 후 집계됩니다.</p> : d.churn.recent.length === 0 ? <p className="sub">아직 해지가 없습니다.</p> : (
        <div className="table-wrap">
          <table className="admin-table compact">
            <thead><tr><th>해지 시각</th><th>구분</th><th>채널</th><th className="num">구독 기간</th><th className="num">받은 리포트</th><th className="num">규격 수</th><th>품목 유형</th><th>메일</th></tr></thead>
            <tbody>
              {d.churn.recent.map((u, i) => (
                <tr key={i}>
                  <td>{fmt(u.unsubscribed_at)}</td>
                  <td>{u.reason === "admin" ? "운영자 삭제" : "본인 해지"}</td>
                  <td>{u.ref ?? NO_REF}</td>
                  <td className="num">{u.tenure_days == null ? "—" : `${u.tenure_days}일`}</td>
                  <td className="num">{u.deliveries_received ?? "—"}</td>
                  <td className="num">{u.catalog_count ?? "—"}</td>
                  <td>{u.categories?.join(", ") || "—"}</td>
                  <td>{u.mail_type === "company" ? "회사" : u.mail_type === "personal" ? "개인" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const subscribers = (
    <>
    {churnCard}
    <section className="card">
      <SubscriberTable
        rows={d.subscribers.map((s) => ({
          id: s.id,
          email: s.email,
          productsLabel: s.products.map((p, i) => (p.name?.trim() ? `${p.name} (${p.category})` : productLabel(p, i))).join(", "),
          productSearch: s.products.map((p) => `${p.name ?? ""} ${p.category}`).join(" ").toLowerCase(),
          catalogCount: s.catalog_ids.length,
          ref: s.ref ?? "",
          createdLabel: fmtDay(s.created_at),
          lastSentLabel: fmtDay(s.last_sent_at),
          createdAt: s.created_at ?? null,
          lastSentAt: s.last_sent_at ?? null,
          active: s.active,
        }))}
      />
    </section>
    </>
  );

  const updates = (
    <section className="card">
      <h2>최근 수집 항목 (60건)</h2>
      <p className="sub">"무관"은 분류 규칙이 구독자 규격과 관련 없다고 판단한 항목입니다. 관련 있는데 무관으로 빠진 것이 보이면 카탈로그 키워드 보강 대상입니다.</p>
      <UpdatesTable
        rows={d.recentUpdates.map((u) => {
          const si = describeSource(u.source);
          return {
            id: u.id,
            createdAt: u.created_at ?? null,
            publishedAt: u.published_at ?? null,
            createdLabel: fmtDay(u.created_at),
            publishedLabel: fmtDay(u.published_at),
            jurisdiction: JURISDICTION_LABEL[u.jurisdiction as Jurisdiction]?.split(" ")[0] ?? u.jurisdiction,
            impact: u.impact ?? null,
            impactLabel: u.impact ? IMPACT[u.impact] : "미분류",
            title: u.title,
            url: u.url ?? "",
            sourceLabel: si.name || si.agency,
            catalogLabel: u.catalog_ids.map((id) => CATALOG_BY_ID[id]?.label ?? id).join(", "),
          };
        })}
      />
    </section>
  );

  const deliveries = (
    <section className="card">
      <h2>이번 주 발송 기록 ({d.weekStart} 주)</h2>
      <p className="sub">sent 성공 · failed 실패(다음 크론에서 자동 재시도) · skipped_empty 해당 항목 없음</p>
      {d.deliveriesThisWeek.length === 0 ? <p className="sub">아직 발송 기록이 없습니다. 월요일 09:00 KST 크론 이후 채워집니다.</p> : (
        <DeliveriesTable rows={d.deliveriesThisWeek.map((x, i) => ({ key: `${x.sent_at}-${i}`, sentAt: x.sent_at, sentLabel: fmt(x.sent_at), email: x.email, status: x.status, updateCount: x.update_count, error: x.error ?? "" }))} />
      )}
    </section>
  );

  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);
  const mins = (m: number | null) => (m == null ? "—" : m < 1 ? "1분 미만" : m < 60 ? `${Math.round(m)}분` : m < 1440 ? `${(m / 60).toFixed(1)}시간` : `${(m / 1440).toFixed(1)}일`);
  const hours = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}분` : h < 48 ? `${h.toFixed(1)}시간` : `${(h / 24).toFixed(1)}일`);
  const toLocal = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16) : "");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const channels = (
    <ChannelManager
      site={site}
      daily={d.channelDaily}
      visitsByDay={d.visitsByDay}
      visitsAvailable={d.visits.available}
      churnByDay={d.churnByDay}
      churnAvailable={d.churn.available}
      totalBefore={d.subscribers.length - d.signupsByDay.reduce((a, b) => a + b.count, 0)}
      channels={d.channels.map((c) => ({
        code: c.ref,
        name: c.registry?.name ?? (c.ref === NO_REF ? NO_REF : null),
        kind: c.registry?.kind ?? null,
        audienceSize: c.registry?.audience_size ?? null,
        postedAtLocal: toLocal(c.registry?.posted_at),
        notes: c.registry?.notes ?? "",
        total: c.total,
        active: c.active,
        companyDomains: c.companyDomains,
        personal: c.personal,
        last24h: c.last24h,
        last7d: c.last7d,
        firstAt: fmt(c.firstAt),
        lastAt: fmt(c.lastAt),
        convertMedian: mins(c.medianConvertMin),
        quickRate: pct(c.quickRate),
        productsPerSub: c.productsPerSub.toFixed(1),
        highRiskShare: pct(c.highRiskShare),
        conversionRate: pct(c.conversionRate),
        sincePost: hours(c.hoursSincePost),
        within24h: c.within24h == null ? "—" : String(c.within24h),
        within72h: c.within72h == null ? "—" : String(c.within72h),
        visits: c.visits == null ? "—" : String(c.visits),
        visitsSub: c.visits == null ? "집계 전" : `24h ${c.visits24h} · 7d ${c.visits7d}`,
        visitConversion: pct(c.visitConversion),
        unsubscribes: c.unsubscribes == null ? "—" : String(c.unsubscribes),
        raw: { conversionRate: c.conversionRate, hoursSincePost: c.hoursSincePost, medianConvertMin: c.medianConvertMin, highRiskShare: c.highRiskShare, firstAt: c.firstAt, lastAt: c.lastAt, visits: c.visits, visitConversion: c.visitConversion, unsubscribes: c.unsubscribes },
      }))}
    />
  );

  const ops = (
    <section className="card">
      <h2>운영 작업</h2>
      <p className="sub">구독자 전체 발송은 여기서 할 수 없습니다(월요일 크론 전용). 테스트 발송은 아래 테스트 수신자에게만 갑니다. 수집·분류는 10~40초 걸릴 수 있습니다.</p>
      <div className="ops-grid">
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="collect" /><input type="hidden" name="tab" value="ops" /><button className="btn">수집 실행</button><p>지난 8일치 소스를 모두 가져와 새 항목만 저장합니다. 메일 발송 없음.</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="classify" /><input type="hidden" name="tab" value="ops" /><button className="btn">분류 실행</button><p>미분류 항목에 영향도·규격 매칭을 부여합니다. 메일 발송 없음.</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="testsend" /><input type="hidden" name="tab" value="ops" /><button className="btn">테스트 다이제스트 발송</button><p>정기 발송과 같은 최근 14일 후보로, 운영자·테스트 수신자에게 각 1통씩 미리보기 메일을 보냅니다(구독 중인 주소는 그 구독 설정 기준, 아니면 전체 규격 기준).</p></form>
        <form method="post" action="/api/admin/run"><input type="hidden" name="action" value="dailyreport" /><input type="hidden" name="tab" value="ops" /><button className="btn">운영 리포트 지금 발송</button><p>내일 아침에 올 일일 리포트를 지금 받아봅니다(운영자 주소로만).</p></form>
      </div>
      <h3 style={{ margin: "24px 0 4px" }}>테스트 수신자 ({recipients.length}명)</h3>
      <p className="sub">"테스트 다이제스트 발송"을 누르면 아래 주소로 각 1통씩 갑니다. 제목에 [테스트]가 붙고 발송 기록이 남지 않아 정기 발송에는 영향이 없습니다. Gmail·네이버 등 메일 앱별 표시·스팸함 확인용으로 본인 주소를 추가하세요(최대 {TEST_RECIPIENTS_MAX}개). 운영 리포트는 운영자 주소로만 갑니다.</p>
      <table className="admin-table"><tbody>
        {recipients.map((r) => (
          <tr key={r.email}>
            <td>{r.email}</td>
            <td style={{ color: "var(--muted)" }}>{r.source === "admin" ? "운영자 (고정)" : r.source === "env" ? "환경변수 TEST_EMAILS (Vercel에서 관리)" : "대시보드 등록"}</td>
            <td className="num">
              {r.source === "dashboard" && (
                <form method="post" action="/api/admin/run" style={{ margin: 0 }}>
                  <input type="hidden" name="action" value="testemail_remove" /><input type="hidden" name="tab" value="ops" /><input type="hidden" name="email" value={r.email} />
                  <button className="btn ghost" type="submit">삭제</button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody></table>
      <form method="post" action="/api/admin/run" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input type="hidden" name="action" value="testemail_add" /><input type="hidden" name="tab" value="ops" />
        <input type="email" name="email" required placeholder="테스트 받을 이메일 (예: 본인 Gmail)" style={{ flex: "1 1 260px" }} />
        <button className="btn" type="submit">추가</button>
      </form>
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
        <div className="kpi"><span>유입 (24시간)</span><strong>{d.visits.available ? d.visits.last24h : "—"}</strong><small>{d.visits.available ? `7일 ${d.visits.last7d} · 14일 ${d.visits.last14d} · 누적 ${d.visits.total}` : "visits 테이블 마이그레이션 필요"}</small></div>
        <div className={`kpi${d.churn.last7d > 0 ? " kpi-warn" : ""}`}><span>구독해지 (7일)</span><strong>{d.churn.available ? d.churn.last7d : "—"}</strong><small>{d.churn.available ? `24시간 ${d.churn.last24h} · 누적 ${d.churn.total} · 7일 해지율 ${d.churn.rate7d == null ? "—" : `${(d.churn.rate7d * 100).toFixed(1)}%`}` : "unsubscribes 테이블 마이그레이션 필요"}</small></div>
        <div className="kpi"><span>회사 도메인</span><strong>{stats.companyDomains}</strong><small>개인 메일 {stats.personalMailCount}명</small></div>
        <div className="kpi"><span>같은 회사 2명+</span><strong>{stats.multiSeatDomains.length}</strong><small>{stats.multiSeatDomains.length ? stats.multiSeatDomains.slice(0, 3).map((x) => `${x.domain} ${x.count}`).join(" · ") : "조직 확산 지표"}</small></div>
        <div className="kpi"><span>이번 주 발송 ({d.weekStart})</span><strong>{delCount("sent")}</strong><small>실패 {delCount("failed")} · 해당없음 {delCount("skipped_empty")}</small></div>
      </section>

      <AdminTabs
        tabs={[
          { id: "overview", label: "개요", content: overview },
          { id: "subscribers", label: `구독자 (${d.subscribers.length})`, content: subscribers },
          { id: "channels", label: `채널 (${d.channels.length})`, content: channels },
          { id: "updates", label: "수집 항목", content: updates },
          { id: "deliveries", label: "발송 기록", content: deliveries },
          { id: "votes", label: `투표·건의${d.voteAvailable ? ` (${d.vote.open?.total ?? 0}표 · ${d.suggestions.length}건)` : ""}`, content: <VotePanel summary={d.vote} suggestions={d.suggestions} available={d.voteAvailable} /> },
          { id: "ops", label: "운영 작업", content: ops },
        ]}
      />
    </main>
  );
}
