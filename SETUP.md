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
1. 받은 메일 맨 아래 `구독해지` 링크 클릭 (개발 서버가 켜져 있어야 함) → **확인 페이지**가 열림 (이 단계에서는 삭제되지 않음. 메일 보안 스캐너가 링크를 자동으로 열어도 안전)
2. 확인 페이지의 `구독해지` 버튼 클릭 → `http://localhost:3000/?unsub=ok` 로 이동 + 초록 "구독해지가 완료되었습니다" 확인
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
| 일일 크론 | 매일 08:00 KST (Vercel Cron `0 23 * * *`, `/api/cron/daily-report`) — **수집+분류 → 마일스톤 확인 → 리포트** | 활성 구독자 수, 최근 24시간 신규 구독자(이메일·품목·규격 수), 24시간 수집 건수(관할별), 이번 주 발송 상태, **구독자 구성(회사 도메인 수·개인 메일 수)과 "같은 회사 2명 이상" 도메인(조직 내 확산 지표, 개인 메일·운영자 도메인 제외)**, 많이 선택된 규격 Top 8, 수집 소스 상태. 맨 위에 **상태 점검 결과**(P-2b) |
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

### N-3d. 국가법령정보 Open API 연결 (2026-09-22 승인)
- open.law.go.kr 신청 → **자동 승인**(신청 즉시 "승인·연결"). Vercel 환경변수 `LAW_GO_KR_OC` = 신청 시 입력한 **API인증키(OC)** 값 → Redeploy.
- 어댑터(`lib/sources/law-go-kr.ts`)를 P-1 A2 기준으로 보강: 응답이 HTTP 오류·JSON 아님(OC 오타 시 200 + HTML 안내 페이지)·알 수 없는 구조이면 조용히 0건이 아니라 **오류로 보고**. 질의 6개(법령/행정규칙 × 의료기기/체외진단의료기기/디지털의료제품)가 전부 실패하면 `errors` 에 첫 오류가 찍힘.
- 확인: 대시보드 운영 작업 → 수집 실행 → 개요 탭 "수집 소스 상태"에서 `법제처 국가법령정보센터 · 법령·행정규칙 Open API` 건수. 첫 실행은 8일 내 공포·발령된 의료기기 관련 법령·행정규칙이 없으면 0건이 정상(오류 없이).

### N-4. 아직 남은 보강 후보
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

### O-3b. 속도 개선 (2026-09-22)
- 탭 전환이 매번 서버 왕복이라 느리다는 피드백 → **탭 전환·구독자 검색을 브라우저 안에서 처리**(`AdminTabs.tsx`, `SubscriberTable.tsx`). 데이터는 첫 로드 때 한 번만 받고, 탭은 보이기/숨기기만 하므로 즉시 바뀝니다. 선택한 탭은 URL 해시(`#subscribers`)로 유지되어 작업 후 리다이렉트에도 남습니다.
- 대시보드·운영 리포트의 Supabase 조회 9회를 **병렬**로 바꿔 왕복을 1~2회로 줄임.
- `vercel.json` 에 `"regions": ["icn1"]`(서울) 추가 — Supabase 가 서울이라 함수를 같은 리전에 두면 왕복 지연이 크게 줄어듭니다. 크론·구독 API 도 함께 빨라집니다.
- 헤더 우측에 `로드 NNNms`(서버 데이터 로딩 시간)를 표시해 체감 속도 문제를 진단할 수 있게 함. `새로고침` 버튼으로 최신 데이터 재조회.

### O-4. 관련 파일
`lib/admin-auth.ts`(인증·세션), `lib/admin-data.ts`(대시보드 데이터), `app/admin/page.tsx`·`app/admin/AdminTabs.tsx`·`app/admin/SubscriberTable.tsx`·`app/admin/login/page.tsx`·`app/admin/layout.tsx`(화면), `app/api/admin/login|logout|run/route.ts`(로그인·로그아웃·운영 작업), `app/globals.css`(`.admin*` 스타일).

---

## P. ★ 상시 검증 기준 — 수집 누락 방지 · 면책 고지 (2026-09-22 확정)

운영자 지시: 이 프로젝트에서 가장 중요한 두 가지는 **① 데이터를 놓치지 않고 수집하는 것**, **② 면책 조항 관련 사항**이다. 이후 모든 코드 변경은 아래 체크리스트로 두 항목에 미치는 영향을 검증하고, 결과에 명시한다.

### P-1. 수집 누락 방지 체크리스트
| # | 확인 항목 | 확인 방법 |
|---|---|---|
| A1 | 새 소스를 추가/변경했으면 `lib/source-info.ts` 에 출처가 등록되어 있는가 | `npm run selftest` → "[핵심 검증 A] 모든 수집 어댑터가 출처 메타데이터에 등록" |
| A2 | 소스가 **오류 없이 0건** 을 조용히 반환할 수 있는 경로가 있는가 (가장 위험) | 응답 검증 로직(Federal Register 처럼 count/results 불일치 시 예외) 유지. 새 어댑터도 같은 원칙 |
| A3 | 수집 주기가 소스의 노출 창보다 짧은가 | RSS 는 최근 20~30건만 제공 → **매일 수집**(일일 크론) + 8일 되돌아보기. 발송은 월요일만 |
| A4 | 연속 0건 소스가 경보되는가 | 수집 이력(최근 30회)에서 페이지 감시 외 소스가 7회 연속 0건이면 일일 리포트에 "수집 누락 경보" |
| A5 | 수집 실패가 다른 단계를 막지 않는가 | 일일 크론은 수집 실패 시에도 리포트를 보내고 `collectError` 로 원인 노출 |
| A6 | `skipped`/`errors` 가 비어 있는지, `bySource` 에 예상 소스가 모두 있는지 | 크론 응답 JSON 또는 대시보드 "수집 소스 상태" |

### P-2. 면책·고지 체크리스트
| # | 확인 항목 | 확인 방법 |
|---|---|---|
| B1 | 구독자에게 나가는 **모든** 메일에 면책 고지가 있는가 ("참고용", "법적 효력 없음", "원문 링크 확인", "책임은 이용자", `/disclaimer` 링크, 구독해지 링크) | `npm run selftest` → "[핵심 검증 B]" 가 발송된 모든 메일을 검사 |
| B2 | 면책 문구와 공개 페이지(랜딩·/disclaimer·/privacy)에 **AI 언급이 없는가** | selftest 정규식 + `grep -n "AI\b\|인공지능" app/` (품목 예시 "영상진단 AI 소프트웨어"는 허용) |
| B3 | "수신거부" 대신 "구독해지" 만 쓰는가 | selftest |
| B4 | 항목마다 출처(발행 기관·링크)·발표/감지 일시·수집 일시가 있는가 (저작권·출처 표기) | selftest "모든 항목에 출처·일시 표기" |
| B5 | 운영자 리포트가 구독자에게 갈 수 있는 경로가 없는가 | `ADMIN_EMAIL()` 도메인 가드(@breathings.co.kr 외 거부) |
| B6 | 구독자 개인정보를 동의 목적(주간 발송) 외로 쓰는 기능을 추가하지 않았는가 | 코드 리뷰. 인터뷰 요청 등은 정기 메일 안에서만 |
| B7 | 면책·개인정보 페이지 문구를 바꿨으면 적용일자를 갱신했는가 | `app/disclaimer/page.tsx`, `app/privacy/page.tsx` 하단 |

