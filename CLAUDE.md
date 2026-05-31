@AGENTS.md

# coaching-log — 운영 규칙 (Single Source of Truth)

> 이 문서는 **coaching-log 프로젝트의 최상위 운영 규칙**입니다. 모든 세션(메인 + 서브 에이전트)은 작업 시작 전 이 파일을 읽고, 여기서 가리키는 문서들을 추가로 확인해야 합니다.
>
> 결정의 "Why" 는 `docs/decisions/` 에, 시행착오는 `docs/journey/` 에. 본 파일은 **변하지 않는 룰** + 진입점 인덱스만 둡니다.
>
> 일하는 방식의 원천: UDImpact-ActBot 의 운영 체계를 본 레포에 이식 (ADR-001 · 2026-06-01).

---

## 프로젝트 개요

**제품:** coaching-log — 언더독스 **코치가 창업팀 코칭 세션을 기록하고 성과를 추적**하는 도구.
**소유:** 언더독스 / UD IMPACT.
**자매 제품:** coach-finder (PM 의 코치 섭외 결정). 두 제품은 **하나의 Supabase 프로젝트** + `coaches_directory` 마스터 공유. **본 레포가 스키마(마이그레이션) 진실원본.**

핵심 플로우: 코치가 STT transcript(또는 녹음) 입력 → `/api/extract-session` 이 Gemini 로 구조화 추출(내러티브 + 22 필드 + evidence/confidence) → `coaching_logs` 저장 → 대시보드에서 팀별 타임라인·지표·커밋먼트 추적.

상세: [docs/INTEGRATED_ARCHITECTURE.md](docs/INTEGRATED_ARCHITECTURE.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/HANDOVER.md](docs/HANDOVER.md).

---

## 일하는 방식 — 5가지 역할 분리

> **"기능을 만드는 자(서브 에이전트)와 구조를 지키는 자(메인 세션)를 분리한다."**

| 역할 | 누가 | 무엇을 |
|------|------|--------|
| **사용자** | 사람 | 제품 방향 · 비즈니스 결정 · 스코프 승인 |
| **메인 세션** | Claude Code 메인 | **Architect · Guardian · Curator · Orchestrator · Historian** — 직접 구현 금지 |
| **서브 에이전트** | Agent 도구로 호출 | 브리프(`.claude/agent-briefs/*.md`) 받아 구현 → 보고 |

### 메인 세션의 5가지 책임
- **Architect** — 구조 설계·유지 (데이터 모델 · RLS · serverless API · 공유 계약).
- **Guardian** — 문서 정합성 · 스코프 위반 감지 · 변경 금지 항목 보호.
- **Curator** — 자료 정리·추천 · 글로서리 충돌 검사.
- **Orchestrator** — 자급자족 브리프로 위임 + 결과 검증.
- **Historian** — ADR · Journey 기록.

### 메인 세션이 **직접 하지 않는 것**
- `public/index.html` 의 JS 본문 · `api/*.js` 핸들러 본문 · SQL 마이그레이션 본문
- 의존성 설치 · 환경 설정 · 반복 보일러플레이트

> ⚠️ 운영 인프라 문서 작성(본 셋업)은 메인 직접 (Architect·Historian). **코드는 항상 브리프 → 서브 에이전트.**

상세: [docs/playbook/working-method.md](docs/playbook/working-method.md)

---

## 사용자가 강조한 운영 원칙

1. **구체적 작업지시** — 모든 서브 에이전트 호출은 자급자족 브리프.
2. **제대로 검증** — 완료 보고 그대로 신뢰 금지. 메인이 `git diff` · 실제 동작/RLS 직접 확인.
3. **투명한 보고** — 5섹션 (한 일 / 못한 일 / 결정 / 검증 / 위험 신호). 성공 위주 요약 금지.
4. **모든 기록 보존** — ADR Accepted 후 수정 금지(Supersede) · Journey append only · 브리프 완료 후 `_archive/`.
5. **용어/스키마 일관성** — 새 자료마다 [docs/glossary.md](docs/glossary.md) 충돌 검사 → ADR → 글로서리 → 코드 일괄.

---

## 안정(Stable) vs 가변(Volatile)

- **안정**: `coaches_directory` 공유 계약 · RLS 헬퍼 함수명 · 역할 모델(`admin`/`pm`/`coach`) · DB 테이블명 · `coaching_logs` 24필드 · `bp_on_won` 트리거.
- **가변**: extract-session 프롬프트 본문 · 대시보드 지표 표시 · 메시지 카피.

→ 가변은 하드코딩 지양.

---

## 문서 계층 (읽는 순서)

### 1차 (필독)
1. **[CLAUDE.md](CLAUDE.md)** ← 본 파일
2. **[AGENTS.md](AGENTS.md)** — 서브 에이전트 룰 · 변경 금지 · STOP · 검증
3. **[HANDOFF.md](HANDOFF.md)** — 최근 핸드오버
4. **[docs/glossary.md](docs/glossary.md)** — 용어 SoT

