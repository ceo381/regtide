# RegTide 로컬 설치·빌드·실행 가이드 (Windows + VSCode)

> 순서대로 따라가면 됩니다. 각 단계의 "확인" 항목이 맞으면 다음으로 넘어가세요.

---

## A. 준비 (한 번만)

### A-1. Node.js 확인
1. VSCode 실행 → `파일 → 폴더 열기` → `C:\Users\breathings\Desktop\Claude\Cowork\regtide` 선택
2. `터미널 → 새 터미널` (`Ctrl + \``) — PowerShell이 프로젝트 폴더에서 열립니다
3. 입력:
   ```powershell
   node -v
   npm -v
   ```
   **확인**: `v20.9.0` 이상(권장 `v22.x`)과 `10.x` 가 출력. 없거나 낮으면 https://nodejs.org 에서 LTS 설치 후 VSCode 재시작.

### A-2. PowerShell 스크립트 실행 허용 (오류가 날 때만)
`npm`/`npx` 실행 시 "이 시스템에서 스크립트를 실행할 수 없으므로…" 가 나오면:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
`Y` 입력 후 터미널을 닫고 다시 엽니다.

---

## B. 설치

### B-1. 의존성 설치
```powershell
npm install
```
1~2분 소요. **확인**: 마지막 줄 근처에 `added 3xx packages` 와 `found 0 vulnerabilities`. 프로젝트에 `node_modules` 폴더가 생김.
(이전에 설치했더라도 소스가 갱신되었으니 **다시 한 번** 실행하세요.)

### B-2. 타입 검사
```powershell
npm run typecheck
```
**확인**: `> tsc --noEmit` 두 줄만 나오고 아무 메시지 없이 프롬프트가 돌아오면 통과.

### B-3. 자체 테스트 (외부 서비스 불필요)
```powershell
npm run selftest
```
**확인**: `[1] RSS 파서` ~ `[6] 구독 API 입력 검증` 아래 ✓ 11개, 마지막에 `모든 검증 통과 (11개)`.
이 단계가 통과하면 코드 자체는 정상입니다. 이후 단계는 외부 서비스 연결입니다.

---

## C. 외부 서비스 준비 (모두 무료 플랜)

### C-1. Supabase (데이터베이스)
1. https://supabase.com → 가입(GitHub 계정 권장) → `New project`
2. Name `regtide`, Database Password 임의의 강한 비밀번호(메모), Region `Northeast Asia (Seoul)` → `Create new project` (1~2분 대기)
3. 왼쪽 메뉴 `SQL Editor` → `New query`
4. VSCode에서 `supabase/schema.sql` 열기 → `Ctrl+A`, `Ctrl+C` → SQL Editor에 붙여넣기 → `Run`
   **확인**: `Success. No rows returned`
5. 왼쪽 `Table Editor` 에 `subscribers`, `updates`, `page_snapshots`, `deliveries` 4개 테이블 표시
6. 왼쪽 아래 톱니 `Project Settings` → `API Keys`
   - `Project URL` 복사 (예 `https://abcdefgh.supabase.co`)
   - **Secret key** 탭에서 `sb_secret_...` 키 복사 (`Reveal`/`Copy`). 없으면 `Create new API key` 로 생성.
   - `Legacy API keys` 탭의 `service_role` 키를 써도 동작합니다. **`anon` / `publishable` 키는 사용 금지.**

### C-2. Resend (이메일 발송)
1. https://resend.com → 가입 → `API Keys` → `Create API Key` (Name `regtide`, Permission `Sending access`)
2. `re_...` 키 복사 (한 번만 표시됨)
3. **테스트 단계**: 도메인 인증 없이 발신자 `onboarding@resend.dev` 사용 가능. 단 **Resend 가입 이메일로만** 수신 가능 → 테스트 구독 시 그 주소를 입력할 것.
4. **실서비스 단계**(나중에): `Domains → Add Domain` 에서 보유 도메인 등록 후 DNS에 SPF/DKIM 레코드 추가 → `MAIL_FROM` 을 그 도메인 주소로 변경.