### P-2b. 대시보드·리포트 "상태 점검" 패널 (2026-09-22)
문제가 생기면 운영자가 **대시보드 최상단**과 **일일 리포트 메일 상단**에서 바로 볼 수 있습니다 (`lib/health.ts`). 등급은 즉시(critical) / 확인(warning) / 참고(info).

| 영역 | 점검 항목 | 등급 |
|---|---|---|
| 면책·고지 | 실제 메일 템플릿을 렌더링해 "참고용"·"법적 효력 없음"·"원문 확인"·"책임은 이용자"·면책 전문 링크·구독해지 링크가 모두 있는지 / AI 언급 없음 / '수신거부' 미사용 | 즉시·확인 |
| 수집 | 마지막 수집 36시간 초과 / 소스 오류 / 소스 건너뜀 / 코드에 있는 소스가 결과에 없음 / 7회 연속 0건(페이지 감시 제외) / 3회 연속 0건(참고) / 24시간 넘게 미분류 항목 / 법령 API 미연결(참고) | 즉시·확인·참고 |
| 발송 | 이번 주 실패 건 / 월요일 10:00 KST 이후 발송 기록 없음 / 구독자 수가 메일 일일 한도(`RESEND_DAILY_LIMIT`, 기본 100) 근접·초과 / 발신 주소가 테스트용(resend.dev) | 즉시·확인 |
| 설정 | 사이트 URL 이 https 아님 (메일 링크 생성에 영향) | 확인 |

각 항목에 조치 방법(→)이 함께 표시됩니다. Resend Pro 로 올린 뒤에는 Vercel 에 `RESEND_DAILY_LIMIT=50000` 을 넣어 한도 경고를 끄세요.

### P-2c. 최종 점검에서 고친 것 (2026-09-22 저녁)
- **[수집 누락·중복 — 중대]** 일일 수집 도입으로 항목의 `created_at` 이 한 주에 흩어지는데, 월요일 발송 구간이 "이번 주 월요일 00:00 이후"라 **화~일요일 수집분이 전부 빠지는 버그**. → 후보 구간을 최근 14일로 넓히고, 구독자별로 **이미 보낸 항목(deliveries.update_ids)을 제외**해 누락도 중복도 없게 함(`lib/digest.ts`). 시나리오 테스트 추가.
- **[면책·고지 — 구독해지 안전]** 구독해지 링크가 GET 한 번에 삭제되어, 메일 보안 스캐너(Outlook Safe Links·Gmail 미리보기)가 링크를 자동으로 열면 본인 의사와 무관하게 해지될 수 있었음. → GET 은 확인 페이지, POST 로 삭제(`app/api/unsubscribe/route.ts`). 면책조항 7조·개인정보 처리방침·메일 문구 갱신, 적용일 2026-09-22.
- **[수집 안정성]** Federal Register·국가법령정보 요청에 타임아웃(25초/20초)이 없어 소스가 응답을 멈추면 크론이 60초 제한에 걸릴 수 있었음 → 타임아웃 추가.
- **[수집 — 오류 가시화]** 국가법령정보 어댑터가 비정상 응답을 조용히 0건 처리하던 것을 오류로 보고하도록 수정, OC 앞뒤 공백·따옴표 제거, 등록 도메인 Referer 전송.

### P-2d. 코드 리뷰(2차)에서 고친 것 (2026-09-22 저녁)
- **[수집 누락 — 중대]** 페이지 감시(EU·ISO·IEC)가 변경분을 DB 에 저장하기 **전에** 기준 스냅샷을 갱신해, 저장 실패·타임아웃 시 그 변경이 영구 누락될 수 있었음 → 어댑터가 `commit` 콜백을 돌려주고 `collect` 가 **저장 성공 후에만** 스냅샷을 옮김(`lib/sources/types.ts` FetchResult, `page-watch.ts`, `collect.ts`).
- **[수집 누락 — 중대]** 발송 기록을 전부 보낸 뒤 한 번에 저장해, 중간에 함수가 끊기면 이미 받은 사람이 다음 실행에서 또 받을 수 있었음 → 50통 묶음마다 즉시 기록.
- **[중복 발송]** Resend 배치 응답 개수 불일치 시 예외 → 개별 재발송 → 중복 가능 → 예외 대신 id 없이 기록.
- **[동시 실행]** 수동 호출과 크론이 겹치면 둘 다 발송 → 10분 만료 잠금(`page_snapshots` `admin:send_lock`, compare-and-swap).
- **[대량 데이터]** Supabase 기본 1,000행 한도로 구독자·발송기록·항목 조회가 조용히 잘릴 수 있었음 → `selectAll` 페이징 헬퍼(정렬 tiebreaker `id`)로 교체.
- **[크론 안정성]** 어댑터당 40초 상한(`withDeadline`), 국가법령정보 6개 질의 병렬화, 크론·운영 작업 `maxDuration=300`. 주간 크론은 수집·분류가 실패해도 **발송은 진행**(단계별 try/catch). 분류는 500건 넘어도 끝까지 반복(`classifyAll`).
- **[상태 점검 오탐]** "연속 0건" 판정을 **원본(필터 전) 건수** 기준으로 변경 — 피드는 살아 있는데 의료기기 항목만 없는 경우는 경보 아님. 예전에 항목이 오던 소스가 비면 즉시, 한 번도 없던 소스는 확인 등급. `LAW_GO_KR_OC` 미설정 시 해당 소스는 "비활성"으로 취급. 월요일 발송 누락 판정 시각 10:00→12:00.
- **[기타]** 소스 키 공유 시 건수 합산, 유입 채널 first-touch 필드별 유지, 구독해지 리다이렉트 URL 폴백, `mailFrom()` 통일, 관리자 비밀번호 비교 타이밍, 국가법령정보 공포일(KST 자정) 날짜만 표시.

