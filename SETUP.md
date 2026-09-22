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

## G. 크론 엔드포인트·구독해지 확인

### G-0. ★ 발송 안전장치 (구독자가 늘어난 뒤 필수 숙지)
크론 엔드포인트는 `?step=` 로 단계를 고릅니다. **메일이 나가는 것은 `step=send` 와 `step` 생략(all) 두 경우만**이며, `collect`·`classify` 는 DB만 채웁니다.

| 호출 | 결과 |
|---|---|
| `?step=collect`, `?step=classify` | 메일 없음. 언제든 안전 |
| `?step=send&only=이메일` | **그 한 명에게만** 테스트 발송. 제목에 `[테스트]`, `deliveries` 미기록(월요일 정기 발송에 영향 없음). 구독자가 아닌 주소면 전체 규격을 선택한 가상 구독자로 렌더링 |
| `?step=send` 또는 파라미터 없음 (수동 호출) | **거부(400)**. 전체 발송을 정말 원하면 `&confirm=all` 을 붙여야 함 |
| Vercel Cron 의 자동 호출 | `confirm` 없이도 전체 발송 (User-Agent 로 구분) |

로컬 스크립트도 동일: `run-weekly.ts send --only=이메일` 또는 `--confirm-all`.

### G-1. 크론 호출을 직접 흉내내기
Vercel 이 매주 월요일 09:00(KST)에 `/api/cron/weekly` 로 보내는 요청과 같은 요청을 로컬에서 보냅니다. PowerShell 은 `curl` 이 다른 명령의 별칭이므로 반드시 `curl.exe`.
```powershell
curl.exe -H "Authorization: Bearer test-secret-1234" "http://localhost:3000/api/cron/weekly?recent=1&sendEmpty=1&only=본인이메일"
```
(`only` 를 빼면 G-0 의 안전장치가 거부합니다. 전체 발송 테스트는 `&confirm=all`.)
**확인**: 10~40초 후 `"collect":{...}`, `"classify":{...}`, `"send":{...}` 세 부분이 담긴 JSON. 이미 이번 주 발송했다면 `send` 는 `skipped: 1` 이 정상.
보안 확인: 헤더 없이 `curl.exe "http://localhost:3000/api/cron/weekly"` → `{"error":"unauthorized"}`.
단계별 실행: `?step=collect` / `?step=classify` / `?step=send`.

> **주의**: 안내문의 `<CRON_SECRET>` 같은 꺾쇠괄호는 "값을 넣는 자리" 표시입니다. 실제 명령에는 괄호 없이 값만 넣습니다. 괄호까지 넣으면 `unauthorized`.

### G-2. 구독해지
1. 받은 메일 맨 아래 `구독해지` 링크 클릭 (개발 서버가 켜져 있어야 함)
2. `http://localhost:3000/?unsub=ok` 로 이동 + 초록 "구독해지가 완료되었습니다" 확인
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
1. **사이트 주소 확정**: `Settings → Domains` 의 실제 주소를 `NEXT_PUBLIC_SITE_URL` 에 반영(끝에 `/` 없이) → `Deployments → ⋯ → Redeploy`. 틀리면 메일의 구독해지 링크가 localhost 를 가리킴.
2. **크론 확인**: `Settings → Cron Jobs` 에 `/api/cron/weekly`, `0 0 * * 1` (UTC = 월 09:00 KST). 크론은 기본적으로 변경 사항이 없는 구독자에게도 "이번 주 변경 없음" 메일을 보냅니다(`?sendEmpty=0` 을 붙이면 변경 있을 때만 발송). Hobby 는 실행 시각이 수십 분 흔들릴 수 있음(주간 리포트라 무방). Vercel 이 `Authorization: Bearer <CRON_SECRET>` 를 자동 첨부.
3. **배포 서버에서 수동 실행**:
   ```powershell
   curl.exe -H "Authorization: Bearer 실제CRON_SECRET값" "https://<주소>/api/cron/weekly?recent=1&sendEmpty=1"
   ```
   **확인**: `collect`/`classify`/`send` JSON + 메일 도착. 헤더 없이 호출 → `unauthorized`. 로그는 Vercel `Logs` 탭.
4. **배포 주소에서 구독 테스트** → Supabase `subscribers` 에 들어오는지 확인.
5. **CRON_SECRET 교체**: 테스트 중 터미널·채팅 등에 노출된 값은 새 값으로 바꾸고 Redeploy.

