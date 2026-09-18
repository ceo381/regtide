# RegTide

> **Reg**ulatory + **Tide** — 매주 밀려오는 규제 변경의 흐름을 읽어드립니다.

의료기기 제조사가 보유 품목에 적용된 국내외 규격·인증을 선택하면, 관련 법령·고시·입법예고·가이던스·규격 동향의 변경 사항을 매주 월요일 오전 9시(KST)에 이메일로 보내주는 서비스입니다. 회원가입이 없고, 외부 AI API를 사용하지 않아 **운영 비용 0원**으로 배포할 수 있습니다.

## 무료 스택

| 구성 | 서비스 | 무료 한도 | 비고 |
|---|---|---|---|
| 호스팅·크론 | Vercel Hobby | 크론 2개, 함수 60초 | 주 1회 크론은 Hobby에서 허용 |
| DB | Supabase Free | 500MB, 무제한 API 요청 | 7일간 요청 없으면 일시정지되나 주간 크론이 깨워줌 |
| 이메일 | Resend Free | 월 3,000통, 일 100통 | 실사용자 발송에는 도메인 인증 필요(도메인 비용만 발생) |
| 분류 | 규칙 기반(키워드) | — | AI API 미사용 |

이메일 도메인까지 피하려면 Brevo(일 300통, Gmail 발신자 인증 가능) 같은 대안을 쓸 수 있으나, 시장 검증 단계에서도 자체 도메인 발신이 신뢰도에 유리합니다.

## 동작 흐름

```
[사용자]  품목 등록 → 규격·인증 선택 → 이메일 + 개인정보 동의 → POST /api/subscribe → Supabase(subscribers)

[매주 월 09:00 KST, Vercel Cron → GET /api/cron/weekly]
  1. collect   : 소스별 어댑터로 지난 8일치 수집 → updates 테이블 (source, external_id 로 중복 제거)
  2. classify  : 미분류 항목을 규칙 기반으로 분류 — 카탈로그 keywords 매칭(제목 3점·본문 1점) → catalog_ids,
                 문서 유형(입법예고/고시/가이던스/Rule…) → impact(high/medium/low/none), 본문 앞부분 발췌 → summary
  3. send      : 구독자별로 자기 카탈로그 ID와 겹치는 항목만 모아 Resend 로 발송 (deliveries 에 기록, 같은 주 중복 발송 방지)
```

### 수집 소스

| 소스 키 | 대상 | 방식 |
|---|---|---|
| `mfds_rss:data0009` | 식약처 입법/행정예고 | RSS |
| `mfds_rss:data0005` | 식약처 고시전문 | RSS |
| `mfds_rss:data0013` | 식약처 안내서/지침 | RSS |
| `mfds_rss:ntc0004` | 식약처 공고 | RSS |
| `mfds_rss:plc0139` | 의료기기 회수/판매중지 | RSS |
| `law_go_kr` | 국가법령정보센터 법령·행정규칙 | Open API (`LAW_GO_KR_OC` 설정 시 활성) |
| `federal_register` | FDA 발행 Rule/Proposed Rule/Notice | Federal Register API v1 |
| `page_watch:eu_md_latest` | EU Commission 의료기기 최신소식·MDCG 문서 | 페이지 스냅샷 비교 |
| `page_watch:eu_harmonised` | EU 조화규격 목록 | 페이지 스냅샷 비교 |
| `page_watch:iso` | ISO 규격 페이지 (13485, 14971, 10993-1, 14155, 15223-1, 11607-1, TC 210) | 페이지 스냅샷 비교 — iso.org 가 403으로 차단하면 `DISABLED_SOURCES=page_watch:iso` |
| `page_watch:iec` | IEC webstore publication 페이지 (62304, 60601-1, 62366-1, 81001-5-1) | 페이지 스냅샷 비교 |

식약처 RSS 피드는 식품·의약품 항목이 섞여 있어 수집 단계에서 `의료기기|체외진단|디지털의료|GMP|UDI|…` 힌트로 1차 필터하고, 분류 단계에서 `식품|화장품|의약품…` 배제어로 다시 걸러냅니다.

### 분류 규칙 (lib/classify.ts)

- **관련성**: 카탈로그 항목의 `keywords` 가 제목에 있으면 3점, 본문에 있으면 1점. 같은 관할은 1점 이상, ISO/IEC 항목이 타관할 문서에 언급되면 2점 이상일 때 매칭.
- **영향도**: 한국은 입법예고·행정예고·개정고시 → `high`, 안내서·지침 → `medium`, 회수·행정처분 → `low`. 미국은 Rule/Proposed Rule → `high`, 가이던스 → `medium`, 기타 Notice → `low`. EU 조화규격·시행결정 → `high`, 그 외 페이지 변경 → `medium`. 매칭 없음 → `none`(발송 제외).
- **발췌**: 본문 앞 420자(문장 경계에서 자름). 페이지 변경 항목은 "새로 추가된 내용" 부분만.

정확도를 높이려면 `lib/catalog.ts` 의 `keywords` 를 다듬는 것이 가장 효과적입니다. 나중에 AI 요약을 붙이고 싶으면 `classifyOne()` 하나만 교체하면 됩니다.
페이지 스냅샷 방식은 첫 실행에서 기준 스냅샷만 저장하고, 두 번째 실행부터 "새로 추가된 문장"을 업데이트로 만듭니다.

### 규격·인증 카탈로그

`lib/catalog.ts` 에 정의되어 있으며 한국(MFDS) 13개, 미국(FDA) 11개, EU 7개, ISO/IEC 14개 항목입니다. 항목을 추가·수정하려면 이 파일만 고치면 UI·분류·이메일에 모두 반영됩니다. 각 항목의 `keywords` 가 분류 정확도를 결정합니다.

