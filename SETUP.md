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
**확인**: `[1] RSS 파서` ~ `[6] 구독 API 입력 검증` 아래 ✓ 12개, 마지막에 `모든 검증 통과 (12개)`.
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
- `--recent`: 집계 구간을 "최근 8일"로 (기본은 "이번 주 월요일 00:00 KST 이후 저장된 항목"이라 주중에 새로 수집한 항목은 포함되지만, 지난주에 수집된 항목은 제외됨)
- `--send-empty`: 해당 항목이 없어도 발송 (템플릿 확인용)

**확인**: `send { sent: 1, skipped: 0, failed: [] }` → 1~2분 내 `[RegTide] 이번 주 의료기기 규제 업데이트 N건` 메일 도착.
`failed` 에 `You can only send testing emails to your own email address` → C-2의 제한. 가입 이메일로 구독했는지 확인.

### F-4. 재발송 테스트
같은 주에 이미 **성공** 발송했으면 `skipped: 1` (중복 방지). 실패(`failed`)·해당없음(`skipped_empty`) 건은 다음 실행에서 자동 재시도됩니다. 성공한 건을 다시 보내려면 Supabase `deliveries` 테이블의 해당 행 삭제 후 재실행.

---

## G. 크론 엔드포인트·수신거부 확인

### G-1. 크론 호출을 직접 흉내내기
Vercel 이 매주 월요일 09:00(KST)에 `/api/cron/weekly` 로 보내는 요청과 같은 요청을 로컬에서 보냅니다. PowerShell 은 `curl` 이 다른 명령의 별칭이므로 반드시 `curl.exe`.
```powershell
curl.exe -H "Authorization: Bearer test-secret-1234" "http://localhost:3000/api/cron/weekly?recent=1&sendEmpty=1"
```
**확인**: 10~40초 후 `"collect":{...}`, `"classify":{...}`, `"send":{...}` 세 부분이 담긴 JSON. 이미 이번 주 발송했다면 `send` 는 `skipped: 1` 이 정상.
보안 확인: 헤더 없이 `curl.exe "http://localhost:3000/api/cron/weekly"` → `{"error":"unauthorized"}`.
단계별 실행: `?step=collect` / `?step=classify` / `?step=send`.

> **주의**: 안내문의 `<CRON_SECRET>` 같은 꺾쇠괄호는 "값을 넣는 자리" 표시입니다. 실제 명령에는 괄호 없이 값만 넣습니다. 괄호까지 넣으면 `unauthorized`.

### G-2. 수신거부
1. 받은 메일 맨 아래 `수신거부` 링크 클릭 (개발 서버가 켜져 있어야 함)
2. `http://localhost:3000/?unsub=ok` 로 이동 + 초록 "수신거부가 완료되었습니다" 확인
3. Supabase `subscribers` 새로고침 → 해당 행 삭제됨 (`deliveries` 도 연쇄 삭제)
4. 같은 링크 재클릭 → `?unsub=invalid` + 빨간 오류 (토큰 재사용 불가 확인)
5. 이후 테스트를 위해 화면에서 다시 구독

---

## H. 프로덕션 빌드 확인

1. 개발 서버 터미널에서 `Ctrl + C` (Y 입력)
2. `npm run build` — **확인**: `✓ Compiled successfully`, `Route (app)` 표에 `/`, `/_not-found`, `/api/cron/weekly`, `/api/subscribe`, `/api/unsubscribe`, `/privacy`
3. `npm run start` → http://localhost:3000 정상 표시 확인 → `Ctrl + C`

---

## I. Vercel 배포 (무료)

### I-1. Git 설치·설정
```powershell
git --version              # git version 2.x 가 나와야 함. 없으면 https://git-scm.com/download/win
git config --global user.name "이름"
git config --global user.email "이메일"
```

### I-2. GitHub 저장소
https://github.com/new → Repository name `regtide`, **Private**, README/.gitignore/license 모두 체크 해제 → `Create repository` → `https://github.com/<아이디>/regtide.git` 복사.

### I-3. 첫 push
```powershell
git init
git add .
git status        # ★ .env, node_modules, .next 가 목록에 없어야 함 (있으면 중단하고 확인)
git commit -m "RegTide initial release"
git branch -M main
git remote add origin https://github.com/<아이디>/regtide.git
git push -u origin main
```
`git push` 시 브라우저 로그인 창 → GitHub 승인. `branch 'main' set up to track 'origin/main'` 이면 성공. GitHub 페이지 새로고침해 파일 확인.
(`LF will be replaced by CRLF` 경고는 Windows 줄바꿈 안내이며 무시해도 됩니다.)

