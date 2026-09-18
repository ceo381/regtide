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