### I-6. Resend 도메인 인증 (실사용자 발송 필수)
테스트 모드는 **Resend 가입 주소로만** 발송됩니다(`You can only send testing emails to your own email address`). 보유 도메인을 인증하면 누구에게나 발송 가능. 회사 대표 메일 평판과 분리하려면 하위 도메인(예 `news.breathings.co.kr`) 권장.
1. https://resend.com/domains → `Add Domain` → `news.breathings.co.kr` → `Add`
2. 표시되는 DNS 레코드(DKIM TXT, SPF TXT+MX, 선택 DMARC)를 도메인 관리 업체 DNS 설정에 추가. Name 칸에는 보통 `resend._domainkey.mail` 처럼 앞부분만 입력.
3. Resend 에서 `Verify` → 수 분~1시간 후 모두 `Verified`
4. Vercel `MAIL_FROM` → `RegTide <regtide@news.breathings.co.kr>` 로 변경 → Redeploy. 로컬 `.env` 도 동일하게.
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

## K. 운영 메모 (2026-09-19 기준)

### K-1. 현재 배포 상태
- 서비스 주소: https://regtide-pi.vercel.app (Vercel Hobby)
- 소스 저장소: https://github.com/ceo381/regtide (Private, 브랜치 `main`)
- DB: Supabase Free (`subscribers`, `updates`, `page_snapshots`, `deliveries`)
- 메일: Resend Free — **아직 테스트 모드**. 도메인 미인증 상태라 `ceo@breathings.co.kr` 로만 발송됨 → I-6 완료 전까지 다른 구독자에게는 `failed` 기록
- 크론: 매주 월요일 00:00 UTC(09:00 KST) `/api/cron/weekly` 자동 실행
- 정식 테스트를 위해 DB 를 비우고 구독 1건을 등록한 상태 (2026-09-19)

### K-2. 발송 정책
- 크론은 **변경 사항이 없어도** 구독자에게 "이번 주에는 선택하신 규격·인증에 해당하는 변경 사항이 감지되지 않았습니다" 메일을 보냄 (`sendEmpty` 기본 ON). 끄려면 Vercel `Settings → Cron Jobs` 경로를 `/api/cron/weekly?sendEmpty=0` 으로.
- 집계 구간: **이번 주 월요일 00:00 KST 이후 저장된 항목**. 월요일 09:00 크론이 방금 수집한 항목이 포함되고, 지난주 크론이 수집한 항목은 제외되어 중복이 없음.
  (초기 버전은 "지난주 월~이번주 월" 구간을 써서 월요일 수집분이 빠져 메일이 항상 비어 나가는 결함이 있었음 → 2026-09-19 수정. `scripts/selftest.ts` 의 "월요일 크론 시나리오" 테스트가 이를 검증)
- 이메일 상단 표시 기간은 "지난주 월 ~ 일".
- 같은 주에 `sent` 기록이 있으면 재발송하지 않음. `failed`/`skipped_empty` 는 다음 실행에서 자동 재시도.

### K-3. 첫 정기 발송(월요일) 확인 방법
1. 월요일 09:00~10:00 KST 사이에 `ceo@breathings.co.kr` 수신함(스팸 포함) 확인
2. Vercel 프로젝트 → `Logs` 탭에서 `/api/cron/weekly` 실행 기록과 소요 시간 확인 (50초 이상이면 I-7-3 의 크론 분리 필요)
3. Supabase `deliveries` 테이블: `week_start` 가 그 주 월요일, `status` 가 `sent` 이면 성공. `failed` 면 `error` 열에 원인.
4. `updates` 테이블에 지난 8일치 항목이 들어왔는지, `impact`/`catalog_ids` 가 채워졌는지 확인
5. 메일이 오지 않았고 `deliveries` 도 비어 있으면 크론이 실행되지 않은 것 → Vercel `Settings → Cron Jobs` 등록 여부 확인, 수동 실행:
   ```powershell
   curl.exe -H "Authorization: Bearer 실제CRON_SECRET값" "https://regtide-pi.vercel.app/api/cron/weekly"
   ```

