"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CATALOG_BY_ID, DEFAULT_CATALOG_BY_CATEGORY, JURISDICTION_LABEL, PRODUCT_CATEGORIES, groupedCatalog, productLabel, type Jurisdiction } from "@/lib/catalog";

interface Product {
  uid: number;
  name: string;
  category: (typeof PRODUCT_CATEGORIES)[number];
  catalogIds: string[];
  tab: Jurisdiction;
  open: boolean; // 규격 목록 펼침 여부
}

const PRESETS: { label: string; ids: string[] }[] = [
  { label: "국내 허가 기본 (법령·허가·GMP·기준규격)", ids: ["kr-mdact", "kr-approval", "kr-classification", "kr-gmp", "kr-standards", "kr-vigilance", "kr-udi"] },
  { label: "능동형 전기기기 (60601 시리즈)", ids: ["iec-60601-1", "iec-60601-1-2", "iec-60601-1-x", "iec-62366-1", "iso-14971", "iso-13485"] },
  { label: "SaMD · AI 의료기기", ids: ["kr-digital-act", "kr-cyber", "iec-62304", "iec-81001-5-1", "iec-62366-1", "us-software-ai", "us-cyber", "eu-ai-act"] },
  { label: "미국 510(k) 진출", ids: ["us-510k", "us-qmsr", "us-udi", "us-mdr", "us-labeling", "us-recognized-standards"] },
  { label: "EU CE(MDR) 인증", ids: ["eu-mdr", "eu-mdcg", "eu-harmonised", "eu-eudamed", "eu-notified-body", "iso-13485", "iso-14971", "iso-15223-1"] },
  { label: "체외진단(IVD)", ids: ["kr-ivd-act", "us-ivd", "eu-ivdr", "iso-14155", "iso-13485"] },
  { label: "멸균·이식형·생물학적 안전", ids: ["iso-10993", "iso-11607", "iso-17664", "kr-standards"] },
];

const JURISDICTIONS: Jurisdiction[] = ["KR", "US", "EU", "INTL"];

let uidSeq = 1;
const newProduct = (category: Product["category"], name = ""): Product => ({ uid: uidSeq++, name, category, catalogIds: [...DEFAULT_CATALOG_BY_CATEGORY[category]], tab: "KR", open: false });