### C-3. (선택) 국가법령정보센터 Open API
https://open.law.go.kr → 회원가입 → `OPEN API 신청` → 승인 후 사용자 ID를 `LAW_GO_KR_OC` 로 설정. 없으면 이 소스만 건너뜁니다.

---

## D. 환경변수 설정

### D-1. .env 파일 생성
1. VSCode 탐색기에서 `.env.example` 우클릭 → `복사`, 빈 곳 우클릭 → `붙여넣기`
2. 생성된 파일명을 `.env` 로 변경 (확장자 없음. `.env.txt` 가 되지 않도록 주의)
3. 내용을 채웁니다:
```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxxxxxx

RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
MAIL_FROM="RegTide <onboarding@resend.dev>"

CRON_SECRET=test-secret-1234
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
**확인**: 값에 앞뒤 공백·줄바꿈이 없고, 따옴표는 `MAIL_FROM` 에만.

### D-2. 소스 연결 확인 (DB 미사용)
```powershell
npx tsx --env-file=.env scripts/run-weekly.ts dry
```
**확인**: `■ 식약처 입법/행정예고 — N건` 아래에 최근 의료기기 관련 제목들, `■ US Federal Register (FDA) — N건`.
`HTTP 403`/`fetch failed` 가 나오면 네트워크(회사 방화벽·프록시) 문제입니다.

---

## E. 개발 서버 실행과 화면 확인

### E-1. 서버 시작
```powershell
npm run dev
```
**확인**: `✓ Ready in ...ms`, `Local: http://localhost:3000`. (포트가 사용 중이면 3001로 자동 변경 → `.env` 의 `NEXT_PUBLIC_SITE_URL` 도 3001로 맞출 것)

### E-2. 브라우저 테스트 — http://localhost:3000
1. 품목명 `개인용 저주파자극기`, 등급 `2등급` → `+ 품목 추가`
2. `+ 능동형 전기기기 (60601 시리즈)`, `+ 국내 허가 기본` 클릭 → 우측 상단 "N개 선택" 증가, 국가 탭에 숫자 배지
3. 개별 항목 칩을 클릭해 켜고 끄기, 국가 탭 전환 확인
4. 아래 3단계에서 이메일에 **Resend 가입 이메일** 입력
5. 동의 체크 **없이** 버튼 클릭 → 빨간 오류 메시지 확인
6. 동의 체크 후 `매주 월요일 업데이트 받기` → 초록 "구독이 완료되었습니다" 확인
7. Supabase `Table Editor → subscribers` 에 행 1개 생성, `catalog_ids` 에 선택 항목 ID 배열 확인
8. 하단 `개인정보 처리방침` 링크 → `/privacy` 페이지 열림 확인

이 터미널은 서버가 점유합니다. 다음 단계는 `터미널 → 새 터미널` 로 **두 번째 터미널**에서 진행.

---

## F. 파이프라인 실행 (수집 → 분류 → 발송)

### F-1. 수집
```powershell
npx tsx --env-file=.env scripts/run-weekly.ts collect
```
**확인**: `collect { fetched: N, inserted: N, skipped: [...], errors: [] }`. Supabase `updates` 테이블에 행 생성.
페이지 감시(ISO/IEC·EU) 소스는 첫 실행에 스냅샷만 저장하므로 0건이 정상.
`skipped` 는 사이트 차단(403)·URL 변경(404)으로 건너뛴 소스 목록이며 나머지는 정상 진행됩니다. iso.org 가 계속 403이면 `.env` 에 `DISABLED_SOURCES=page_watch:iso` 를 추가하세요. `errors` 는 그 외 실패(네트워크 등)입니다.

### F-2. 분류
```powershell
npx tsx --env-file=.env scripts/run-weekly.ts classify
```
**확인**: `classify { classified: N, matched: M, errors: [] }`. `updates` 테이블에서 `impact`, `catalog_ids`, `matched_keywords`, `summary_ko`(발췌) 채워짐. 식품·의약품 항목은 `impact = none`, `catalog_ids = []` 가 정상.