### P-3. 이번 점검에서 고친 것
- **A3 위반 발견·수정**: 수집이 주 1회였음. 보도자료·공지처럼 게시가 많은 피드는 일주일 뒤 읽으면 의료기기 항목이 RSS 목록 밖으로 밀려 영구 누락될 수 있음 → 일일 크론(08:00 KST)이 **수집+분류**도 수행하도록 변경 (`app/api/cron/daily-report/route.ts`). 발송은 여전히 월요일 크론만.
- **A4 신설**: 수집 이력 누적(`admin:last_collect` 의 `history`)과 연속 0건 경보.
- **B1·B2·B3·B4·A1 을 자동 테스트로 고정**: `scripts/selftest.ts` "[핵심 검증 A/B]" 4개 추가 (총 18개). 이 테스트가 깨지면 배포하지 않는다.

---

## Q. 유입 채널 추적 (2026-09-22)

### Q-1. 사용법
- 안내 링크 뒤에 `?ref=코드` 를 붙입니다. 코드는 영문 소문자·숫자·`_`·`-` 만, 40자 이내. 예: `https://regtide-pi.vercel.app/?ref=openchat2`
- 그 링크로 처음 접속한 브라우저는 코드·접속 시각·이전 페이지 호스트를 기억했다가(localStorage) 구독 시 함께 보냅니다. 새로고침·다른 페이지를 거쳐도 유지됩니다.
- **최초 유입(first-touch) 고정**: 기존 구독자가 다른 링크로 설정을 바꿔도 처음 채널이 유지됩니다.
- 코드 명명 예: `openchat1`(첫 방) · `openchat2`… · `linkedin` · `kmdia` · `medinet` · `press-mdtoday` · `forward`(메일 하단 전달 링크) · `ktl`(파트너)

### Q-2. 기존 구독자 일괄 표시 (배포 후 1회)
첫 방(오픈채팅 1,632명)의 기존 구독자는 ref 가 비어 있으므로 Supabase SQL Editor 에서:
```sql
update subscribers set ref = 'openchat1' where ref is null and created_at < '2026-09-23';
```

### Q-3. DB 마이그레이션 (배포 전 필수)
```sql
alter table subscribers add column if not exists ref text;
alter table subscribers add column if not exists landed_at timestamptz;
alter table subscribers add column if not exists referrer text;
create index if not exists subscribers_ref_idx on subscribers(ref);
```
(컬럼이 없으면 구독 API 가 500 을 냅니다 → 반드시 배포 전에 실행)

### Q-3b. 채널 등록부 마이그레이션 (배포 전 필수, 2026-09-22 추가)
```sql
create table if not exists channels (
  code text primary key, name text not null, kind text not null default '기타',
  audience_size int, posted_at timestamptz, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table channels enable row level security;
```
(테이블이 없어도 대시보드는 열리지만 채널 만들기가 실패합니다)

### Q-4. 대시보드 "채널" 탭 — 채널 태그 관리
- **+ 새 채널**: 이름·코드(?ref= 값)·종류(오픈채팅/협회·조합/교육기관/매체/링크드인/커뮤니티/파트너/메일전달/기타)·대상 인원·게시 일시(KST)·메모를 입력하면 전용 링크가 만들어지고 **복사** 버튼으로 바로 씁니다. 코드는 나중에 바꿀 수 없으니(구독자 데이터와 연결) 이름은 자유롭게, 코드는 짧고 규칙적으로.
- 채널별 추적 표: 구독자·활성·**전환율(구독자÷대상 인원)**·**게시 후 경과**·**게시 후 24h/72h 내 구독 수**·회사/개인·24시간·7일·전환 소요·즉시 전환·3·4등급 비율. **상세**에서 링크·첫/마지막 구독·메모, **수정**으로 정보 갱신, **등록 삭제**는 등록부만 지우고 구독자의 채널 값은 남깁니다.
- ref 만 있고 등록되지 않은 코드는 "미등록"으로 표시되며 **등록** 버튼으로 바로 정보를 붙일 수 있습니다. 첫 방(`openchat1`)도 이 방법으로 이름·1,632명·게시일을 등록하세요.
- "(직접/미상)"은 ref 없이 들어온 구독자 묶음(링크·편집 없음).
- 일별 매트릭스의 열 이름은 채널 이름으로 표시됩니다.
채널별 구독자·활성·회사 도메인·개인 메일·24시간/7일 신규·첫/마지막 구독 시각·**전환 소요(링크 접속→구독 중앙값)**·**즉시 전환(10분 내 비율)**·품목/인·3·4등급 비율, 그리고 최근 14일 일별 채널 매트릭스. 구독자 탭에도 채널 컬럼과 검색이 추가됨.

### Q-5. 개인정보·면책 영향 (P절 검증)
- 수집 항목이 늘었으므로 `app/privacy/page.tsx` 표에 "유입 경로 코드·최초 접속 시각·이전 페이지 호스트(통계 목적, 개인 식별 불사용)" 행을 추가하고 적용일자를 2026-09-22 로 갱신했습니다.
- 수집 파이프라인·면책 문구는 변경 없음. selftest 20개 통과.

---

## R. 소스별 이용 조건 (상용화 검토용, 2026-09-22)

> 법률 자문이 아니며, 각 기관의 최신 이용약관을 기준으로 재확인이 필요합니다. 유료 전환 전 국가법령정보 공동활용(02-2109-6446)에 "현행법령·행정규칙 목록 API 를 유료 구독 서비스의 개정 알림에 사용" 을 확인받고, 신청 정보의 활용 목적을 유료 서비스로 갱신할 것.

| 소스 | 권리 주체 | 이용 조건 | RegTide 의 사용 방식 | 상업적 이용 |
|---|---|---|---|---|
| 식약처 RSS (입법예고·고시·공고·보도자료 등 11개) | 식품의약품안전처 | 공공누리 출처표시(제1유형) 계열. 출처 표기 | 제목·발췌·링크. 출처 "식품의약품안전처 (MFDS)" 표기 | 가능 |
| 국가법령정보 Open API (현행법령·행정규칙 목록) | 법제처 | "영리 목적의 이용을 포함하여 자유로운 활용 보장". **출처 미표기·타 기관 표기 시 제재**. 일부 API 는 상업적 이용 불가(판례·해석례 등 타 기관 자료) | 목록만 조회, 본문은 law.go.kr 링크. 출처 "법제처 국가법령정보센터" 표기 | 가능 (목록 API). 유료화 시 활용 목적 갱신 권장 |
| US Federal Register API | 미국 연방정부 (GPO/OFR) | 미국 정부 저작물 — 저작권 없음(퍼블릭 도메인). API 이용 제한 없음 | 제목·초록·링크 | 가능 |
| EU Commission 페이지 (MD latest updates, MDCG, 조화규격) | 유럽연합 집행위원회 | EU 재사용 정책(Decision 2011/833/EU): 출처 표시 조건 재사용 허용 | 변경 감지 문장 발췌·링크. 출처 "European Commission" 표기 | 가능 |
| ISO 규격 페이지 (iso.org) | ISO | 규격 **본문은 유료 저작물**. 웹페이지 메타정보(규격명·상태) 열람은 자유. 사이트가 자동화 접근을 403 으로 차단 중 | 제·개정 동향(제목·상태)만, 본문 미수록. 현재 `DISABLED_SOURCES` 로 비활성 | 동향 안내는 가능, 본문 재배포 불가 |
| IEC Webstore 페이지 | IEC | ISO 와 동일 (본문 유료) | 제·개정 동향만 | 동향 안내는 가능, 본문 재배포 불가 |
| Resend / Supabase / Vercel | 각 서비스 | 유료 플랜에서 상업적 이용 허용 (무료 플랜도 상업적 이용 금지 조항 없음. Resend 무료는 100통/일 한도) | 인프라 | 가능 |