### 2차 (도메인 + 현황)
5. **[docs/HISTORY.md](docs/HISTORY.md)** — 문서 인벤토리 + 신선도
6. **[docs/AUDIT-2026-06-01.md](docs/AUDIT-2026-06-01.md)** ⭐ — 심층 감사 (백로그 출처)
7. **[docs/contracts/coaches-directory.md](docs/contracts/coaches-directory.md)** ⭐ — 공유 계약 (**본 레포가 원본**)
8. **[docs/INTEGRATED_ARCHITECTURE.md](docs/INTEGRATED_ARCHITECTURE.md)** — 4앱 통합 + Gap 1~5
9. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** · **[docs/HANDOVER.md](docs/HANDOVER.md)**

### 3차 (운영 + 결정)
10. **[docs/playbook/](docs/playbook/)** · 11. **[docs/decisions/](docs/decisions/)** · 12. **[docs/journey/](docs/journey/)** · 13. **[.claude/agent-briefs/](.claude/agent-briefs/)**

---

## 현재 기술 스택

| Layer | 선택 | 비고 |
|-------|------|------|
| Frontend | **바닐라 JS · 단일 `public/index.html` (12,090줄 모놀리식)** | 빌드 없음 · CDN 스크립트 (supabase-js · pizzip · docxtemplater) · 해시 라우팅 · ~87 `innerHTML` |
| AI serverless | `api/extract-session.js` (Vercel) | Gemini `gemini-2.5-pro` PRIMARY → `gemini-2.5-flash` FALLBACK |
| DB | Supabase (Postgres + pgvector + Auth + RLS) | **`supabase/migrations/` = 스키마 SoT (28 파일)** |
| 배포 | Vercel (`public/` 정적 + 1 serverless) | |
| Auth | 브라우저 anon 키 + RLS | service-role 키 클라이언트 노출 없음 |

⚠️ **데드 레이어**: `server.js` · `lib/csv-manager.js` · `lib/backup.js` (로컬 파일기반 프로토타입 · Vercel 미배포 · node-cron 안 돎) — 감사 REMOVE 대상.

### 검증 방식 (빌드/lint/tsc 없음 — 정직하게)
- **자동 빌드 없음.** TypeScript 아님. lint 없음.
- 검증 = ① 로컬 `node server.js` 또는 배포 엔드포인트 HTTP 호출 ② RLS 는 마이그레이션의 `-- 검증` SQL 스니펫 실행 ③ `public/index.html` 변경은 브라우저 육안.
- ⚠️ 현재 **자동 테스트 0건** — extract→save + RLS 매트릭스 테스트 추가가 ADD 후보.

---

## 변경 금지 항목 (스키마 · 명명)

ADR 없이 변경 금지:

- **`coaches_directory` 컬럼 계약** — [docs/contracts/coaches-directory.md](docs/contracts/coaches-directory.md) (본 레포 원본). 세 앱 동시 반영.
- **마이그레이션 파일** — 적용된 `supabase/migrations/*.sql` 수정 금지. **새 파일로만** (`YYYYMMDD_phase_*.sql`).
- **RLS 헬퍼 함수명** — `is_admin()` · `is_pm()` · `is_admin_or_pm()` · `is_project_member()` · `is_pm_of_project()` (SECURITY DEFINER)
- **역할 모델** — `admin` / `pm` / `coach` (⚠️ ud-ops 6역할과 다름)
- **DB 테이블명** — `coaching_logs` · `coaches_directory` · `profiles` · `projects` · `project_members` · `business_plans` · `business_plan_coaches` · `coach_evaluations` · `coach_applications` · `coach_bookmarks` · `rfp_history` · `api_consumers`
- **`bp_on_won` 트리거** · **`business_plans.status` 이중 lifecycle** (draft/proposed/won/lost/cancelled + planning/active/completed)
- **임베딩 차원** — 1536 (Gemini)

상세: [AGENTS.md](AGENTS.md) · [docs/glossary.md](docs/glossary.md)

---

## 커밋 / 브랜치 컨벤션

- 기능 개발은 `feat/<brief-id>` · 운영/문서는 `chore/docs-*`
- `feat(scope): 설명` / `fix(scope)` / `docs(scope)` / `chore(scope)`
- scope: `db` · `extract` · `dashboard` · `auth` · `rls` · `index-html` · `docs` · `playbook` · `security`
- 마이그레이션 커밋은 `feat(db): Phase <X> ...`
- 한글 커밋 OK · `main` 직접 커밋은 운영/핫픽스만

---

## 변경 이력

- **2026-06-01** — 운영 인프라 셋업 (ADR-001). ActBot 일하는 방식 이식 + 감사(AUDIT-2026-06-01) + **공유 계약 원본 작성**(`docs/contracts/coaches-directory.md`). 코드 변경 없음.