### K-4. 구독해지
- 사용자: 매주 메일 하단 **구독해지** 링크 → 토큰 일치 시 `subscribers` 행 즉시 삭제(이메일 포함), `deliveries` 연쇄 삭제 → 홈으로 이동해 "구독해지가 완료되었습니다" 표시. 같은 링크 재클릭 시 "유효하지 않은 구독해지 링크".
- 운영자 수동 처리: 아직 메일을 받지 못한 구독자(구독 직후 등)는 링크가 없으므로 Supabase `Table Editor → subscribers` 에서 해당 행 삭제.
- 향후 개선 후보: 홈페이지에 "이메일 입력 → 구독해지 링크 재발송" 폼 (`/api/unsubscribe/request`).
- 용어: 서비스 전반에서 "수신거부" 대신 **"구독해지"** 로 통일 (2026-09-19).

### K-5. 면책·개인정보 페이지
- `/disclaimer` 이용 안내 및 면책조항 (`app/disclaimer/page.tsx`): 참고용 정보·법적 효력 없음·원문 확인 의무·누락/지연 가능성·책임 제한·저작권·서비스 변경/중단·구독해지·문의. **AI 관련 표현 없음**("정해진 규칙에 따라 자동으로 수집·분류").
- `/privacy` 개인정보 처리방침 (`app/privacy/page.tsx`)
- 이메일 하단과 홈페이지 푸터에 요약 면책 문구 + 두 페이지 링크
- 운영자 정보 기입 완료: 이인표 / ceo@breathings.co.kr (두 페이지 모두)

### K-6. 남은 할 일
- [ ] Vercel 자동 배포 점검 (`Settings → Git` Production Branch = `main`) — push 후 `Deployments` 에 새 항목이 생기는지 확인
- [ ] Resend 도메인 인증(`news.breathings.co.kr`) → `MAIL_FROM` 변경 → 실사용자 발송 가능 (I-6)
- [ ] 테스트 중 노출된 `CRON_SECRET` 새 값으로 교체 → Redeploy
- [ ] Vercel 환경변수 `DISABLED_SOURCES=page_watch:iso` 추가 (iso.org 403 로그 제거)
- [ ] 첫 월요일 크론 결과 확인 (K-3)
- [ ] 사용자 피드백에 따라 `lib/catalog.ts` 키워드 조정

---

## L. 운영자 리포트 (2026-09-21 추가)

운영자(기본 `ceo@breathings.co.kr`)에게 구독자 현황을 자동으로 보내는 기능입니다. 일반 구독자 발송과 무관하며, 환경변수만 있으면 동작합니다.

### L-1. 두 가지 알림
| 종류 | 시점 | 내용 |
|---|---|---|
| 일일 리포트 | 매일 08:00 KST (Vercel Cron `0 23 * * *`, `/api/cron/daily-report`) | 활성 구독자 수, 최근 24시간 신규 구독자(이메일·품목·규격 수), 24시간 수집 건수(관할별), 이번 주 발송 상태, **구독자 구성(회사 도메인 수·개인 메일 수)과 "같은 회사 2명 이상" 도메인(조직 내 확산 지표, 개인 메일·운영자 도메인 제외)**, 많이 선택된 규격 Top 8, 수집 소스 상태 |
| 마일스톤 알림 | 신규 구독으로 활성 구독자가 **N의 배수**(기본 10)가 되는 즉시 | 제목 `[RegTide 운영] 🎉 구독자 N명 달성` + 위와 같은 현황 |

- 마일스톤은 "정확히 N명"이 아니라 **마지막 알림 이후 새 N 구간을 넘었는지**로 판정합니다(9→11명이면 10명 알림). 마지막 알림 구간은 `page_snapshots` 테이블의 `admin:milestone_notified` 행에 저장되며, 신규 구독 직후와 매일 아침 크론에서 확인하므로 배포 전에 이미 넘긴 구간이나 발송 실패분도 다음 확인 때 따라잡습니다.
- 알림 발송이 실패해도 구독 처리는 정상 완료됩니다(오류는 Vercel Logs 에 `[admin-report]` 로 기록).
- Vercel Hobby 는 크론 2개까지 무료이며, 이 프로젝트는 정확히 2개(주간 다이제스트 + 일일 리포트)를 사용합니다. Hobby 크론은 지정 시각 기준 1시간 안에 실행되므로 08:00~09:00 사이에 도착합니다.