면책조항 5조(저작권 및 출처)와 각 항목의 출처 표기가 위 조건을 충족하도록 유지할 것(P-2 B4).

---

## S. 폰트 (2026-09-22)
- 이메일(주간 다이제스트·운영 리포트)·구독해지 확인 페이지·웹사이트 전부 **Pretendard** 로 통일. CDN(jsdelivr, orioncactus/pretendard v1.3.9) 웹폰트 + 대체 순서 `Pretendard → Apple SD Gothic Neo → Malgun Gothic → sans-serif`.
- 메일 클라이언트 제약: Apple Mail·iOS Mail 등은 웹폰트를 내려받아 Pretendard 로 표시. **Gmail·Outlook 은 웹폰트를 차단**하므로 기기에 Pretendard 가 설치된 경우에만 적용되고, 아니면 시스템 한글 폰트로 대체됨(깨지지 않음). 모든 뉴스레터에 공통인 제약.

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

## T. 구독 확인 메일 (2026-09-22)

구독 신청 직후 **신청한 주소로 1회** 확인 메일을 보냅니다 (`lib/welcome.ts`, 호출 `app/api/subscribe/route.ts`).

- 신규 구독: `[RegTide] 구독이 완료되었습니다` / 기존 구독자의 설정 변경: `[RegTide] 구독 설정이 변경되었습니다`
- 내용: 발송 주기(매주 월요일 09:00 KST)와 첫 리포트 예정일, 등록 품목, 선택 규격·인증(관할별), 모니터링 대상 기관, 설정 변경 방법, 면책 고지, 구독해지 링크(2단계 확인)
- 악용 방지: 같은 주소로 1시간 안에 반복 신청하면 확인 메일을 다시 보내지 않음(구독 데이터는 갱신됨). IP 당 분당 10회 제한은 그대로.
- 메일 실패는 구독 처리에 영향 없음 — 응답 `welcome: sent | skipped | failed`, 실패 시 Vercel 로그에 `[subscribe] 구독 확인 메일 실패`
- 수신자는 신청자 본인뿐. 운영자 주소로 가지 않음.

**두 핵심 기준 점검**
- 수집: 영향 없음 (수집·분류·발송 코드 변경 없음)
- 면책·고지: 면책 문구를 `lib/email-common.ts` 한 곳으로 모아 주간 리포트와 확인 메일이 **같은 문구·같은 구독해지 안내**를 씀. 상태 점검(`checkDisclaimerTemplate`)이 두 템플릿을 모두 검사. 개인정보처리방침 1항 이용 목적에 "구독 신청 확인 메일 발송(신청 직후 1회, 설정 변경 시 1회)" 추가 — 동의 범위 안에서만 발송.
- selftest 23개 (구독 확인 메일 검증 추가)

## U. SEO (2026-09-22)

### 코드에 들어간 것
- `app/layout.tsx` — 검색용 제목·설명·키워드, canonical, Open Graph/Twitter 카드(`public/og.png` 1200×630), robots 허용, 사이트 소유 확인 메타(`GOOGLE_SITE_VERIFICATION`, `NAVER_SITE_VERIFICATION` 환경변수가 있을 때만 출력)
- `app/robots.ts` → `/robots.txt` (관리자·API 색인 제외), `app/sitemap.ts` → `/sitemap.xml` (공개 3페이지)
- `app/page.tsx` — 구조화 데이터(JSON-LD: Organization·WebSite·FAQPage), h1 에 "의료기기" 키워드, FAQ 6문항(`app/components/Faq.tsx`)
- 구독해지 확인 페이지·관리자 페이지는 noindex 유지

### 배포 후 할 일 (순서대로)
1. **커스텀 도메인** — `*.vercel.app` 은 검색 신뢰도가 낮고 도메인이 바뀌면 지금까지의 색인이 사라짐. `regtide.breathings.co.kr`(또는 별도 도메인)을 Vercel → Domains 에 추가하고 `NEXT_PUBLIC_SITE_URL` 을 새 도메인으로 바꾼 뒤 Redeploy. (메일의 구독해지·면책 링크도 이 값으로 생성되므로 **바꾼 뒤 테스트 다이제스트 1통 확인**)
2. **Google Search Console** — 속성 추가(URL 접두어) → HTML 태그 방식의 `content` 값을 `GOOGLE_SITE_VERIFICATION` 에 넣고 Redeploy → 확인 → 사이트맵 `https://<도메인>/sitemap.xml` 제출
3. **네이버 서치어드바이저**(searchadvisor.naver.com) — 국내 RA/QA 담당자는 네이버 검색 비중이 큼. 같은 방식으로 `NAVER_SITE_VERIFICATION` → 사이트맵 제출 → "웹 페이지 수집 요청"으로 랜딩 1회 수동 요청
4. 2주 뒤 Search Console 에서 색인 여부·노출 검색어 확인

### 다음 단계 (검색 유입의 실제 동력) — 공개 아카이브
지금 랜딩 한 페이지로는 "의료기기 규제 알림" 계열 소수 키워드만 노릴 수 있음. 검색 유입 대부분은 **개별 고시·개정 건 제목** 검색("○○ 고시 개정 입법예고", "MDCG 2026-x")에서 나오므로, 수집한 항목을 공개 페이지로 노출하는 것이 핵심:
- `/updates` 목록 + `/updates/[id]` 상세(제목·출처·발표일·발췌·원문 링크·관련 규격) → sitemap 자동 포함
- R 절의 이용 조건상 제목·발췌·링크에 출처 표기 형태는 모든 소스에서 허용됨(ISO/IEC 는 동향만). 면책 고지·출처 표기를 메일과 동일하게 각 페이지 하단에 둠
- 페이지마다 구독 폼을 붙여 검색 → 구독 전환. 채널 코드 `ref=search` 로 대시보드에서 효과 추적