### F-3. 발송 (주중 테스트용 옵션 포함)
```powershell
npx tsx --env-file=.env scripts/run-weekly.ts send --recent --send-empty
```
- `--recent`: 집계 구간을 "최근 8일"로 (기본은 지난주 월~이번주 월이라 주중엔 비어 있음)
- `--send-empty`: 해당 항목이 없어도 발송 (템플릿 확인용)

**확인**: `send { sent: 1, skipped: 0, failed: [] }` → 1~2분 내 `[RegTide] 이번 주 의료기기 규제 업데이트 N건` 메일 도착.
`failed` 에 `You can only send testing emails to your own email address` → C-2의 제한. 가입 이메일로 구독했는지 확인.

### F-4. 재발송 테스트
같은 주에 이미 **성공** 발송했으면 `skipped: 1` (중복 방지). 실패(`failed`)·해당없음(`skipped_empty`) 건은 다음 실행에서 자동 재시도됩니다. 성공한 건을 다시 보내려면 Supabase `deliveries` 테이블의 해당 행 삭제 후 재실행.

---

## G. 크론 엔드포인트·수신거부 확인

### G-1. 크론 호출 (Vercel이 월요일에 보내는 요청과 동일)
PowerShell은 `curl` 이 별칭이므로 `curl.exe` 사용:
```powershell
curl.exe -H "Authorization: Bearer test-secret-1234" "http://localhost:3000/api/cron/weekly?recent=1&sendEmpty=1"
```
**확인**: `collect`/`classify`/`send` 결과가 담긴 JSON. 헤더 없이 호출하면 `{"error":"unauthorized"}`.

### G-2. 수신거부
받은 메일 하단 `수신거부` 클릭 → `localhost:3000/?unsub=ok` 로 이동하며 완료 메시지. Supabase `subscribers` 에서 행 삭제 확인.

---

## H. 프로덕션 빌드 확인

첫 터미널에서 `Ctrl+C` 로 개발 서버 종료 후:
```powershell
npm run build
npm run start
```
**확인**: `✓ Compiled successfully`, `Route (app)` 표에 `/`, `/privacy`, `/api/cron/weekly`, `/api/subscribe`, `/api/unsubscribe` 표시. http://localhost:3000 열림. 확인 후 `Ctrl+C`.

---

## I. Vercel 배포 (무료)

1. GitHub에 새 저장소 생성 → 프로젝트 push (`.env` 는 `.gitignore` 로 제외됨)
2. https://vercel.com → `Add New → Project` → 저장소 Import
3. `Environment Variables` 에 `.env` 의 6개 항목 입력. `NEXT_PUBLIC_SITE_URL` 은 배포 후 받을 도메인(예 `https://regtide.vercel.app`)
4. `Deploy` → 완료 후 도메인 접속 확인
5. `vercel.json` 의 크론(`0 0 * * 1` UTC = 월 09:00 KST)이 자동 등록됨. Vercel 대시보드 `Settings → Cron Jobs` 에서 확인
6. Hobby 플랜 함수 제한 60초: 소스가 늘어 초과되면 크론을 `?step=collect`, `?step=classify`, `?step=send` 3개로 나눠 5분 간격 등록
7. 실사용자 발송 전: Resend 도메인 인증 + `MAIL_FROM` 변경, `app/privacy/page.tsx` 의 **개인정보 보호책임자 성명·연락처** 기입

---

## 자주 만나는 문제

| 증상 | 원인·해결 |
|---|---|
| `'tsc'은(는) 내부 또는 외부 명령…` | `node_modules` 없음 → `npm install` |
| `--env-file` 인식 안 됨 | Node 20.6 미만 → Node 업데이트 |
| `환경변수가 설정되지 않았습니다` | `.env` 파일명이 `.env.txt` 이거나 값 누락 |
| `Invalid API key` (Supabase) | `anon`/`publishable` 키를 넣은 경우 → Secret key 로 교체 |
| 수신거부 링크가 잘못된 포트 | `NEXT_PUBLIC_SITE_URL` 과 실제 포트 불일치 |
| 메일 `failed` | Resend 테스트 모드는 가입 이메일로만 발송 가능 |
| 크론 호출 `unauthorized` | `Authorization: Bearer <CRON_SECRET>` 헤더 누락/불일치 |
