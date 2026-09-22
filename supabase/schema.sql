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

-- 2026-09-22: 유입(방문) 집계 — 랜딩 페이지 접속을 채널(ref)별로 센다. 개인 식별 정보 없음 (IP·쿠키·방문자 ID 저장 안 함)
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  ref text,                                  -- 링크의 ?ref= 값. 없으면 null (직접/미상)
  referrer text,                             -- 이전 페이지 호스트만 (예: open.kakao.com)
  landed_at timestamptz not null default now()
);
create index if not exists visits_landed_idx on visits(landed_at desc);
create index if not exists visits_ref_idx on visits(ref);
alter table visits enable row level security;

-- 2026-09-22: 구독해지 통계 — 해지 시 식별 정보(이메일·id·토큰)는 삭제하고, 식별 불가 통계만 남긴다
create table if not exists unsubscribes (
  id uuid primary key default gen_random_uuid(),
  unsubscribed_at timestamptz not null default now(),
  reason text not null default 'user',       -- user(구독자 본인 해지) / admin(운영자 삭제)
  ref text,                                  -- 유입 채널 코드
  subscribed_at timestamptz,                 -- 구독 시작 시각
  tenure_days int,                           -- 구독 기간(일)
  catalog_count int,                         -- 선택했던 규격·인증 수
  categories text[],                         -- 품목 등급·유형 (품목명 없음)
  deliveries_received int,                   -- 받은 리포트 수
  last_sent_at timestamptz,                  -- 마지막 리포트 수신 시각
  mail_type text                             -- company / personal (도메인 자체는 저장하지 않음)
);
create index if not exists unsubscribes_at_idx on unsubscribes(unsubscribed_at desc);
alter table unsubscribes enable row level security;

-- 2026-09-22: 기능 투표·건의 — 익명 (이메일·IP 미저장). 라운드 단위로 열고 닫으며, 출시된 후보는 released_at 으로 표시
create table if not exists vote_rounds (
  id uuid primary key default gen_random_uuid(),
  title text not null,                       -- 예: 1차 — 다음 기능은 RA·QA 실무자가 고릅니다
  status text not null default 'open',       -- open / closed
  show_results boolean not null default false, -- 득표 공개 여부 (기본 비공개)
  release_note text,                         -- 마감 후 "이번에 열린 기능" 안내 문구 (선택)
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists vote_options (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references vote_rounds(id) on delete cascade,
  label text not null,
  description text,
  sort int not null default 0,
  released_at timestamptz,                   -- 출시되면 날짜 기입 → 랜딩 "출시된 기능" 이력, 메일 "여러분이 뽑은 기능이 열렸습니다"
  created_at timestamptz not null default now()
);
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references vote_rounds(id) on delete cascade,
  option_id uuid not null references vote_options(id) on delete cascade,
  ref text,                                  -- 유입 채널 코드 (통계용)
  created_at timestamptz not null default now()
);
create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references vote_rounds(id) on delete set null,
  message text not null,                     -- 자유 입력 (개인정보를 적지 않도록 안내)
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists votes_round_idx on votes(round_id);
create index if not exists suggestions_created_idx on suggestions(created_at desc);
alter table vote_rounds enable row level security;
alter table vote_options enable row level security;
alter table votes enable row level security;
alter table suggestions enable row level security;

-- 1차 라운드 시드 (이미 라운드가 있으면 건너뜀)
insert into vote_rounds (id, title)
select '00000000-0000-0000-0000-000000000001', '1차 — 다음 기능은 RA·QA 실무자가 고릅니다.'
where not exists (select 1 from vote_rounds);
insert into vote_options (round_id, label, description, sort)
select '00000000-0000-0000-0000-000000000001', v.label, v.description, v.sort
from (values
  ('규제 변경 아카이브·검색', '지금까지 수집된 변경 사항을 기관·규격·기간으로 찾아보기', 1),
  ('개정 전후 조문 비교', '입법예고·개정 고시의 바뀐 조항을 신구 대비로 한눈에', 2),
  ('규격별 개정 이력 타임라인', '규격 하나를 골라 개정·입법예고 흐름을 시간순으로', 3),
  ('내 문서 영향 알림', '우리 회사 문서 목록(파일 아님)을 규격과 연결해 두면, 개정 시 검토 대상 문서를 이름으로 안내', 4),
  ('입법예고 의견제출 기한 알림', '의견 제출 마감이 다가오는 입법예고를 따로 알림', 5),
  ('FDA·EU 원문 국문 요약', '영어 원문 항목에 한국어 요약을 함께 표기', 6),
  ('팀 단위 구독', '한 번의 설정으로 같은 팀 동료 여러 명이 함께 수신', 7),
  ('이메일 외 알림 채널', '카카오톡·슬랙 등 메신저로도 수신', 8)
) as v(label, description, sort)
where exists (select 1 from vote_rounds where id = '00000000-0000-0000-0000-000000000001')
  and not exists (select 1 from vote_options where round_id = '00000000-0000-0000-0000-000000000001');

-- 2026-09-23: 투표를 구독자 전용으로 — 투표·건의를 구독자와 연결 (해지 시 함께 삭제). 라운드당 1인 1회
alter table votes add column if not exists subscriber_id uuid references subscribers(id) on delete cascade;
alter table suggestions add column if not exists subscriber_id uuid references subscribers(id) on delete cascade;
create index if not exists votes_subscriber_idx on votes(round_id, subscriber_id);
