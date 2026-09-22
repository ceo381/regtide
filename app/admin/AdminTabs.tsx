"use client";
import { useEffect, useState, type ReactNode } from "react";

/**
 * 탭 전환을 브라우저 안에서만 처리 (서버 재요청 없음).
 * 모든 탭 내용은 서버에서 한 번 렌더링되어 내려오고, 여기서는 보이기/숨기기만 한다.
 * 선택한 탭은 URL 해시(#subscribers)로 유지되어 새로고침·작업 후 리다이렉트에도 남는다.
 */
export default function AdminTabs({ tabs, initial = "overview" }: { tabs: { id: string; label: string; content: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial);
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (fromHash && tabs.some((t) => t.id === fromHash)) setActive(fromHash);
  }, [tabs]);
  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };
  return (
    <>
      <nav className="admin-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={`admin-tab${active === t.id ? " active" : ""}`} onClick={() => select(t.id)} type="button">
            {t.label}
          </button>
        ))}
      </nav>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </>
  );
}
