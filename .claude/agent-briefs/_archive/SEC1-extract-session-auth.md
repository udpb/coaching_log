# Brief SEC1 — /api/extract-session 에 Supabase JWT 인증 + CORS 제한

> **자급자족 브리프.** 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이 작업.

| 메타 | 값 |
|------|----|
| ID | `SEC1-extract-session-auth` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-01 |
| 상태 | ✅ 완료 (2026-06-01) |
| 우선순위 | P0 |

> ✅ **결과**: `extract-session.js` 에 `verifyAuth`(Bearer→`/auth/v1/user`, fetch) 게이트(401/503) + CORS allowlist + `Allow-Headers: Authorization`. `index.html` extract-session fetch 에 `getSession()` Bearer 첨부. `node --check` 통과 · 2파일 diff · 메인 검증. ⚠️ Vercel `SUPABASE_ANON_KEY` env 필요. ADR-002 / Journey 2026-06-01-p0-security-fixes.

---

## 🎯 Mission

`api/extract-session.js` 가 호출자의 Supabase 로그인 JWT 를 검증해 미인증 요청을 401 로 거부하고 CORS 를 `*` 에서 앱 origin 으로 좁히며, `public/index.html` 의 `/api/extract-session` 호출이 `Authorization: Bearer <access_token>` 를 첨부하도록 해서, 익명의 transcript POST·Gemini 비용 발생을 차단한다.

## 📋 Context

출처: `docs/AUDIT-2026-06-01.md` P0-1(coaching-log). `api/extract-session.js:92-95` 는 `Access-Control-Allow-Origin: *` + JWT 검증 0줄 → 아무 출처에서나 transcript/audio 를 POST 해 Gemini 2.5 Pro 비용을 태울 수 있다. 클라이언트(`public/index.html`)는 이미 Supabase 세션을 보유(`supabaseClient`, line 5108; `getSession()` 사용처 4781)하므로 토큰 첨부가 가능하다. 함수는 CommonJS 이고 Gemini 를 `fetch` 로 호출 — **무거운 SDK 추가 없이** Supabase Auth REST(`GET {SUPABASE_URL}/auth/v1/user`)로 검증한다.

## ✅ Prerequisites (STOP 조건)

- [ ] `api/extract-session.js` 가 `module.exports = async function handler(req, res)` (CommonJS) — 92행 근처
- [ ] `public/index.html` 에 `fetch('/api/extract-session'` 호출 존재 — 7125행 근처
- [ ] `public/index.html` 에 `supabaseClient`(5108행) + `SUPABASE_URL`(5106행) 존재, `supabaseClient.auth.getSession()` 패턴 사용처 존재(4781행)
하나라도 다르면 STOP 후 보고.

## 📖 Read These Files First (이 순서로)

1. `../../CLAUDE.md`
2. `../../AGENTS.md` (특히 "보안" + "스택 주의 — 바닐라 JS")
3. `../../docs/glossary.md`
4. `../../docs/AUDIT-2026-06-01.md` (P0-1)
5. `api/extract-session.js` (92~140행 — handler 진입부 · CORS · method · body)
6. `public/index.html` 7100~7160행 (extract-session fetch 호출부) · 4775~4790행 (getSession 사용 패턴) · 5106~5110행 (supabaseClient/URL/KEY)

## 🎯 Scope

### CAN touch
- `api/extract-session.js` (handler 진입부에 인증 게이트 + CORS 수정만)
- `public/index.html` — **오직** `/api/extract-session` 호출부(7125행 근처)의 fetch headers + 그 호출을 감싸는 함수 안에서 토큰 조회. (선택) 그 함수 또는 근처에 작은 헬퍼.

### MUST NOT touch
- `api/extract-session.js` 의 프롬프트 빌더(`buildSystemPrompt`/`buildUserPrompt`) · Gemini 호출/파싱/폴백 로직 · `normalizeModelOutput` 등
- `public/index.html` 의 다른 뷰·함수·전역 변수 (extract-session 호출 외)
- `supabase/migrations/**` · 그 외 모든 파일

## 🛠 Tasks

1. **서버 인증 게이트** — `api/extract-session.js` handler 에서 method 체크(98행) **직후**, GEMINI_API_KEY 체크 전/후 적절한 위치에:
   - `verifyAuth(req)` 헬퍼(같은 파일 내 함수): `req.headers['authorization']` 에서 `Bearer <jwt>` 추출 → 없으면 false.
   - `const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zwvrtxxgctyyctirntzj.supabase.co';` (URL 은 공개값 · index.html:5106 과 동일).
   - `const anon = process.env.SUPABASE_ANON_KEY;` — 없으면 인증 불가이므로 **fail-closed**: 401(또는 503 "auth not configured") 반환하고, 이 env 필요성을 Return "위험 신호" 에 명시(사용자가 Vercel 에 추가해야 함).
   - `await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: anon } })` → `res.ok` 면 통과, 아니면 false.
   - 게이트: `if (!(await verifyAuth(req))) return res.status(401).json({ error: 'Unauthorized' });`
