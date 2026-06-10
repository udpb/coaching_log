# ADR-019: To-Be 분리 2단계 — coaching-log 직접생성 봉인 (SEAL1 UI + Phase Y RLS)

| 메타 | 값 |
|------|----|
| 상태 | Accepted (소급 기록 — 결정·구현 2026-06-07, 문서화 2026-06-10) |
| 일자 | 2026-06-07 |
| 작성자 | 메인 세션 (사용자 승인) |
| 관련 브리프 | `.claude/agent-briefs/_archive/SEAL1-coaching-log-ui.md` |
| 선행 | ADR-011 (평가 쓰기 이전) · ADR-018 (Phase X 기반) |
| 근거 커밋 | `fd5297d` (feat(seal)), merge `4cf4900` |

---

## Context (왜)
분리 전 coaching-log 는 사업기획(BP) 생성, 프로젝트 직접생성, 코치 대량 등록까지 모두 가능했다 — "수주前 자산"의 소유권이 두 제품에 걸쳐 있어 데이터 흐름이 꼬인다. To-Be 원칙: **수주前(BP·코치 섭외)은 coach-finder, 수주後(프로젝트·세션 기록)는 coaching-log.**

## Decision (무엇을)
**UI 강등(SEAL1)과 RLS 봉인(Phase Y)을 원자 배포로 동시 적용.**
- **SEAL1 (UI):** plans 탭 전체 제거, BP CRUD·코치핀 함수 제거, 프로젝트 직접생성 제거(멤버 배정은 유지), 코치디렉토리 쓰기·CSV 제거(읽기/검색 유지). 순 -1,675줄. 유지: 세션기록 CRUD · 대시보드 · 멤버배정 · myinfo self-edit · 코치 읽기 · 프로젝트 선택.
- **Phase Y (RLS, `20260605_phase_y_seal_rls.sql`):** `projects` INSERT 정책 전부 제거 → **트리거(SECURITY DEFINER)만 프로젝트 생성 가능.** `coaches_directory` INSERT 를 admin 단독으로 회수(pm 제외). UPDATE(self-edit)·DELETE 불변.

## Consequences (결과)
### Positive
- 시간축 소유권 명확: 프로젝트는 coach-finder 수주(bp_on_won)에서만 생긴다.
- UI 와 RLS 양쪽 봉인 — UI 우회(콘솔 anon 호출)도 차단.
### Negative / Trade-off
- **RLS 의 정직한 한계:** RLS 는 호출 앱을 구분 못 한다 — coach-finder 의 pm 과 coaching-log 의 pm 은 같은 role. BP 관련 쓰기의 최종 경계는 3단계(API 경계) 검토 필요.
- PM 이 coaching-log 에서 프로젝트 메타를 수정 못 함 (의도된 강등).
### 영향 받는 코드 · 문서 · DB
- `public/index.html` (-1,857/+182줄) · `supabase/migrations/20260605_phase_y_seal_rls.sql`
- ⚠️ 배포 순서 제약: UI 와 RLS 동시 배포 필수 (RLS 만 먼저면 사용자가 권한 에러 경험).

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| UI 만 제거 | 화면에서만 숨김 | RLS 없으면 콘솔/스크립트로 우회 가능 |
| RLS 만 봉인 | DB 만 차단 | UI 가 남으면 사용자가 에러 폭탄 경험 |

## 검증 (Acceptance)
- [x] 제거 함수 grep 0건 · 유지 대상 6/6 보존 (커밋 시점)
- [x] Phase Y 멱등 (DROP IF EXISTS + CREATE)
- [ ] 3단계 (API 경계 / business_plans RLS 회수) — 백로그
