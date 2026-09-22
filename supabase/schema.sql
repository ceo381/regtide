-- RegTide 스키마 (Supabase SQL Editor에서 실행)

create extension if not exists pgcrypto;

-- 구독자 (회원가입 없음, 이메일만 저장)
create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  consent_at timestamptz not null,           -- 개인정보 수집·이용 동의 시각
  consent_ip text,                           -- 동의 증적용 (선택)
  consent_version text not null default 'v1',
  products jsonb not null default '[]',       -- [{name, category, catalogIds[]}]
  catalog_ids text[] not null default '{}',   -- 모든 품목에 적용된 규격·인증 ID의 합집합
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ref text,                                  -- 유입 채널 코드 (?ref=openchat2). 최초 유입(first-touch) 고정
  landed_at timestamptz,                     -- ref 링크로 처음 접속한 시각 (전환 소요 시간 계산용)
  referrer text,                             -- 접속 시 document.referrer 의 호스트 (선택)
  last_sent_at timestamptz
);
create index if not exists subscribers_active_idx on subscribers(active) where active;
create index if not exists subscribers_catalog_idx on subscribers using gin(catalog_ids);

-- 수집된 업데이트 (법령·고시·입법예고·FR 문서·가이던스·규격 상태 변경 등)
create table if not exists updates (
  id uuid primary key default gen_random_uuid(),
  source text not null,                      -- mfds_rss:data0009, federal_register, page_watch:eu_mdcg ...
  external_id text not null,                 -- 소스 내 고유 키 (URL, document_number, 해시 등)
  jurisdiction text not null,                -- KR | US | EU | INTL
  title text not null,
  url text,
  published_at timestamptz,
  raw text,                                  -- 원문 발췌 (요약 입력용)
  summary_ko text,                           -- 원문 핵심 발췌 (규칙 기반, AI 미사용)
  matched_keywords text[] not null default '{}', -- 매칭된 카탈로그 키워드
  impact text,                               -- high | medium | low | none
  catalog_ids text[] not null default '{}',  -- 관련 규격·인증 ID
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);
create index if not exists updates_created_idx on updates(created_at desc);
create index if not exists updates_catalog_idx on updates using gin(catalog_ids);

-- RSS/API가 없는 페이지의 스냅샷 (변경 감지용)
create table if not exists page_snapshots (
  source_key text primary key,
  content_hash text not null,
  content text not null,
  fetched_at timestamptz not null default now()
);

-- 발송 이력
create table if not exists deliveries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  week_start date not null,
  update_ids uuid[] not null default '{}',
  provider_message_id text,
  status text not null default 'sent',       -- sent | failed | skipped_empty
  error text,
  sent_at timestamptz not null default now(),
  unique (subscriber_id, week_start)
);

-- RLS: 서비스 롤 키만 서버에서 사용하므로 anon 접근은 모두 차단
alter table subscribers enable row level security;
alter table updates enable row level security;
alter table page_snapshots enable row level security;
alter table deliveries enable row level security;

-- 2026-09-22 유입 채널 추적 (기존 프로젝트는 아래 3줄만 실행)
alter table subscribers add column if not exists ref text;
alter table subscribers add column if not exists landed_at timestamptz;
alter table subscribers add column if not exists referrer text;
create index if not exists subscribers_ref_idx on subscribers(ref);

-- 2026-09-22 채널 등록부 (대시보드에서 채널 태그 생성·관리)
create table if not exists channels (
  code text primary key,                     -- 링크의 ?ref= 값. 영문 소문자·숫자·_·- 만
  name text not null,                        -- 사람이 읽는 이름 (예: 카카오 오픈채팅 '의료기기 RA·QA 정보공유')
  kind text not null default '기타',         -- 오픈채팅 / 협회·조합 / 교육기관 / 매체 / 링크드인 / 커뮤니티 / 파트너 / 메일전달 / 기타
  audience_size int,                         -- 게시 대상 인원 (전환율 계산용, 선택)
  posted_at timestamptz,                     -- 게시·배포 시각 (게시 후 경과 계산용, 선택)
  notes text,                                -- 메모 (게시 문구, 담당자, 특이사항)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table channels enable row level security;