### L-2. 설정 (선택)
Vercel `Settings → Environment Variables` 에 필요 시 추가 후 Redeploy:
```
ADMIN_EMAIL=ceo@breathings.co.kr   # 리포트 수신 주소 (미설정 시 이 값)
MILESTONE_EVERY=10                 # N명마다 알림 (미설정 시 10)
```
**안전장치**: 수신자가 `@breathings.co.kr` 도메인이 아니면 발송을 거부합니다(`ADMIN_EMAIL_DOMAIN` 으로 변경 가능). 운영 리포트가 구독자에게 갈 수 있는 경로는 코드상 없습니다. 발신자는 기존 `MAIL_FROM` 을 그대로 씁니다. Resend 도메인이 인증되어 있어야 하며, 미인증(`onboarding@resend.dev`) 상태라도 수신자가 Resend 가입 이메일이면 도착합니다.

### L-3. 수동 테스트
```powershell
curl.exe -H "Authorization: Bearer <CRON_SECRET값>" "https://regtide-pi.vercel.app/api/cron/daily-report"
```
**확인**: `{"ranAt":"...","milestone":{"sent":true|false,"total":N,"milestone":10},"daily":{"id":"...","totalActive":N,"newSubscribers":M}}` 응답 후 1~2분 내 메일 도착. 마일스톤 미발송분이 있으면 `🎉 구독자 10명 달성` 메일이 함께 옵니다.
마일스톤만 확인: 뒤에 `?only=milestone` 을 붙입니다. 알림을 다시 받아보려면 Supabase SQL `delete from page_snapshots where source_key = 'admin:milestone_notified';` 후 재호출.

### L-4. 관련 파일
`lib/admin-report.ts`(통계 집계·HTML·발송), `app/api/cron/daily-report/route.ts`(크론 엔드포인트), `app/api/subscribe/route.ts`(신규 구독 시 마일스톤 판정), `vercel.json`(크론 2개).

---

## M. 고객 피드백 반영 (2026-09-22)

첫 고객 피드백 3건을 이메일과 랜딩 페이지에 반영했습니다.

| 피드백 | 반영 위치 |
|---|---|
| 출처 표기 | 각 항목 아래 `출처: 발행기관(링크) · 소스 채널명`. 메일 하단 "이번 메일의 출처" 목록(이번 메일에 실제 포함된 소스만) |
| 발표 일시·수집 일시 | 각 항목에 `기관 발표일시: … KST · RegTide 수집: … KST`. 기관이 날짜만 제공하는 소스(Federal Register 등)는 날짜만 표시. 페이지 감시 소스(EU·ISO·IEC)는 기관 발표 시각이 없으므로 `변경 감지일시` 로 표기. 헤더에 `리포트 생성 … KST` 추가 |
| 지원 국가 표기 | 메일 헤더 `모니터링 대상: 한국(…) · 미국(…) · 유럽연합(…) · 국제규격(…)`, 랜딩 페이지 상단 4개 카드, 하단 안내문 |

관련 파일: `lib/source-info.ts`(출처 메타데이터·지원 국가 목록 `COVERAGE`), `lib/digest.ts`(메일 템플릿), `app/page.tsx`·`app/globals.css`(랜딩), `scripts/selftest.ts`(표기 검증 추가).
새 소스를 추가할 때는 `lib/source-info.ts` 의 `STATIC` 에 출처 정보를 함께 등록해야 합니다(없으면 소스 키가 그대로 표시됨).

---

## N. 수집 범위 보강·소스 상태 가시화·수집 기간 표기 (2026-09-22)

런칭 후 DB 점검 결과, 정기 발송 대상 항목이 주당 1~2건에 그쳐 **수집 범위**가 병목임이 확인되었습니다(식약처 입법/행정예고 RSS는 최근 2개월치 23건 중 의료기기 관련이 5건 수준). 다음을 반영했습니다.

### N-1. 식약처 RSS 피드 5 → 11개
| brdId | 피드 | 비고 |
|---|---|---|
| data0009 | 입법/행정예고 | 기존 |
| data0005 | 고시전문 | 기존 |
| **data0006** | 훈령전문 | 신규 · impact medium |
| **data0007** | 예규전문 | 신규 · impact medium |
| data0013 | 안내서/지침 | 기존 |
| **ntc0003** | 공지 | 신규 |
| ntc0004 | 공고 | 기존 |
| **ntc0021** | 보도자료 | 신규 (의료기기 관련만 통과) |
| **seohan001** | 안전성 서한 | 신규 · impact medium |
| plc0139 | 의료기기 회수/판매중지 | 기존 · low |
| **plc0168** | 의료기기 행정처분 | 신규 · low (`kr-vigilance` 에만 연결) |