### I-4. Vercel 프로젝트 생성
1. https://vercel.com → `Continue with GitHub` 로 가입 (Hobby, 무료)
2. `Add New… → Project` → `regtide` Import (안 보이면 `Adjust GitHub App Permissions`)
3. Framework Preset `Next.js` 자동 인식 확인
4. `Environment Variables` 입력 (따옴표 없이 값만):

| Key | Value | Type |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | **Config** (공개되어도 무방) |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | Secret |
| `RESEND_API_KEY` | `re_…` | Secret |
| `MAIL_FROM` | `RegTide <onboarding@resend.dev>` (I-6 후 변경) | Config |
| `CRON_SECRET` | **새 무작위 문자열 32자+** (로컬 값 재사용 금지) | Secret |
| `NEXT_PUBLIC_SITE_URL` | 배포 주소 (예 `https://regtide-pi.vercel.app`) | **Config** |
| `DISABLED_SOURCES` | iso.org 가 403이면 `page_watch:iso` | Config |

> `NEXT_PUBLIC_` 로 시작하는 변수를 `Secret` 으로 저장하면 "Remove the public framework prefix…" 빨간 경고가 뜹니다. 값이 URL이라 공개되어도 무방하므로 **Config** 가 맞습니다. 이미 Secret 으로 저장했다면 Config 로 변경이 불가하니 **삭제 후 Config 로 다시 생성** → Redeploy.

5. `Deploy` → 1~3분 → 배포 주소 확인

### I-5. 배포 후 마무리
1. **사이트 주소 확정**: `Settings → Domains` 의 실제 주소를 `NEXT_PUBLIC_SITE_URL` 에 반영(끝에 `/` 없이) → `Deployments → ⋯ → Redeploy`. 틀리면 메일의 수신거부 링크가 localhost 를 가리킴.
2. **크론 확인**: `Settings → Cron Jobs` 에 `/api/cron/weekly`, `0 0 * * 1` (UTC = 월 09:00 KST). 크론은 기본적으로 변경 사항이 없는 구독자에게도 "이번 주 변경 없음" 메일을 보냅니다(`?sendEmpty=0` 을 붙이면 변경 있을 때만 발송). Hobby 는 실행 시각이 수십 분 흔들릴 수 있음(주간 리포트라 무방). Vercel 이 `Authorization: Bearer <CRON_SECRET>` 를 자동 첨부.
3. **배포 서버에서 수동 실행**:
   ```powershell
   curl.exe -H "Authorization: Bearer 실제CRON_SECRET값" "https://<주소>/api/cron/weekly?recent=1&sendEmpty=1"
   ```
   **확인**: `collect`/`classify`/`send` JSON + 메일 도착. 헤더 없이 호출 → `unauthorized`. 로그는 Vercel `Logs` 탭.
4. **배포 주소에서 구독 테스트** → Supabase `subscribers` 에 들어오는지 확인.
5. **CRON_SECRET 교체**: 테스트 중 터미널·채팅 등에 노출된 값은 새 값으로 바꾸고 Redeploy.

### I-6. Resend 도메인 인증 (실사용자 발송 필수)
테스트 모드는 **Resend 가입 주소로만** 발송됩니다(`You can only send testing emails to your own email address`). 보유 도메인을 인증하면 누구에게나 발송 가능. 회사 대표 메일 평판과 분리하려면 하위 도메인(예 `mail.breathings.co.kr`) 권장.
1. https://resend.com/domains → `Add Domain` → `mail.breathings.co.kr` → `Add`
2. 표시되는 DNS 레코드(DKIM TXT, SPF TXT+MX, 선택 DMARC)를 도메인 관리 업체 DNS 설정에 추가. Name 칸에는 보통 `resend._domainkey.mail` 처럼 앞부분만 입력.
3. Resend 에서 `Verify` → 수 분~1시간 후 모두 `Verified`
4. Vercel `MAIL_FROM` → `RegTide <regtide@mail.breathings.co.kr>` 로 변경 → Redeploy. 로컬 `.env` 도 동일하게.
5. 다른 주소로 구독 후 I-5-3 명령 재실행 → 도착 확인

