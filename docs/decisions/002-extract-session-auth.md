# ADR-002: /api/extract-session 에 Supabase JWT 인증 + CORS 제한

| 메타 | 값 |
|------|----|
| 상태 | **Accepted** |
| 일자 | 2026-06-01 |
| 작성자 | 메인 세션 (사용자 GO 기반) |
| 관련 브리프 | `.claude/agent-briefs/_archive/SEC1-extract-session-auth.md` |
| 관련 Journey | [docs/journey/2026-06-01-p0-security-fixes.md](../journey/2026-06-01-p0-security-fixes.md) |

---

## Context (왜)

감사(AUDIT-2026-06-01) P0-1(coaching-log): `api/extract-session.js:92-95` 가 `Access-Control-Allow-Origin: *` + JWT 검증 0줄. 아무 출처에서나 transcript/audio 를 POST 해 Gemini 2.5 Pro 비용을 무제한 태울 수 있었다. 클라이언트(`public/index.html`)는 이미 Supabase 세션(`supabaseClient`)을 보유해 토큰 첨부가 가능했다.

## Decision (무엇을)

**`api/extract-session.js` 가 호출자의 Supabase 로그인 JWT 를 검증(미인증 401)하고 CORS 를 allowlist 로 좁히며, `public/index.html` 의 호출이 `Authorization: Bearer <access_token>` 를 첨부한다.**

- 서버: 동일 파일 내 `verifyAuth(req)` — Bearer 추출 → `GET {SUPABASE_URL}/auth/v1/user` (`Authorization` + `apikey: anon`) → `res.ok` 판정. **무거운 SDK 추가 없이 내장 fetch 만** (함수가 이미 fetch 로 Gemini 호출). CommonJS 유지.
- 게이트 위치: OPTIONS/method 체크 직후, GEMINI 비용 발생 전. anon 키 미설정 시 503(설정 문제 신호), 토큰 무효 시 401.
- CORS: `*` → allowlist(`coaching-log-lemon.vercel.app` · localhost · `APP_ORIGIN` env), origin 매칭 시만 echo. `Allow-Headers` 에 `Authorization` 추가.
- 클라: `supabaseClient.auth.getSession()` access_token 을 헤더 병합 (`runSttExtract`, index.html:7125).

## Consequences (결과)

### Positive
- 익명 transcript POST·Gemini 비용 차단 (P0-1 해소).
- 검증을 fetch 로만 — 의존성·번들 증가 없음.

### Negative / Trade-off
- **`SUPABASE_ANON_KEY` 를 Vercel env 에 추가해야 동작** (현재 함수는 GEMINI_API_KEY 만 사용). 미설정 시 503 으로 기능 막힘 → 배포 전 필수 설정.
- 매 호출 Supabase Auth REST 왕복 1회 추가.
- 서버+클라 동시 배포 필요(서버만 먼저 = 구버전 클라 401/503).

### 영향 받는 코드 · 문서
- 코드: `api/extract-session.js` (verifyAuth + CORS + 게이트) · `public/index.html` (extract-session fetch 헤더)
- 문서: 본 ADR · Journey · HANDOFF

## Alternatives Considered

| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| A. @supabase/supabase-js 로 getUser | SDK 사용 | devDependency 라 번들/런타임 추가 필요. fetch 가 더 가벼움 |
| B. JWT 서명 로컬 검증 | jwt secret 으로 | secret(민감) 필요 + 복잡. REST 검증이 단순·안전 |
| C. CORS 제한만 | origin 화이트리스트 | 비-브라우저 클라 차단 못 함. 인증이 본질 |

## Migration / Rollout

① Vercel 프로젝트에 `SUPABASE_ANON_KEY`(index.html:5107 anon 키와 동일값) 설정 → ② 서버+클라 동시 배포. `SUPABASE_URL`·`APP_ORIGIN` 은 선택.

## 검증 (Acceptance)

- [x] `verifyAuth` + 게이트(401/503) + CORS allowlist — 메인 직접 read 검증
- [x] 클라 Bearer 첨부 — 메인 grep 확인 (index.html:7131)
- [x] `node --check api/extract-session.js` 통과 (메인 실행)
- [x] diff = `api/extract-session.js` + `public/index.html` 두 개 (메인 확인)
- [x] 프롬프트/Gemini/파싱 무변경
- [x] 사용자 GO

## 후속 작업

- **사용자 액션**: Vercel `SUPABASE_ANON_KEY` env 설정 후 배포.
- **SEC2 (예정)** — `coach_applications` anon INSERT 방어.
- **DOCS (예정)** — 死 `GEMINI_KEY=''`(extract-session.js:29) 제거 + README/HANDOVER 정정.