## V. 대시보드 표 정렬 (2026-09-22)

구독자·채널·수집 항목·발송 기록 표의 열 제목을 누르면 브라우저에서 즉시 정렬됩니다(`app/admin/useSort.tsx`).
- 1회 클릭: 숫자·날짜 열은 큰 값부터, 문자 열은 가나다순 → 2회: 반대 방향 → 3회: 초기 정렬로 복귀
- 빈 값(—)은 방향과 무관하게 항상 맨 뒤. 동률은 원래 순서 유지
- 수집 항목 탭에 검색(제목·출처·규격)과 "무관 숨기기" 추가. 영향도는 즉시 조치 > 검토 > 참고 > 무관 순, 발송 상태는 실패 > 성공 > 해당없음 순
- 두 핵심 기준: 화면 표시 순서만 바뀌며 수집·분류·발송·면책 로직 무변경. selftest 24개(정렬 검증 추가)

## W. 품목명 선택 입력 + 등급별 기본 세트 (2026-09-22, 구독자 건의 반영)

### 변경
- 구독 폼: 품목 하나(2등급, 기본 세트 선택됨)가 미리 등록된 상태로 시작. 등급·유형 선택 → 이메일 → 동의만으로 구독 가능. 품목명은 "(선택)".
- 등급·유형별 기본 세트 `DEFAULT_CATALOG_BY_CATEGORY` (`lib/catalog.ts`): 국내 허가·GMP 공통 + 유형에서 확실히 따라오는 규격만. 해외(미국·EU)는 빠른 선택 세트로 남김. 등급을 바꾸면 기본 세트가 교체되고 직접 고른 항목은 유지.
- 규격 목록은 기본 접힘("규격 수정 (N개 선택)"). 선택된 항목은 요약 칩으로 항상 표시.
- 서버(`/api/subscribe`): `name` 은 빈 문자열 허용(최대 100자). DB 컬럼·기존 구독자 데이터 무변경. 표시 시 `productLabel()` 이 "2등급 품목 1" 처럼 대체 — 주간 리포트·확인 메일·운영 리포트·대시보드 모두 적용.
- `consent_version` "v1" → "v2" (동의 문구 변경 이력 추적용).

### 법적 검토 결과 (동의서·처리방침)
1. **필수/선택 항목 구분** (개인정보 보호법 제16조·제22조): 품목명이 선택 입력이 되면 "선택 항목"이므로 동의 문구에서 필수 항목과 분리해 표기하고, 미입력 시 서비스 이용에 제한이 없음을 명시해야 함 → 구독 폼 동의 박스·처리방침 1항 반영.
2. **자동 수집 항목 고지**: 유입 경로 코드(ref)·최초 접속 시각은 처리방침에는 있었으나 동의 박스에는 없었음 → 동의 박스에 "자동 수집" 줄 추가.
3. **수집 목적에 확인 메일 포함**: 동의 박스 목적란에 "구독 신청 확인 메일 발송(1회)" 추가 (처리방침은 T 절에서 반영됨).
4. **국외 이전 고지** (제28조의8 제1항 제3호): Supabase·Resend·Vercel 은 국외 사업자. 계약 이행을 위한 위탁·보관은 별도 동의 없이 처리방침 공개로 갈음할 수 있으나, 법정 기재사항(이전받는 자·국가·일시와 방법·항목·목적·보유기간)을 모두 적어야 함 → 처리방침 4-1항 신설. **Supabase 프로젝트 리전이 서울(ap-northeast-2)이 맞는지 Supabase → Project Settings → General 에서 확인 후, 아니면 4-1항의 국가 표기 수정 필요.**
5. **동의 문구 버전 기록**: 동의 내용이 바뀌었으므로 언제 어떤 문구에 동의했는지 구분되도록 `consent_version=v2` 저장. 기존 v1 구독자는 재동의 불요(수집 항목이 줄었고 목적 추가분은 계약 이행 범위 내 확인 메일뿐).
6. 이 변경으로 새로 수집하는 항목은 없음(오히려 축소). 면책조항 페이지는 변경 불요.

### 두 핵심 기준
- 수집: 무변경. 매칭은 catalog_ids 로만 이뤄지며 품목명은 표시 전용.
- 면책·고지: 메일 템플릿 문구 무변경(품목 표시 이름만 대체). 동의서·처리방침은 위 1~5 로 강화. selftest 24개(품목명 없음·기본 세트 검증 추가) 통과.

## X. 메일 전달 유입 장치 (2026-09-22)

주간 리포트·확인 메일에 전달 유입 링크 `${SITE}/?ref=fwd` 를 넣음 (`lib/email-common.ts` `forwardUrl`, `forwardedNoticeHtml`, `shareBlockHtml`).
- 리포트 상단: "이 메일을 동료에게 전달받으셨나요? 내 품목 기준으로 직접 받기" + **구독해지 링크는 원 수신자 전용** 경고 (전달받은 사람이 남의 구독을 해지하는 사고 방지 — 2단계 확인과 함께 이중 안전장치)
- 리포트 하단(항목 목록 뒤, 출처·면책 앞): 동료 전달 요청 블록 + 링크
- 확인 메일: 설정 변경 안내 옆에 전달용 링크 한 줄
- 대시보드 채널 탭에서 `fwd` 를 "메일전달" 종류로 **등록**하면 전환율 등이 집계됨(미등록이어도 ref 값은 저장·표시됨)
- 두 핵심 기준: 수집 무변경. 면책 문구 무변경(블록이 면책 섹션 앞에 위치, 상태 점검·selftest 통과). 메일 내용은 서비스 안내이므로 동의 범위(주간 리포트) 내.

## Y. 유입(방문) 집계 (2026-09-22)

**마이그레이션 필요** — Supabase SQL Editor 에서 `supabase/schema.sql` 맨 아래 `visits` 블록 실행. 실행 전에는 대시보드에 "집계 전 / visits 테이블 마이그레이션 필요"로 표시되며 다른 기능은 정상.

- 랜딩 페이지가 열릴 때 브라우저가 `/api/visit` 에 `{ref, referrer호스트}` 를 1회 전송 (`sessionStorage` 로 브라우저 세션당 1회). IP·쿠키·방문자 식별값은 **저장하지 않음** — 그래서 "고유 방문자"가 아니라 "방문(세션)" 수. IP 는 분당 30회 rate limit 에만 메모리로 쓰고 버림.
- 대시보드: KPI "유입 (24시간)" (7일·14일·누적), 개요 막대그래프 아래 파란 숫자 = 그날 유입, 채널 탭에 "유입 (14일)"·"방문→구독"(14일 신규 구독 ÷ 14일 방문) 열. 채널별 방문은 최근 14일 행 기준.
- 보유: 일일 크론이 180일 지난 행 삭제 (`VISITS_RETENTION_DAYS`). 개인정보처리방침 1항 "접속 통계" 행·2항 보유기간 문구 추가, 구독 폼 동의 박스 자동 수집 줄에 반영.
- 두 핵심 기준: 수집·발송 무변경. 고지: 식별 정보를 저장하지 않는 통계라 동의 대상이 아니지만 투명성을 위해 처리방침·동의 박스에 명시. selftest 25개(유입 집계 검증 추가).

