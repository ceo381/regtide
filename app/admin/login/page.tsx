import { redirect } from "next/navigation";
import { adminEnabled, getAdminSession } from "@/lib/admin-auth";

export const metadata = { title: "관리자 로그인", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAdminSession()) redirect("/admin");
  const { error } = await searchParams;
  const enabled = adminEnabled();
  return (
    <main className="admin-login">
      <form method="post" action="/api/admin/login" className="admin-login-card">
        <p className="eyebrow">RegTide</p>
        <h1>관리자 로그인</h1>
        {!enabled && <p className="admin-alert">환경변수 <code>ADMIN_PASSWORD</code> 가 설정되지 않아 관리자 페이지가 비활성화되어 있습니다.</p>}
        {error === "1" && <p className="admin-alert">아이디 또는 비밀번호가 올바르지 않습니다.</p>}
        {error === "rate" && <p className="admin-alert">시도가 너무 많습니다. 15분 후 다시 시도하세요.</p>}
        <label>
          아이디
          <input name="user" autoComplete="username" required disabled={!enabled} />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" autoComplete="current-password" required disabled={!enabled} />
        </label>
        <button type="submit" className="btn" disabled={!enabled}>로그인</button>
      </form>
    </main>
  );
}