export default function SubscribeForm() {
  const grouped = useMemo(() => groupedCatalog(), []);
  // 품목 하나가 기본 세트와 함께 미리 등록된 상태로 시작 → 등급 확인 · 이메일 · 동의만으로 구독 가능
  const [products, setProducts] = useState<Product[]>(() => [newProduct("2등급")]);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 유입 채널: URL 의 ?ref=코드 를 최초 1회 저장(first-touch). 새로고침·다른 페이지 방문 후 구독해도 유지
  const [channel, setChannel] = useState<{ ref: string; landedAt: string; referrer: string } | null>(null);
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const fromUrl = (url.searchParams.get("ref") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
      const stored = JSON.parse(localStorage.getItem("regtide_ref") ?? "null") as { ref: string; landedAt: string; referrer: string } | null;
      if (stored?.ref) { setChannel(stored); return; }
      if (fromUrl) {
        let referrer = "";
        try { referrer = document.referrer ? new URL(document.referrer).host : ""; } catch { /* ignore */ }
        const c = { ref: fromUrl, landedAt: new Date().toISOString(), referrer };
        localStorage.setItem("regtide_ref", JSON.stringify(c));
        setChannel(c);
      }
    } catch { /* localStorage 불가 환경이면 채널 없이 진행 */ }
  }, []);

  const totalIds = useMemo(() => new Set(products.flatMap((p) => p.catalogIds)), [products]);

  function addProduct() {
    setProducts((ps) => [...ps, newProduct("2등급")]);
  }
  /** 등급·유형을 바꾸면 그 유형의 기본 세트로 다시 채운다 (직접 고른 항목은 유지) */
  function changeCategory(p: Product, category: Product["category"]) {
    const prevDefault = new Set(DEFAULT_CATALOG_BY_CATEGORY[p.category]);
    const custom = p.catalogIds.filter((id) => !prevDefault.has(id));
    update(p.uid, { category, catalogIds: [...new Set([...DEFAULT_CATALOG_BY_CATEGORY[category], ...custom])] });
  }

  function update(uid: number, patch: Partial<Product>) {
    setProducts((ps) => ps.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  }

  function toggle(p: Product, id: string) {
    const has = p.catalogIds.includes(id);
    update(p.uid, { catalogIds: has ? p.catalogIds.filter((x) => x !== id) : [...p.catalogIds, id] });
  }

  function applyPreset(p: Product, ids: string[]) {
    update(p.uid, { catalogIds: [...new Set([...p.catalogIds, ...ids])] });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (products.length === 0) return setStatus({ kind: "err", msg: "품목을 1개 이상 등록하세요." });
    const missing = products.find((p) => p.catalogIds.length === 0);
    if (missing) return setStatus({ kind: "err", msg: `"${productLabel(missing, products.indexOf(missing))}" 품목에 적용 규격·인증을 1개 이상 선택하세요.` });
    if (!consent) return setStatus({ kind: "err", msg: "개인정보 수집·이용에 동의해야 구독할 수 있습니다." });

    setBusy(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          consent,
          products: products.map(({ name, category, catalogIds }) => ({ name: name.trim(), category, catalogIds })),
          ref: channel?.ref ?? "",
          landedAt: channel?.landedAt ?? "",
          referrer: channel?.referrer ?? "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "오류가 발생했습니다.");
      setStatus({
        kind: "ok",
        msg: `구독이 완료되었습니다. ${products.length}개 품목, ${json.catalogCount}개 규격·인증에 대한 업데이트를 매주 월요일 오전 ${email} 로 보내드립니다.`,
      });
    } catch (err) {
      setStatus({ kind: "err", msg: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {/* STEP 1 — 품목(등급·유형) + 규격 선택. 등급을 고르면 기본 세트가 미리 선택되어 있음 */}
      <section className="card">
        <h2>
          <span className="step">1</span>품목 등급·유형과 적용 규격 확인
        </h2>
        <p className="sub">
          등급·유형을 고르면 그 유형에 흔히 적용되는 국내 법령·GMP·핵심 규격이 미리 선택됩니다. 그대로 두어도 되고, 미국·EU 진출 품목이면 빠른 선택 세트를 더하거나 항목을 직접 조정하세요.
          품목명은 선택 입력입니다.
        </p>

        {products.map((p) => (
          <div className="product" key={p.uid}>
            <div className="product-head">
              <div className="product-fields">
                <label>
                  <span>등급·유형</span>
                  <select value={p.category} onChange={(e) => changeCategory(p, e.target.value as Product["category"])} aria-label="품목 등급·유형">
                    {PRODUCT_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>품목명 <em>(선택)</em></span>
                  <input type="text" value={p.name} maxLength={100} placeholder="예) 개인용 저주파자극기 — 비워도 됩니다" onChange={(e) => update(p.uid, { name: e.target.value })} aria-label="품목명(선택)" />
                </label>
              </div>
              {products.length > 1 && (
                <button type="button" className="btn-ghost" onClick={() => setProducts((ps) => ps.filter((x) => x.uid !== p.uid))}>
                  삭제
                </button>
              )}
            </div>

            <div className="selected-summary">
              <div className="selected-chips">
                {p.catalogIds.length === 0 ? (
                  <span className="none">선택된 규격이 없습니다.</span>
                ) : (
                  p.catalogIds.map((id) => CATALOG_BY_ID[id]).filter(Boolean).map((it) => (
                    <span key={it.id} className="mini-chip" title={it.description}>{it.label}</span>
                  ))
                )}
              </div>
              <button type="button" className="btn-ghost" onClick={() => update(p.uid, { open: !p.open })} aria-expanded={p.open}>
                {p.open ? "접기" : `규격 수정 (${p.catalogIds.length}개 선택)`}
              </button>
            </div>

            {p.open && (
              <>
                <div className="quick">
                  <button type="button" onClick={() => update(p.uid, { catalogIds: [...DEFAULT_CATALOG_BY_CATEGORY[p.category]] })}>↺ {p.category} 기본 세트로</button>
                  {PRESETS.map((s) => (
                    <button type="button" key={s.label} onClick={() => applyPreset(p, s.ids)}>
                      + {s.label}
                    </button>
                  ))}
                  {p.catalogIds.length > 0 && (
                    <button type="button" onClick={() => update(p.uid, { catalogIds: [] })}>
                      선택 초기화
                    </button>
                  )}
                </div>

                <div className="tabs">
                  {JURISDICTIONS.map((j) => {
                    const n = p.catalogIds.filter((id) => CATALOG_BY_ID[id]?.jurisdiction === j).length;
                    return (
                      <button type="button" key={j} className={`tab ${p.tab === j ? "on" : ""}`} onClick={() => update(p.uid, { tab: j })}>
                        {JURISDICTION_LABEL[j]}
                        {n > 0 && <span className="n">{n}</span>}
                      </button>
                    );
                  })}
                </div>

                {Object.entries(grouped[p.tab]).map(([group, items]) => (
                  <div key={group}>
                    <div className="group-title">{group}</div>
                    <div className="chips">
                      {items.map((it) => {
                        const on = p.catalogIds.includes(it.id);
                        return (
                          <button type="button" key={it.id} className={`chip ${on ? "on" : ""}`} onClick={() => toggle(p, it.id)} title={it.description}>
                            {it.label}
                            <small>{it.description}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn" onClick={addProduct}>+ 품목 추가</button>
          <span className="sub" style={{ marginLeft: 10 }}>등급이 다른 품목이 더 있으면 추가하세요. 규격이 같다면 하나로 충분합니다.</span>
        </div>
      </section>

      {/* STEP 2 */}
      {products.length > 0 && (
        <section className="card">
          <h2>
            <span className="step">2</span>주간 업데이트 이메일 받기
          </h2>
          <p className="sub">
            선택한 총 <strong>{totalIds.size}개</strong> 규격·인증의 변경 사항을 매주 월요일 오전 9시(KST)에 원문 발췌와 링크로 보내드립니다. 해당 항목이 없는 주에는 메일을 보내지 않습니다.
          </p>
          <label htmlFor="email">이메일 주소</label>
          <input id="email" type="email" required placeholder="ra@company.co.kr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

          <div className="consent-box" style={{ marginTop: 16 }}>
            <strong>개인정보 수집·이용 동의 (필수)</strong>
            <ul>
              <li>수집 항목(필수): 이메일 주소, 품목 등급·유형, 선택한 규격·인증, 동의 일시 및 IP</li>
              <li>수집 항목(선택): 품목명 — 입력하지 않아도 서비스를 이용할 수 있으며, 입력 시 리포트에 표시됩니다</li>
              <li>자동 수집: 서비스 안내 링크(?ref=)로 접속한 경우 유입 경로 코드·최초 접속 시각 (채널별 효과 측정 통계 목적)</li>
              <li>수집 목적: 구독 신청 확인 메일 발송(1회), 규제 업데이트 주간 리포트 이메일 발송, 구독해지 처리</li>
              <li>보유 기간: 구독해지(구독 해지) 시까지. 해지 즉시 삭제됩니다.</li>
              <li>제3자 제공: 없음. 단, 이메일 발송을 위해 발송 대행 서비스(Resend)에 처리를 위탁합니다.</li>
              <li>동의를 거부할 수 있으며, 거부 시 서비스 이용이 불가합니다.</li>
            </ul>
            <div style={{ marginTop: 6 }}>
              <Link href="/privacy">개인정보 처리방침 전문 보기</Link>
            </div>
          </div>
          <label className="consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>위 개인정보 수집·이용에 동의합니다. (선택 항목인 품목명은 입력한 경우에만 수집됩니다)</span>
          </label>

          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "저장 중…" : "매주 월요일 업데이트 받기"}
          </button>
          {status && <div className={`notice ${status.kind}`}>{status.msg}</div>}
        </section>
      )}
    </form>
  );
}