## Z. 채널 탭 시계열 그래프 (2026-09-22)

`app/admin/TimeSeriesChart.tsx` (외부 라이브러리 없음, 인라인 SVG, 마우스 오버 툴팁·범례·선 끝 이름표). 채널 탭 "최근 14일 추이" 카드에 3개:
1. 유입 · 신규 구독 (일별) — 같은 단위(건수)라 한 축. visits 미마이그레이션 시 유입 선 생략
2. 채널별 신규 구독 (일별) — 구독자 많은 순 상위 3개 + 기타 (색 4개 고정 순서: dataviz 검증 팔레트)
3. 누적 구독자 — 구간 시작 전 누적 + 일별 신규
기존 일별 표는 그래프의 표 보기로 유지. 두 핵심 기준: 표시 전용, 무영향.

## AA. 구독해지 모니터링 (2026-09-22)

**마이그레이션 필요** — `supabase/schema.sql` 맨 아래 `unsubscribes` 블록 실행. 실행 전에는 해지 처리는 정상, 통계만 "집계 전" 표시.

- 해지(본인 `/api/unsubscribe` POST, 운영자 삭제) 직전에 `lib/churn.ts` `recordUnsubscribe` 가 **식별 불가 통계 한 줄**을 남기고 구독자 행은 즉시 삭제. 저장: 해지 시각, 구분(user/admin), 유입 채널, 구독 기간(일), 규격 수, 품목 등급·유형, 받은 리포트 수(sent 건수), 마지막 수신, 회사/개인 구분. **저장 안 함**: 이메일, 도메인, 구독자 id, 토큰, 품목명, IP. 통계 기록 실패는 해지를 막지 않음(로그만).
- 대시보드: KPI "구독해지 (7일)"(24시간·누적·7일 해지율 = 7일 해지 ÷ (활성 + 7일 해지)), 구독자 탭 상단 "최근 구독해지" 표(50건), 채널 탭 표 "해지" 열, 유입·신규 구독 그래프에 "구독해지" 점선.
- 상태 점검: 최근 7일 해지가 3건 이상이면서 활성 대비 5% 이상 → 확인, 10% 이상 → 즉시. 일일 운영 리포트에 "구독해지 24시간·7일" 줄.
- 고지: 개인정보처리방침 2항·면책조항 7조에 "식별 불가 해지 통계만 남김" 명시.
- 두 핵심 기준: 수집 무변경. 해지 = 즉시 삭제 원칙 유지(통계는 익명). selftest 25개(해지 통계에 식별 정보 없음 검증 추가).

## AB. 최종 점검 2차 (2026-09-22, 구독자 102명 시점) — 발견·수정 내역

### 핵심 기준 1 (수집 누락) 관련 수정
- **월요일 크론 실행 중 수집된 항목이 그날 메일에서 빠지던 문제**: 발송 후보 조회에 `created_at <= 크론 시작 시각` 상한이 있어, 같은 실행에서 수집→저장된 항목(저장 시각이 시작 시각보다 늦음)은 다음 주로 밀렸음. 상한 제거 (`lib/digest.ts`). selftest 는 저장 시각을 시작+30초로 바꿔 검증.
- **국가법령정보 API 부분 실패가 조용히 넘어가던 문제**: 6개 질의 중 일부(예: 행정규칙=식약처 고시 전체)만 실패해도 경고 없이 "정상"으로 보였음. 어댑터가 `warnings` 를 반환하고 collect → 상태 점검 "소스 부분 실패" 확인 등급으로 표시 (`lib/sources/types.ts`, `law-go-kr.ts`, `collect.ts`, `health.ts`).
- **식약처 RSS 필터가 본문 앞 500자만 검사**: 뒤쪽에서만 의료기기를 언급하는 통합 고시를 영구 누락할 수 있어 본문 전체 검사로 변경 (`mfds-rss.ts`).
- **발송 기록 실패가 조용히 넘어가던 문제**: deliveries/last_sent_at 기록 실패는 로그만 남았음 → `SendResult.recordErrors` 로 크론 응답에 포함되고, 상태 점검이 "발송 표시 N명 vs 기록 M건" 불일치를 즉시 등급으로 표시.
- **Resend 멱등 키 도입**: 주(week_start)+구독자 키로 개별 발송, 묶음은 구독자 목록 해시 키로 같은 키 2회 시도 후 개별 발송 대체 → 네트워크 오류 후 재시도해도 같은 주 안에서는 중복 발송되지 않음.
- 일일 크론: 수집 실패 시 분류까지 건너뛰던 것을 분리.

### 핵심 기준 2 (고지·동의) 관련 수정
- **"변경 없는 주" 안내 불일치**: 실제 동작은 변경 없는 주에도 "이번 주 변경 없음" 메일을 보내는데(런칭 시 결정, 기본값), 확인 메일·구독 폼·FAQ 에는 "보내지 않는다"고 적혀 있었음 → 세 곳을 실제 동작에 맞춤. (반대로 바꾸려면 `vercel.json` 크론 경로에 `?sendEmpty=0`)
- 확인 메일에 "본인이 신청하지 않았다면 구독해지 링크로 삭제" 안내 추가 (제3자가 남의 주소로 신청하는 경우 대비).
- 동의 박스 처리 위탁 목록을 처리방침과 일치(Supabase·Resend·Vercel, 국외), "운영자 내부 열람" 목적 명시. 처리방침 해지 통계 항목에 "마지막 리포트 수신 시각" 추가.
- 구독해지: 통계 행을 **삭제 성공 후** 기록하도록 순서 변경 (삭제 실패 시 유령 해지 방지).

### 기타
- canonical 을 페이지별로(랜딩 `/`, 처리방침, 면책) — 전 페이지가 `/` 를 canonical 로 선언하던 문제.
- 상태 점검의 발신 주소 확인이 `mailFrom()` 기본값을 못 보던 것 수정. 사이트 URL 끝 슬래시 정리.
- 유입 집계 `/api/visit` 는 같은 사이트에서 온 요청만 인정(Sec-Fetch-Site).
- 그래프 눈금 정수화, 정렬 3회 클릭 순환 정리, 발송 기록 탭 1000행 제한 해제.
- selftest 25개 통과 (배치 멱등 키·재시도 검증 갱신).

