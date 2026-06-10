# ADR-018: To-Be 분리 1단계 — 비파괴 DB 기반 (Phase X)

| 메타 | 값 |
|------|----|
| 상태 | Accepted (소급 기록 — 결정·구현 2026-06-07, 문서화 2026-06-10) |
| 일자 | 2026-06-07 |
| 작성자 | 메인 세션 (사용자 승인) |
| 관련 문서 | docs/ARCHITECTURE-SEPARATION-2026-06-05.md |
| 근거 커밋 | `46401e0` (feat(db) Phase X), merge `7a91c43` |
| Superseded by 연계 | ADR-019 (2단계 봉인) 가 본 결정 위에 쌓임 |

---

## Context (왜)
두 제품 분리(To-Be: 수주前=coach-finder, 수주後=coaching-log)를 향한 첫 단계. 기존 구조의 세 가지 결함:
1. `bp_on_won` 트리거가 **가입자만**(`linked_user_id IS NOT NULL`) `project_members` 로 복사 → 미가입 코치는 수주 시 배정에서 소리 없이 누락.
2. `business_plans.project_id` 단방향 링크만 존재 → projects 에서 역참조 불가.
3. `coach_evaluations` 중복 행 가능 → coach-finder 평점 집계 왜곡 위험.

## Decision (무엇을)
**Phase X 마이그레이션(`20260605_phase_x_tobe_foundations.sql`) 으로 3가지를 비파괴 증분 도입:**
1. `bp_on_won` 트리거 재정의 — 가입자 → `project_members`, **미가입자 → `project_invites`** (ADR-013 테이블 재사용, 중복 skip). 자동 승격 없음 (ADR-013 원칙 유지).
2. `projects.business_plan_id` 역링크 FK 추가 (ON DELETE SET NULL) + 인덱스.
3. `coach_evaluations(business_plan_id, coach_directory_id)` 부분 UNIQUE 인덱스 (NULL 제외).

## Consequences (결과)
### Positive
- 수주 시 코치 배정 누락 제거 — 초대 예약으로 전원 보존.
- 프로젝트→BP 추적 가능 (직접생성/수주생성 구분 기반).
### Negative / Trade-off
- `bp_on_won` 은 변경 금지 항목 — 본 ADR 이 그 변경의 공식 근거. 이후 변경도 ADR 필수.
### 영향 받는 코드 · 문서 · DB
- `supabase/migrations/20260605_phase_x_tobe_foundations.sql` (트리거 CREATE OR REPLACE · FK · UNIQUE)

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| 트리거에서 자동 승격까지 | 가입 시 invites → members 자동 | 숨은 동작 금지 원칙 (ADR-013) |
| 미가입 누락 현행 유지 | 가입 후 수동 재배정 | "배정했는데 사라짐" 사용자 혼란 지속 |

## 검증 (Acceptance)
- [x] 마이그레이션 멱등 (CREATE OR REPLACE · IF NOT EXISTS · 조건부 ADD)
- [x] 트리거는 UPDATE 트랜잭션 내 실행 — 중간 실패 시 전체 롤백 (orphan 없음, 2026-06-09 리뷰에서 재확인)
