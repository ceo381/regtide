import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** 테스트 전용: 실제 Supabase 대신 가짜 클라이언트를 주입 (scripts/selftest.ts) */
export function __setSupabaseClientForTest(c: SupabaseClient) {
  client = c;
}

/** 서버 전용 Supabase 클라이언트 (Service Role). 클라이언트 컴포넌트에서 import 금지. */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.");
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export interface SubscriberRow {
  id: string;
  email: string;
  unsubscribe_token: string;
  products: { name: string; category: string; catalogIds: string[] }[];
  catalog_ids: string[];
  active: boolean;
  last_sent_at: string | null;
  ref?: string | null;
  landed_at?: string | null;
  referrer?: string | null;
}

export interface UpdateRow {
  id: string;
  source: string;
  external_id: string;
  jurisdiction: string;
  title: string;
  url: string | null;
  published_at: string | null;
  raw: string | null;
  summary_ko: string | null;
  matched_keywords: string[];
  impact: string | null;
  catalog_ids: string[];
  classified_at: string | null;
  created_at: string;
}

/**
 * Supabase(PostgREST) 는 기본 1,000행까지만 돌려준다. 구독자·발송기록처럼 늘어나는 표는
 * 이 헬퍼로 range 페이징해 전부 읽는다. build 는 정렬·필터가 붙은 쿼리를 새로 만들어야 한다(재사용 불가).
 */
export async function selectAll<T>(build: () => { range(from: number, to: number): PromiseLike<{ data: unknown; error: { message: string } | null }> }, pageSize = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** 발신 주소 — 미설정 시 Resend 테스트 발신자 (상태 점검이 경고함) */
export function mailFrom() {
  return process.env.MAIL_FROM || "RegTide <onboarding@resend.dev>";
}
