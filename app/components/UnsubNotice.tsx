"use client";
import { useSearchParams } from "next/navigation";

export default function UnsubNotice() {
  const p = useSearchParams().get("unsub");
  if (p === "ok") return <div className="notice ok">구독해지가 완료되었습니다. 이메일 주소는 삭제되었습니다.</div>;
  if (p === "invalid") return <div className="notice err">유효하지 않은 구독해지 링크입니다. 이미 처리되었거나 만료되었을 수 있습니다.</div>;
  return null;
}