### I-7. 공개 전 마지막 점검
1. `app/privacy/page.tsx` 와 `app/disclaimer/page.tsx` 의 `[운영자 성명]`, `[이메일 주소]` 를 실제 값으로, 각 파일의 `<em>※ 서비스 운영자 정보를…</em>` 줄 삭제 → `git add .` → `git commit -m "Fill privacy officer"` → `git push` → Vercel 자동 재배포
2. Supabase Free 는 7일간 요청이 없으면 일시정지. 주간 크론이 깨워주지만 멈추면 대시보드에서 `Restore`.
3. 첫 몇 주 Vercel `Logs` 에서 월요일 크론 소요 시간 확인. 50초를 넘기면 `vercel.json` 크론을 3개로 분리: `?step=collect` `0 0 * * 1`, `?step=classify` `5 0 * * 1`, `?step=send` `10 0 * * 1`.

---

## J. 코드 수정 후 배포 흐름 (매번 동일)

```powershell
npm run selftest                 # 로컬 검증
git add .
git commit -m "변경 내용 요약"     # ★ commit 철자 주의
git push                         # Vercel 이 감지해 1~2분 내 자동 재배포
```
`git push` 가 `Everything up-to-date` 라고 하면 커밋이 만들어지지 않은 것. `git status` 로 확인:
- `Changes not staged for commit` → `git add .` 부터
- `Your branch is ahead of 'origin/main' by 1 commit` → 커밋은 됐고 push 만 안 됨 → `git push`
- `nothing to commit, working tree clean` → 파일 저장(`Ctrl+S`)을 안 했거나 수정 전

`git log --oneline -3` 으로 최근 커밋 확인. GitHub 저장소 페이지에서 커밋 메시지가 바뀌었는지 보는 것이 가장 확실.

**push 했는데 Vercel 이 자동 배포하지 않을 때**
1. GitHub 에 커밋이 실제로 올라갔는지 확인 (위)
2. Vercel `Settings → Git` → `Connected Git Repository` 가 `<아이디>/regtide` 인지, **`Production Branch` 가 `main`** 인지 (처음 `master` 로 시작했다면 `master` 로 잡혀 있을 수 있음 → `main` 으로 변경)
3. `Deployments` 탭 새로고침 — push 후 10~30초 뒤 `Building` 으로 나타남. `Error` 면 클릭해 로그 확인
4. 급하면 `Deployments → 최신 커밋 항목 → ⋯ → Redeploy` (반드시 최신 커밋인지 확인)

---

## 자주 만나는 문제

| 증상 | 원인·해결 |
|---|---|
| `'tsc'은(는) 내부 또는 외부 명령…` | `node_modules` 없음 → `npm install` |
| `--env-file` 인식 안 됨 | Node 20.6 미만 → Node 업데이트 |
| `환경변수가 설정되지 않았습니다` | `.env` 파일명이 `.env.txt` 이거나 값 누락 |
| `Invalid API key` (Supabase) | `anon`/`publishable` 키를 넣은 경우 → Secret key 로 교체 |
| `Could not find the 'matched_keywords' column` | 구 스키마로 테이블 생성됨 → SQL Editor 에서 `alter table updates add column if not exists matched_keywords text[] not null default '{}';` |
| `The yourdomain.com domain is not verified` | `.env` 의 `MAIL_FROM` 이 `.env.example` 자리표시자 그대로 → `RegTide <onboarding@resend.dev>` 로 변경 후 저장. 같은 키가 두 줄 있는지도 확인 |
| `You can only send testing emails to your own email address (…)` | Resend 테스트 모드 → 괄호 안 주소로 구독하거나 I-6 도메인 인증 |
| `send { skipped: 1 }` 인데 메일 못 받음 | 이번 주 이미 **성공** 발송 기록 있음 → `deliveries` 해당 행 삭제 후 재실행. (`failed`/`skipped_empty` 는 자동 재시도) |
| 크론 호출 `unauthorized` | 헤더 누락, `CRON_SECRET` 불일치, 값에 `< >` 괄호 포함, 환경변수 변경 후 Redeploy 안 함 |
| `collect` 의 `skipped` 에 iso.org 403 | 사이트가 자동화 차단. `DISABLED_SOURCES=page_watch:iso` 로 끄기. ISO 개정은 EU 조화규격·Federal Register 로 대체 감지 |
| Vercel "Remove the public framework prefix…" 경고 | `NEXT_PUBLIC_*` 를 Secret 으로 저장 → 삭제 후 Config 로 재생성 |
| `git: 'commint' is not a git command` | 오타. `git commit` |
| `git push` → `Everything up-to-date` | 커밋 안 됨 → J 절 참고 |
| 수신거부 링크가 localhost 를 가리킴 | Vercel `NEXT_PUBLIC_SITE_URL` 미수정 → 배포 주소로 변경 후 Redeploy |
