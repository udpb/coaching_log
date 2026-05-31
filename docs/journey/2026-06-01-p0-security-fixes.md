# 2026-06-01 · P0 보안 수정 1차 (SEC1 extract-session 인증)

| 메타 | 값 |
|------|----|
| 메인 세션 | Opus 4.8 (1M) |
| 관련 ADR | [ADR-002](../decisions/002-extract-session-auth.md) |
| 관련 브리프 | `_archive/SEC1-extract-session-auth.md` |
| 다음 진입점 | [HANDOFF.md](../../HANDOFF.md) "다음 액션" |

## 한 일

- **SEC1** — `api/extract-session.js` 에 `verifyAuth`(Bearer → Supabase `/auth/v1/user` REST, 내장 fetch) 게이트 추가(미인증 401 · anon env 없으면 503), CORS `*` → allowlist + `Allow-Headers: Authorization`, `public/index.html` 의 extract-session fetch(`runSttExtract`)에 `getSession()` access_token 첨부. 서브에이전트 위임 → 메인 검증(`node --check` · read · grep).
- **SEC2** (P1 하드닝) — 신규 마이그레이션 `20260601_phase_r_coach_applications_hardening.sql`: `coach_applications` anon-insertable 컬럼에 길이/배열 상한 CHECK 10개(NOT VALID·idempotent). 메인 검증(read). ⚠️ DB 적용은 사용자 `supabase db push`. captcha anti-spam 은 ADR-004 로 분리. (ADR-003)
- **D1** (P1 구조) — 공유 `coaches_directory` 계약 drift 해소: ud-ops(`C:\Users\USER\projects\ud-ops-workspace`) `src/lib/coaches/supabase-source.ts` 에 누락 4컬럼(inferred_skills·roles_capable·roles_active_2026·ud_programs) Row+SELECT parity + 계약 포인터. `npm run typecheck` 통과. 메인 검증(diff). 계약 문서 §5 D-1 해소 표기. ⚠️ Prisma 매핑·CI 일치검사 미완(후속).

## 뭘 틀렸나 / 의외 발견

- 함수가 CommonJS + Gemini 를 fetch 로 호출 → Supabase 검증도 SDK 없이 fetch 로 일관 처리(번들 증가 0). 좋은 적합.
- `extract-session.js:29` 死 `GEMINI_KEY=''` 상수 잔존 확인 — 이번엔 안 건드림(DOCS 후속).

## 결정한 것

- ADR-002. anon 키 미설정 시 401 대신 **503**("auth not configured") — 클라가 설정문제 vs 토큰만료 구분 가능.
- 구현은 서브에이전트, 검증은 메인 직접 — ActBot 방식.

## 다음 세션이 알아야 할 것

- **⚠️ 사용자 액션**: Vercel 에 `SUPABASE_ANON_KEY` 설정 후 배포(미설정 시 extract 전부 503). 서버+클라 동시 배포.
- 다음: SEC2(`coach_applications` anon INSERT 방어) · DOCS(死 상수·문서 정정) · H1(index.html 모듈화).

## 변경된 파일

- `api/extract-session.js` · `public/index.html`
- 문서: `docs/decisions/002-extract-session-auth.md` · 본 Journey