## AC. 로드맵 안내 — 신규 기능 소식으로 이탈 최소화 (2026-09-22)

- `lib/roadmap.ts` 한 파일이 랜딩 카드(`app/components/Roadmap.tsx`)와 메일 블록(`roadmapBlockHtml`)의 공통 데이터. 항목 수정·출시일(`released`) 기입은 여기서만.
- 랜딩: 히어로 아래 파란 안내("지금 필요한 기능이 없어도 이메일만 등록") + 구독 폼 아래 "RA·QA 실무를 위한 기능이 계속 추가됩니다" 카드(준비 중 1 · 검토 중 3).
- 메일: 주간 리포트(항목 목록 뒤, 전달 요청 앞)와 확인 메일에 "준비 중인 기능" 블록. 최근 21일 내 출시 항목이 있으면 "이번에 추가된 기능"으로 바뀜.
- **동의 범위**: 신규 기능 안내는 **주간 리포트 안에서만**(별도 메일 없음). 동의 박스 목적란과 처리방침 1항에 "리포트 안에 서비스 신규 기능 안내 포함" 명시. 유료 상품·타사 홍보는 광고성 정보가 되므로 로드맵에 넣지 말 것.
- 두 핵심 기준: 수집 무변경. 면책 문구 무변경, 새 기능 블록에 AI 언급 금지(selftest 검사). 25개 통과.
- 로드맵 항목 4개는 초안 — 운영자가 실제 계획에 맞게 수정할 것.

## AD. 기능 투표·건의 (2026-09-22) — AC 의 로드맵 카드를 대체

**마이그레이션 필요** — `supabase/schema.sql` 맨 아래 `vote_rounds / vote_options / votes / suggestions` 블록 실행. 시드로 **1차 라운드(후보 8개)** 가 자동으로 열린다. 실행 전에는 랜딩에 티저 문구만 보이고 투표 상자는 숨겨진다.

- 티저 문구(`lib/roadmap.ts`): "매주 월요일, 인허가·품질 담당자의 일이 하나씩 줄어듭니다" / "새 기능은 예고 없이 주간 리포트 안에서 먼저 열립니다. 지금 무료로 시작하세요." — 미래 무료 약속 없음(유료화 여지).
- 투표(`lib/votes.ts`, `/api/vote`, `app/components/VoteBox.tsx`): 라운드 단위. 복수 선택 + "목록에 없는 기능" 자유 입력(→ suggestions). **익명**: 이메일·IP·식별값 저장 안 함(브라우저 localStorage 에 "이 라운드 참여함" 표시만). 분당 5회 IP 제한(메모리), 같은 사이트 요청만 인정. 득표 공개는 라운드별 설정, 기본 **비공개**.
- 라이프사이클: 대시보드 "투표·건의" 탭 → 득표 확인 → 후보 "출시로 표시"(랜딩 "투표로 뽑혀 열린 기능" 이력 + 3주간 리포트 "여러분이 뽑은 기능이 열렸습니다") → 라운드 마감 → 새 라운드 열기(제목 + 후보 한 줄에 하나 "제목 | 설명"). 진행 중 라운드가 있으면 새 라운드 불가.
- 메일(`roadmapBlockHtml`): 주간 리포트·확인 메일 안에서만. 출시 소식 또는 티저 + "다음 기능 투표하기" 링크(`/#vote`). 별도 메일 없음.
- 일일 운영 리포트: "기능 투표·건의 (24시간)" 줄.
- 고지: 처리방침 1항에 "기능 투표·건의(익명)" 행. 자유 입력란에 개인정보를 적지 말라는 안내 + 대시보드에서 삭제 가능.
- 두 핵심 기준: 수집 무변경. 면책 문구 무변경, 메일 블록 AI 언급 금지(selftest). 26개 통과.

후보를 고른 이유와 "품목별 적용 규격 체크리스트"를 뺀 이유(지금 데이터로는 품목별 적용 규격을 가릴 수 없음)는 2026-09-22 대화 기록 참고.

### AD-1. 투표를 구독자 전용으로 (2026-09-23)
**마이그레이션 필요** — `schema.sql` 맨 아래 `alter table votes add column subscriber_id ...` 블록(3줄) 실행 (AD 의 테이블 생성 블록을 아직 안 했으면 그것부터).
- 랜딩: 투표 상자 제거. 티저 + "투표 진행 중"(후보 수, 참여 10명 이상이면 인원) + "구독하고 투표하기" 버튼(구독 폼으로 스크롤). 후보 내용은 비공개.
- 투표 페이지 `/vote?s=<구독자id>&t=<HMAC>` (`lib/vote-token.ts`, 키 = ADMIN_SESSION_SECRET 또는 CRON_SECRET). 확인 메일·주간 리포트의 개인 링크로만 진입. 토큰 불일치·해지 구독자 → 구독 안내 화면. noindex.
- 라운드당 1인 1회(서버 검증). 투표·건의 행에 `subscriber_id` 저장, 구독해지 시 DB cascade 로 함께 삭제. 처리방침 1항 문구 갱신("구독 정보와 연결, 해지 시 함께 삭제").
- 키를 바꾸면 지난 메일의 투표 링크가 무효가 되므로 ADMIN_SESSION_SECRET 은 유지할 것.

## AE. 식약처 수집 2중화 — RSS 장애 시 게시판 HTML 대체 · 회수/행정처분은 의료기기안심책방(emedi) 직접 수집 (2026-09-23)

배경: 식약처 RSS `plc0139`(회수/판매중지)가 "일시적으로 서비스를 이용하실 수 없습니다" HTML 만 돌려주는 상태가 이어져 상태 점검에 "7회 연속 빈 응답" 경고가 떴다. 회수·행정처분 원 데이터는 RSS 가 아니라 의료기기안심책방(emedi.mfds.go.kr)에 있다.

**마이그레이션·환경변수 없음.** 코드만 배포하면 된다.

1. **RSS → 게시판 HTML 대체 경로** (`lib/sources/mfds-board.ts`, `mfds-rss.ts`)
   - RSS 응답이 XML 이 아니면(오류 페이지·HTML) 같은 게시판의 HTML 목록을 대신 읽는다. 대응표: data0009→m_209, data0005→m_211(고시·훈령·예규 통합), data0013→m_1059, ntc0003→m_74, ntc0004→m_76, ntc0021→m_99, seohan001→m_1067. data0006/0007 은 m_211 에 함께 실리므로 0005 에만 연결(중복 저장 방지) — 이 두 피드만 장애면 소스 오류로 올라온다.
   - 항목 URL 이 RSS `<link>` 와 같은 `https://www.mfds.go.kr/brd/m_<n>/view.do?seq=<seq>` 형식이므로 `(source, external_id)` 중복 저장이 없다.
   - 게시판에는 본문이 없어 **제목만으로** 의료기기 여부를 판정한다(RSS 경로보다 보수적). 그래서 대체 수집이 일어나면 항상 상태 점검 경고로 남긴다: `식약처 RSS 일시 장애 페이지 → 게시판 HTML(m_209)로 대체 수집 (제목 기준 판정, 원본 N건 중 M건)`. 5페이지(50건) 상한, 넘으면 경고.