2. **CORS 제한** — `Access-Control-Allow-Origin: '*'`(93행) 를 allowlist 로:
   - 허용 origin = `['https://coaching-log-lemon.vercel.app', 'http://localhost:3000', 'http://localhost:5173']` + (있으면) `process.env.APP_ORIGIN`.
   - `const origin = req.headers.origin; if (allow.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);` (매칭 안 되면 헤더 미설정 — same-origin 호출은 영향 없음).
   - `Access-Control-Allow-Headers` 에 `Authorization` 추가(기존 `Content-Type` 와 함께).
   - OPTIONS preflight 응답은 그대로 동작하게.
3. **클라이언트 토큰 첨부** — `public/index.html` 의 `/api/extract-session` fetch(7125행):
   - 호출 직전 `const { data: sess } = await supabaseClient.auth.getSession(); const token = sess?.session?.access_token;`
   - fetch headers 에 `...(token ? { Authorization: 'Bearer ' + token } : {})` 병합. 기존 `Content-Type` 등 유지. body/stream 처리 무변경.
4. **검증** — `node --check api/extract-session.js` (구문) + 변경부 코드 리뷰. (빌드/tsc 없음.)

## 🔒 Tech Constraints

- `api/extract-session.js` 는 **CommonJS** (`require`/`module.exports`). ESM import 쓰지 말 것.
- 새 npm 의존성 설치 금지 — Supabase 검증은 내장 `fetch` 로만 (Node 18+ 글로벌 fetch).
- `public/index.html` 바닐라 JS — 기존 `supabaseClient` 재사용. 새 전역 변수 추가 신중. 사용자 입력 `innerHTML` 안 건드림(이 작업은 fetch 호출만).
- service-role 키 사용 금지 — anon 키로 `/auth/v1/user` 검증만.

## ✔️ Definition of Done

- [ ] 미인증(토큰 없음/무효) 요청에 `api/extract-session.js` 가 401
- [ ] CORS `*` 제거 → allowlist. `Allow-Headers` 에 `Authorization` 포함
- [ ] `public/index.html` 의 extract-session 호출이 Bearer 토큰 첨부 (grep 으로 확인)
- [ ] 프롬프트/Gemini/파싱 로직 무변경 (diff 로 확인)
- [ ] `node --check api/extract-session.js` 통과
- [ ] `git diff --name-only` = `api/extract-session.js` + `public/index.html` 두 개만

## 📤 Return Format

```
## ✅ 한 일
- <파일:라인 — verifyAuth · CORS · 클라 헤더>

## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증
- node --check api/extract-session.js: <결과>
- git diff --name-only: <목록>
- verifyAuth 함수 전체 + 게이트 호출 스니펫
- index.html 변경부(전/후) 스니펫
- extract-session fetch 에 Authorization 들어갔음을 보이는 grep

## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것
- (SUPABASE_ANON_KEY Vercel env 필요 · 배포 순서 등)
```

## 🚫 Do NOT

- 마이그레이션 · 프롬프트/Gemini/파싱 로직 · index.html 의 다른 부분 변경
- 새 의존성 설치 · service-role 키 사용 · `escHtml` 없이 사용자 입력 innerHTML (이 작업 무관)
- `--no-verify`

## 💡 Hints & Edge Cases

- `getSession()` 은 Promise — `await` 필수. extract-session 호출 함수가 이미 `async` 인지 확인(7125 근처). 아니면 토큰 조회를 그 async 흐름 안에 둘 것.
- fail-closed 가 원칙이나, **SUPABASE_ANON_KEY 가 Vercel env 에 없으면 기능이 막힘** → 이 점을 반드시 "위험 신호" 에 적고 사용자에게 env 추가를 알릴 것 (URL 은 공개값이라 fallback 가능, anon 키는 env 필요).
- same-origin(coaching-log-lemon.vercel.app 에서 자기 /api 호출)은 CORS preflight 가 없어 allowlist 제한이 정상 동작을 깨지 않음.
- `/auth/v1/user` 는 유효 토큰이면 200 + user JSON, 무효면 401. `res.ok` 로 판정.

## 🏁 Final Note

부수 발견(死 `GEMINI_KEY=''` 상수 등)은 고치지 말고 "위험 신호" 에. 임의 추가 작업 금지.
