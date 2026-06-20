# AGENTS.md — 서브 에이전트가 반드시 지켜야 할 룰 (coaching-log)

> 본 파일은 [CLAUDE.md](CLAUDE.md) 가 `@AGENTS.md` 로 import 합니다.
> 서브 에이전트는 작업 전 **본 파일 + 자신의 브리프 + [docs/glossary.md](docs/glossary.md)** 를 반드시 읽고 시작합니다.

---

## 스택 주의 — 바닐라 JS · 빌드 없음

이 저장소는 프레임워크/빌드가 **없습니다.**

1. 프론트엔드 = **단일 `public/index.html` (~10,500줄 · 2026-06-10 기준)**. 바닐라 JS · CDN 스크립트 · 해시 라우팅 · `innerHTML` 템플릿. React/Vue/번들러 도입은 ADR 필요 (임의 금지).
2. `public/index.html` 수정 시: **반드시 `escHtml()`/`escAttr()` 로 사용자/코치 입력 이스케이프** (~87개 `innerHTML` sink — 한 곳만 빠져도 stored XSS). 전역 변수(~60개) 추가 신중.
   - escape 규칙 (2026-06-10 단일화): **텍스트 컨텍스트 = `escHtml()` · 속성 컨텍스트 = `escAttr()`** (escHtml 은 `'` 미이스케이프 — 속성에 쓰지 말 것). `escapeHtml`/`_esc` 는 DEPRECATED 위임 래퍼 — 신규 사용 금지. 에러 메시지(`error.message`)도 innerHTML 에 넣을 땐 sink 로 취급.
3. serverless = `api/*.js` (Vercel Node). `export default` 또는 `module.exports` 핸들러 — 기존 `api/extract-session.js` shape 따름.
4. DB 변경 = `supabase/migrations/` 에 **새 SQL 파일만** (`YYYYMMDD_phase_*.sql`). **기존 적용 파일 수정 금지.** 모든 신규 테이블 RLS 기본 deny.
5. 브라우저에 **service-role 키 절대 금지** — anon 키 + RLS 만.

---

## 변경 금지 항목

> ADR 없이 변경 금지. 변경 필요 시 메인에 STOP 후 보고.

- **`coaches_directory` 계약** — [docs/contracts/coaches-directory.md](docs/contracts/coaches-directory.md) (본 레포 원본). 세 앱 동시.
- **마이그레이션 파일** (적용된 것 수정 금지 · 새 파일만)
- **RLS 헬퍼 함수명** — `is_admin`·`is_pm`·`is_admin_or_pm`·`is_project_member`·`is_pm_of_project`
- **역할 모델** — `admin`/`pm`/`coach`
- **DB 테이블명** (CLAUDE.md 표)
- **수주 라이프사이클 트리거** (`bp_lifecycle_sync_*` · `bp_status_propagate_upd`) · **`business_plans.status` 단일 라이프사이클** (planning/active/completed/cancelled — coach-finder SoT, ADR-023. 구 bp_on_won·won 폐지)
- **임베딩 차원** 1536

---

## STOP 조건 (메인에 보고 후 대기)

1. 브리프와 실제 코드/스키마가 어긋남
2. Prerequisites 미충족
3. 변경 금지 항목 건드려야 함 (특히 적용된 마이그레이션)
4. 글로서리에 없는 새 용어 필요
5. `coaches_directory` / 공유 계약 변경 필요
6. RLS 정책 변경 필요 (보안 직결)
7. 사용자 가시 결정 필요

보고 포맷:
```
🛑 STOP — <한 줄 사유>
브리프: <id> · 현재 상태: <어디까지> · 충돌: <파일·룰> · 필요한 결정: <무엇>
```

---

## 품질 게이트 (빌드 없음 — 검증을 다르게)

자동 빌드/lint 가 없으므로 **검증 증거를 직접 만들어 첨부**:

- [ ] 서버리스 변경: 로컬 `node server.js` 또는 배포 후 실제 엔드포인트 호출 결과 (status + 응답 일부)
- [ ] DB 변경: 마이그레이션 적용 + `-- 검증` SQL 실행 결과
- [ ] `index.html` 변경: 브라우저에서 해당 뷰 동작 + 콘솔 에러 0 확인 (스크린샷/설명)
- [ ] RLS 변경: 역할별(admin/pm/coach) 접근 매트릭스 직접 확인
- [ ] `git diff --name-only` ⊆ 브리프 `CAN touch`
- [ ] 변경 금지 항목 미터치 · 글로서리 정합

"PASS" 만 쓰지 말 것. **무엇을 어떻게 확인했는지** 구체적으로.

---

## Return Format (5섹션 공통 필수)

```
## ✅ 한 일
- <파일:라인 구체>
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증
- <엔드포인트 호출 / SQL / 브라우저 확인 결과 — 구체적으로>
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

---

## 보안 (감사 P0 직결)

- `api/extract-session.js` 등 serverless 는 **인증 검증 필수** (Supabase JWT). 무인증 + `CORS *` 신규 금지.
- `coach_applications` 같은 anon-write 경로는 rate limit/검증 강화.
- RLS = 진짜 보안 경계. UI 의 `currentUserRole` 체크는 보조일 뿐. RLS 정책 변경은 STOP.
- 시크릿/키 커밋 금지. `--no-verify` 금지.

---

## 글로서리 · 용어 일관성

- 새 용어 도입 전 [docs/glossary.md](docs/glossary.md) 확인. 없으면 STOP.
- 함정: "session" vs "log" vs "coaching_log" · "project" vs "business_plan" · 역할 `pm`(소문자) vs ud-ops `PM`.

---

## 마지막 한 줄

> 의문 = STOP. 추측 = 금지. 기록 = 의무.