모든 피드는 제목·본문 앞부분에 의료기기 관련어(`의료기기|체외진단|디지털의료|의료용|의료제품|GMP|UDI|표준코드|사이버보안|임상시험|SaMD…`)가 있어야 저장됩니다. 식약처 RSS 전체 목록: https://www.mfds.go.kr/www/rss/list.do

### N-2. 소스 상태 가시화
- 수집 결과에 **소스별 건수(`bySource`)** 가 추가되었고, 마지막 수집 결과가 `page_snapshots` 의 `admin:last_collect` 행에 JSON 으로 저장됩니다.
- 일일 운영 리포트(L절)에 **"수집 소스 상태 (마지막 수집)"** 섹션이 추가되어, 소스별 건수(0건은 주황색)·건너뜀·오류를 매일 아침 확인할 수 있습니다. 특정 소스가 여러 주 0건이면 피드 구조 변경·차단을 의심하세요. 페이지 감시 소스(EU·ISO·IEC)는 변경이 없으면 0건이 정상입니다.
- 크론 응답 JSON 의 `collect.bySource` 로도 확인 가능.

### N-3. 메일에 "정보 수집 기간" 표기 (고객 피드백)
헤더에 `정보 수집 기간: {실행-8일} ~ {실행 시각} KST (이 기간에 각 기관이 발표·게재한 항목, 8일) · 리포트 생성: {실행 시각}` 이 추가되었습니다. 되돌아보는 일수는 `lib/collect.ts` 의 `COLLECT_LOOKBACK_DAYS`(=8) 한 곳에서 관리하며 크론과 메일이 같은 값을 씁니다.

### N-3b. Federal Register "오류 없이 0건" 대응 (2026-09-22)
배포 후 `bySource.federal_register: 0`(errors 없음)이 관측됨. API 는 정상(최근 1주 의료기기 문서 5건 이상)이므로 질의 파라미터 문제로 판단하고 어댑터를 보수적으로 재작성: 검색어별(`"medical device"`, `"medical devices"`, `"in vitro diagnostic"`) 개별 질의 후 중복 제거, 날짜를 `MM/DD/YYYY` 로 전달, 문서 유형 `RULE/PRORULE/NOTICE` 로 한정, 그리고 **응답이 비정상(count 없음, count>0 인데 results 빈 배열)이면 예외**를 던져 운영 리포트 `errors` 에 드러나게 함. 재배포 후 `?step=collect` 로 `federal_register` 가 0 이 아닌지 확인.

### N-3c. 발송 규모 대응 — 배치 발송 (2026-09-22, 구독자 90명 시점)
- 구독자 1명당 Resend API 1회 호출(순차) 방식은 구독자 100명 전후에서 Vercel 함수 시간 제한(60초)에 걸릴 수 있어, **Resend batch API 로 50통씩 묶어 발송**하도록 변경했습니다(`lib/digest.ts`). 배치 호출이 실패하면 그 묶음만 개별 발송으로 자동 대체합니다.
- 발송 전 `deliveries` 를 한 번만 조회하고, 기록도 묶어서 upsert 하므로 DB 호출 수가 구독자 수에 비례하지 않습니다.
- **Resend 무료 플랜은 하루 100통 · 월 3,000통.** 구독자 100명을 넘기 전에 Pro(월 $20, 5만 통)로 업그레이드해야 월요일 발송이 끊기지 않습니다. 일일 운영 리포트·마일스톤 알림도 이 한도에 포함됩니다.

### N-4. 아직 남은 보강 후보
- 국가법령정보센터 Open API 활성화: https://open.law.go.kr 가입 → OPEN API 신청(무료, 승인 1~2일) → Vercel 에 `LAW_GO_KR_OC=<아이디>` 추가 → Redeploy. 의료기기법·시행령·시행규칙·고시 개정을 법령 단위로 잡습니다.
- 의료기기안전정보포털(emedi)·의료기기정보기술지원센터 게시판(HTML 수집 필요).
- 식약처 게시판 목록 페이지 직접 수집(RSS 가 최근 N건만 제공하는 한계 보완).

---

## O. 관리자 대시보드 (2026-09-22)

`https://regtide-pi.vercel.app/admin` — 운영자 1명만 로그인하는 단일 계정 대시보드.

### O-1. 설정 (Vercel 환경변수 추가 → Redeploy)
```
ADMIN_USER=원하는아이디            # 미설정 시 admin
ADMIN_PASSWORD=긴-비밀번호          # ★ 필수. 없으면 /admin 전체가 비활성(로그인 화면에 안내만 표시)
ADMIN_SESSION_SECRET=랜덤문자열     # 선택. 없으면 CRON_SECRET 으로 세션 서명
```
로컬 `.env` 에도 같은 키를 넣으면 `npm run dev` 에서 http://localhost:3000/admin 으로 확인 가능.