2. **의료기기안심책방 어댑터** (`lib/sources/mfds-emedi.ts`) — `mfds_rss:plc0139/plc0168` 제거, `mfds_emedi:recall`, `mfds_emedi:disps` 신설. `kr-vigilance` 규격에 연결.
   - 회수/판매중지: `POST /recall/list/MNU20265` 보고일자 범위(since−7일 ~ 내일), 10건/페이지, "총 N건" 기준 페이징. 항목키 `deptReceiptNo`, 제목 `[회수·판매중지] 품목명 — 업체명`, 발췌에 허가번호·회수 구분·진행 여부·보고일자 + 상세 페이지의 회수사유·위해성정도·회수방법·소비자 조치.
   - 행정처분: `POST /disps/MNU20266` 처분일자 범위(since−45일 ~ 내일; 공개가 처분보다 늦으므로 넉넉히), **공개일자** 기준으로 since 이후만 채택. 항목키 `portalAdmDispsSeq`, 제목 `[행정처분] 처분명(상세의 전체 문구) — 업체명`, 발췌에 업종·처분기간·위반법령·위반내용·처분내용.
   - 페이징: 두 화면 모두 `searchYn=true` 는 검색을 새로 시작해 항상 1페이지를 돌려주므로 2페이지부터는 `searchYn` 을 비운다(실측). 같은 페이지가 반복되면 무한 진행 없이 중단하고 경고를 남긴다.
   - 상세 페이지 조회는 항목당 1회(상한 40건). 실패해도 목록 정보로 항목을 남기고 경고만 올린다(누락 방지 우선). 검색 결과 표를 해석하지 못하면(화면 개편) 0건으로 넘기지 않고 소스 오류로 올린다. 세션 쿠키 없이도 동작함을 확인했고, 혹시 필요해질 경우를 대비해 첫 GET 의 Set-Cookie 를 이어서 보낸다.
3. 상태 점검: `expected` 소스 목록이 `allAdapters()` 에서 나오므로 새 키 2개가 자동으로 감시 대상이 되고, 제거된 plc 키는 더 이상 "빈 응답" 경고를 내지 않는다. 첫 수집 뒤 대시보드 소스별 건수에 `mfds_emedi:recall/disps` 가 보이면 정상.
4. 출처 표기(`describeSource`): "식품의약품안전처 (MFDS) · 의료기기안심책방 회수/판매중지 / 행정처분", 링크는 emedi 검색 화면. 면책 문구·동의·구독해지 로직 변경 없음.
5. 자체 테스트 2건 추가(총 28): RSS 오류 페이지 → 게시판 대체(경고·URL 형식·since 페이징·대응 게시판 없을 때 오류), emedi 표·상세 해석·페이징·상세 실패 시 유지·구조 변경 시 오류·행정처분 공개일자 기준.

배포 후 확인: 대시보드 "지금 수집" 1회 → 소스별 건수에 `mfds_emedi:recall`(최근 2주 회수 건수, 현재 기준 10건 안팎)·`mfds_emedi:disps` 가 잡히고 오류 0인지. 회수 항목이 `kr-vigilance` 를 고른 구독자에게만 매칭되는 것은 기존과 같다.

### AE-1. 후속 (2026-09-23 01:30 KST) — 메일 블록 문구 분리 · emedi 항목 분류 보정
- 메일의 새 기능 블록은 받는 사람이 이미 구독자이므로 랜딩 문구("지금 무료로 시작하세요")를 쓰지 않는다. `lib/roadmap.ts` 의 `EMAIL_*` 문구로 분리: "리포트는 매주, 기능은 하나씩 늘어납니다." / 투표 전에는 "다음 기능은 구독자가 고릅니다 … 한 표 남겨 주세요" + 개인 링크, 이미 투표한 구독자에게는 링크 대신 "투표해 주셔서 감사합니다 …". 판정은 `loadVoteSummary().open.voters`(열린 라운드 투표자 id) 로, 발송 전 1회 조회.
- 회수·행정처분 항목은 제목에 "의료기기" 가 없어(품목명·업체명뿐) 관련성 검사(INCLUDE_ANY)에서 떨어질 수 있었다. `classifyOne` 이 `mfds_emedi:` 소스는 검사 없이 관련 항목으로 보도록 하고, 발췌 첫 줄에 "식약처 의료기기 회수·판매중지/행정처분 공표" 를 넣었으며, `kr-vigilance` 키워드에 행정처분·업무정지·허가취소·판매업무정지를 추가했다. **이미 저장된 emedi 항목은 재분류가 필요**: Supabase SQL 에서 `update updates set classified_at = null where source like 'mfds_emedi:%';` 실행 후 대시보드 "분류 실행".
- 대시보드 "확인 필요" 의 수집 경고는 마지막 수집 결과를 그대로 보여주므로, 코드 배포 후 "수집 실행" 을 한 번 눌러야 갱신된다.

### AE-2. 참고 항목 압축 표시 · 회수/행정처분 매칭 범위 축소 (2026-09-23 02:00 KST)
- 이메일에는 펼치기(더보기) 동작을 넣을 수 없으므로(메일 앱이 스크립트·details 미지원) 같은 목적을 구조로 해결: 영향도 **참고(low)** 항목은 관할별 본문에서 빼고, 하단 "참고 · N건" 섹션에 날짜·제목·원문 링크만 한 줄씩 싣는다(`renderLowSection`). 같은 소스가 4건을 넘으면 앞 3건만 보이고 "외 N건 — <소스명>에서 전체 보기" 링크(소스 검색 화면)로 대체. 머리글 건수는 "총 N건 (주요 M건 · 참고 K건)". 주요 항목이 없고 참고만 있으면 "변경 없음" 대신 "아래 참고 항목만 확인" 안내.
- 면책: 참고 줄에도 원문 링크가 있어 "원문에서 확인" 원칙 유지. 발췌만 생략.
- 분류: `mfds_emedi:*` 항목은 그 소스를 명시한 규격(`kr-vigilance`)에만 매칭. 발췌의 "위반법령: 의료기기법" 때문에 법령 규격 전체 구독자에게 실리던 문제 해결. **배포 후 재분류 필요**: `update updates set classified_at = null where source like 'mfds_emedi:%';` → "분류 실행".
