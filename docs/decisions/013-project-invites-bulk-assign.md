# ADR-013: 미가입 코치 초대 예약(project_invites) + 다중 검색 일괄 배정

| 메타 | 값 |
|------|----|
| 상태 | Accepted (소급 기록 — 결정·구현 2026-06-06, 문서화 2026-06-10) |
| 일자 | 2026-06-06 |
| 작성자 | 메인 세션 (사용자 승인) |
| 관련 브리프 | `.claude/agent-briefs/_archive/UX4-bulk-coach-assign.md` |
| 근거 커밋 | `29be786` (Phase W), `0ad5ca5` (UX4), merges `87badcd`·`635c9ee` |

---

## Context (왜)
1. 프로젝트에 코치를 **한 명씩만** 배정 가능 — 대규모 프로젝트에서 비효율.
2. 미가입 코치(`coaches_directory.linked_user_id IS NULL`)는 가입 전 배정 자체가 불가 → "초대 메일 보냈는데 배정이 안 됨" 혼동.

## Decision (무엇을)
**명시적 "초대 예약" 테이블 + 가입 후 수동 승격 RPC + 다중 선택 일괄 배정 UI.**
- **Phase W (DB):** `project_invites` 신규 테이블 (`UNIQUE(project_id, coach_directory_id)`, RLS=`is_admin_or_pm`). `promote_invite_to_member(p_invite_id)` RPC — 가입 확인 후 `project_members` 로 승격, 가입 전 호출 시 예외.
- **UX4 (UI):** 코치 검색 결과 체크박스 다중선택 → "선택한 N명 배정" — 가입자는 `project_members`, 미가입자는 `project_invites` 로 분기 INSERT. 배정 목록은 멤버(✅)+초대대기(⏳) 통합 표시.
- **자동 승격 트리거는 도입하지 않는다** — 숨은 동작은 꼬임의 원천. PM 이 "배정하기" 버튼으로 명시 승격.

## Consequences (결과)
### Positive
- 미가입 코치도 배정 파이프라인에 올라감 (수주 흐름 누락 방지 — ADR-018 의 bp_on_won invite 보존으로 이어짐).
- 일괄 배정으로 PM 운영 효율 향상.
### Negative / Trade-off
- 승격이 수동 — PM 이 가입 사실을 인지해야 함 (알림 없음, 백로그).
### 영향 받는 코드 · 문서 · DB
- `supabase/migrations/20260605_phase_w_project_invites.sql` (신규 테이블·RPC·RLS 4정책)
- `public/index.html` 배정 UI (+342/-190줄)

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| 가입 시 자동 배정 트리거 | auth 가입 이벤트로 promote | 숨은 동작 — 디버깅·감사 어려움 |
| coaching-log 로컬 초대 관리 | 별도 초대 시스템 | coach-finder 와 데이터 중복 |

## 검증 (Acceptance)
- [x] 마이그레이션 멱등(IF NOT EXISTS) · RLS 정책 적용
- [x] invite fetch 실패 시 멤버 목록 degrade 동작 확인 (커밋 시점)