## 설치·배포

### 1. Supabase
1. 프로젝트 생성 → SQL Editor 에서 `supabase/schema.sql` 실행
2. `Settings → API Keys` 에서 `Project URL` 과 **Secret key**(`sb_secret_...`)를 확보해 `SUPABASE_SERVICE_ROLE_KEY` 에 넣습니다. (구 `service_role` JWT 키는 `Legacy API keys` 탭에 있으며 둘 다 동작합니다. `anon`/`publishable` 키는 사용하지 않습니다.)
3. 이미 스키마를 만든 뒤 업데이트하는 경우: `alter table updates add column if not exists matched_keywords text[] not null default '{}';`

### 2. Resend
1. 계정 생성 → 발송 도메인 추가·DNS 인증 → API 키 발급
2. `MAIL_FROM="RegTide <digest@yourdomain.com>"` 형태로 설정 (테스트는 `onboarding@resend.dev` 사용 가능하나 본인 계정 이메일로만 발송됨)

### 3. (선택) 국가법령정보센터 Open API
https://open.law.go.kr 에서 사용 신청 → 승인된 사용자 ID를 `LAW_GO_KR_OC` 에 설정.

### 4. 로컬 실행
```bash
cp .env.example .env   # 값 채우기
npm install
npm run dev            # http://localhost:3000

# 파이프라인 수동 실행
npx tsx --env-file=.env scripts/run-weekly.ts dry       # 소스 연결 확인만 (DB 미사용)
npx tsx --env-file=.env scripts/run-weekly.ts collect
npx tsx --env-file=.env scripts/run-weekly.ts classify
npx tsx --env-file=.env scripts/run-weekly.ts send --recent --send-empty   # 최근 8일 집계 + 변경 없어도 발송(테스트)
```

### 5. Vercel 배포
1. GitHub 에 push 후 Vercel 에서 Import
2. Environment Variables 에 `.env.example` 항목 모두 등록 (`NEXT_PUBLIC_SITE_URL` 은 배포 도메인)
3. `vercel.json` 의 크론 `0 0 * * 1` (UTC) = 매주 월요일 09:00 KST 에 `/api/cron/weekly` 호출. Vercel 은 `Authorization: Bearer $CRON_SECRET` 헤더를 자동으로 붙입니다.
4. 수동 실행: `curl -H "Authorization: Bearer $CRON_SECRET" https://<도메인>/api/cron/weekly`

> **타임아웃 주의** — Hobby 플랜은 함수 실행 60초 제한이 있습니다. 소스가 많아지면 `?step=collect`, `?step=classify`, `?step=send` 로 나눠 크론 3개를 5분 간격으로 등록하세요 (예: `0 0 * * 1`, `5 0 * * 1`, `10 0 * * 1`). Pro 플랜은 `maxDuration = 300` 으로 한 번에 실행됩니다.

## 개인정보

- 수집 항목: 이메일, 품목명·선택 규격, 동의 시각·IP (`consent_at`, `consent_ip`, `consent_version`)
- 수신거부 링크(`/api/unsubscribe?token=…`) 클릭 시 구독자 레코드를 즉시 삭제 (발송 이력은 cascade 삭제)
- `app/privacy/page.tsx` 의 **개인정보 보호책임자 성명·연락처**를 반드시 기입한 뒤 배포하세요.
- Supabase 테이블은 RLS 활성화 상태이며 서버에서 service_role 키로만 접근합니다.

## 폴더 구조

```
app/
  page.tsx                 랜딩 + 3단계 폼
  privacy/page.tsx         개인정보 처리방침
  components/SubscribeForm.tsx
  api/subscribe            구독 저장 (zod 검증, 간단한 rate limit)
  api/unsubscribe          수신거부(즉시 삭제)
  api/cron/weekly          주간 파이프라인
lib/
  catalog.ts               규격·인증 카탈로그 (핵심 데이터)
  sources/                 수집 어댑터 (mfds-rss, federal-register, law-go-kr, page-watch)
  collect.ts / classify.ts / digest.ts
supabase/schema.sql
scripts/run-weekly.ts      로컬 수동 실행
vercel.json                크론 설정
```

## 알려진 제약·다음 단계

- ISO/IEC 는 공개 API가 없어 규격 페이지 변경 감지로 대체했습니다. iso.org 는 자동화 접근을 차단(403)하는 경우가 있으며, 이때 수집 결과의 `skipped` 에 표시되고 나머지 소스는 정상 진행됩니다. 계속 차단되면 `DISABLED_SOURCES=page_watch:iso` 로 끄세요. EN ISO 규격의 개정은 EU 조화규격 페이지에서, FDA 인정 규격 변경은 Federal Register 에서 별도로 잡힙니다.
- FDA 가이던스는 Federal Register 의 "Guidance Availability" 공고로 전부 수집되므로 별도 페이지 감시를 두지 않았습니다.
- EUR-Lex 는 RSS 생성에 로그인이 필요해 EU Commission 페이지 감시로 대체했습니다. OJEU 조화규격 시행결정은 조화규격 페이지 변경으로 감지됩니다.
- 요약이 아닌 원문 발췌를 제공합니다. Federal Register·EU 항목은 영어 발췌가 그대로 나갑니다. AI 요약은 유료 전환 시 `classifyOne()` 교체로 추가할 수 있습니다.
- 구독 확인(더블 옵트인) 메일은 넣지 않았습니다. 필요하면 `subscribers.active=false` 로 저장 후 확인 링크 클릭 시 `true` 로 바꾸는 라우트를 추가하세요.
- 발송 대상이 수백 명 이상으로 늘면 Resend Batch API(`resend.batch.send`) 로 전환하는 것을 권장합니다.
