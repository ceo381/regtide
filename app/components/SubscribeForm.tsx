"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CATALOG_BY_ID, JURISDICTION_LABEL, PRODUCT_CATEGORIES, groupedCatalog, type Jurisdiction } from "@/lib/catalog";

interface Product {
  uid: number;
  name: string;
  category: (typeof PRODUCT_CATEGORIES)[number];
  catalogIds: string[];
  tab: Jurisdiction;
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

export default function SubscribeForm() {
  const grouped = useMemo(() => groupedCatalog(), []);
  const [products, setProducts] = useState<Product[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftCat, setDraftCat] = useState<Product["category"]>("2등급");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const totalIds = useMemo(() => new Set(products.flatMap((p) => p.catalogIds)), [products]);

  function addProduct() {
    const name = draftName.trim();
    if (!name) return;
    setProducts((ps) => [...ps, { uid: uidSeq++, name, category: draftCat, catalogIds: [], tab: "KR" }]);
    setDraftName("");
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
    if (missing) return setStatus({ kind: "err", msg: `"${missing.name}" 품목에 적용 규격·인증을 1개 이상 선택하세요.` });
    if (!consent) return setStatus({ kind: "err", msg: "개인정보 수집·이용에 동의해야 구독할 수 있습니다." });

    setBusy(true);
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          consent,
          products: products.map(({ name, category, catalogIds }) => ({ name, category, catalogIds })),
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
      {/* STEP 1 */}
      <section className="card">
        <h2>
          <span className="step">1</span>보유 품목 등록
        </h2>
        <p className="sub">제조·수입하는 품목명을 입력하세요. 품목마다 적용 규격·인증을 따로 선택할 수 있습니다.</p>
        <div className="row">
          <div>
            <label htmlFor="pname">품목명</label>
            <input
              id="pname"
              type="text"
              placeholder="예) 개인용 저주파자극기, 혈당측정기, 영상진단 AI 소프트웨어"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addProduct();
                }
              }}
            />
          </div>
          <div>
            <label htmlFor="pcat">등급·유형</label>
            <select id="pcat" value={draftCat} onChange={(e) => setDraftCat(e.target.value as Product["category"])}>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={addProduct}>
            + 품목 추가
          </button>
        </div>
        {products.length === 0 && <div className="empty">아직 등록된 품목이 없습니다.</div>}
      </section>

      {/* STEP 2 */}
      {products.length > 0 && (
        <section className="card">
          <h2>
            <span className="step">2</span>품목별 적용 규격·인증 선택
          </h2>
          <p className="sub">
            국가 탭을 바꾸며 해당 품목에 적용된 항목을 모두 선택하세요. 빠른 선택 세트를 누르면 관련 항목이 한 번에 추가됩니다.
          </p>

          {products.map((p) => (
            <div className="product" key={p.uid}>
              <div className="product-head">
                <div>
                  <strong>{p.name}</strong>
                  <span className="cat">{p.category}</span>
                </div>
                <div>
                  <span className="count">{p.catalogIds.length}개 선택</span>
                  <button type="button" className="btn-ghost" onClick={() => setProducts((ps) => ps.filter((x) => x.uid !== p.uid))}>
                    삭제
                  </button>
                </div>
              </div>

              <div className="quick">
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
            </div>
          ))}
        </section>
      )}

      {/* STEP 3 */}
      {products.length > 0 && (
        <section className="card">
          <h2>
            <span className="step">3</span>주간 업데이트 이메일 받기
          </h2>
          <p className="sub">
            선택한 총 <strong>{totalIds.size}개</strong> 규격·인증의 변경 사항을 매주 월요일 오전 9시(KST)에 원문 발췌와 링크로 보내드립니다. 변경이 없는 주에는 "이번 주 변경 없음"으로 안내드립니다.
          </p>
          <label htmlFor="email">이메일 주소</label>
          <input id="email" type="email" required placeholder="ra@company.co.kr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

          <div className="consent-box" style={{ marginTop: 16 }}>
            <strong>개인정보 수집·이용 동의 (필수)</strong>
            <ul>
              <li>수집 항목: 이메일 주소, 등록한 품목명·선택 규격, 동의 일시 및 IP</li>
              <li>수집 목적: 규제 업데이트 주간 리포트 이메일 발송</li>
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
            <span>위 개인정보 수집·이용에 동의합니다.</span>
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