### O-2. 보안 구조
- 비밀번호는 DB 에 저장하지 않고 환경변수와 상수시간 비교. 로그인 성공 시 **HMAC-SHA256 서명된 httpOnly 쿠키**(12시간) 발급, 서버 세션 저장 없음.
- 쿠키를 위조·변조하면 서명 검증에 실패해 로그인 화면으로 돌아감. 로그아웃은 쿠키 삭제.
- 로그인 시도는 IP 당 15분에 10회로 제한. `/admin` 전체에 `noindex`.
- 비밀번호를 바꾸려면 Vercel 환경변수 수정 → Redeploy (기존 세션은 쿠키 만료까지 유효. 즉시 무효화하려면 `ADMIN_SESSION_SECRET` 도 함께 변경).

### O-3. 화면 구성
| 탭 | 내용 |
|---|---|
| 상단 KPI | 활성 구독자(다음 마일스톤), 24시간 신규, 회사 도메인 수·개인 메일 수, 같은 회사 2명+ (조직 확산), 이번 주 발송 sent/failed/skipped |
| 개요 | 최근 14일 일별 신규 구독 막대, 많이 선택된 규격 Top 8, 수집 소스 상태(소스별 건수·건너뜀·오류) |
| 구독자 | 전체 목록(이메일·품목·규격 수·가입일·마지막 발송·상태), 검색, **비활성화**(발송 제외) / **삭제**(구독해지와 동일) |
| 수집 항목 | 최근 60건: 수집일·발표일·관할·영향도·제목(원문 링크)·출처·매칭 규격. "무관" 항목 점검용 |
| 발송 기록 | 이번 주 `deliveries` (시각·이메일·상태·항목 수·오류) |
| 운영 작업 | 수집 실행 / 분류 실행 / 테스트 다이제스트 → 운영자 / 운영 리포트 지금 발송. **전체 구독자 발송 버튼은 의도적으로 없음**(월요일 크론 전용) |

### O-4. 관련 파일
`lib/admin-auth.ts`(인증·세션), `lib/admin-data.ts`(대시보드 데이터), `app/admin/page.tsx`·`app/admin/login/page.tsx`·`app/admin/layout.tsx`(화면), `app/api/admin/login|logout|run/route.ts`(로그인·로그아웃·운영 작업), `app/globals.css`(`.admin*` 스타일).

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
| 구독해지 링크가 localhost 를 가리킴 | Vercel `NEXT_PUBLIC_SITE_URL` 미수정 → 배포 주소로 변경 후 Redeploy |
| push 했는데 배포 사이트에 내용이 반영 안 됨 | ① `git log --oneline -3` 와 GitHub 커밋이 같은지 ② Vercel `Settings → Git` 의 Production Branch 가 `main` 인지 ③ `Deployments` 에 새 항목이 생기는지 (J 절) ④ 브라우저 캐시 → `Ctrl+F5` |
| `/admin` 이 항상 로그인 화면으로 돌아옴 | `ADMIN_PASSWORD` 미설정(로그인 화면에 안내 표시), 또는 로컬 http 에서 `NEXT_PUBLIC_SITE_URL` 이 `https://` 로 시작해 Secure 쿠키가 저장되지 않는 경우 → 로컬 `.env` 의 `NEXT_PUBLIC_SITE_URL` 을 `http://localhost:3000` 으로 |
| 일일 운영 리포트가 안 옴 | Vercel `Settings → Cron Jobs` 에 `/api/cron/daily-report` 가 보이는지(vercel.json 반영은 배포 시), `MAIL_FROM` 도메인 인증 상태, `ADMIN_EMAIL` 오타. L-3 으로 수동 호출해 오류 메시지 확인 |
| 월요일 메일이 비어 있거나 안 옴 | K-3 참고. `deliveries.status` 확인 (`sent`/`skipped_empty`/`failed`), Vercel `Logs` 에서 크론 실행 기록 확인 |
| `npm run selftest` 가 esbuild 플랫폼 오류 | Windows 에서 설치한 `node_modules` 를 다른 OS(WSL·리눅스)에서 실행한 경우 → 해당 OS 에서 `npm install` 다시 |
