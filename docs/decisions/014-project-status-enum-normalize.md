# ADR-014: projects.status 표시값 정규화 — 존재하지 않는 completed 제거

| 메타 | 값 |
|------|----|
| 상태 | Accepted (소급 기록 — 결정·구현 2026-06-07, 문서화 2026-06-10) |
| 일자 | 2026-06-07 |
| 작성자 | 메인 세션 (사용자 승인) |
| 근거 커밋 | `593d295` (fix(projects), 트랙B 0단계), merge `34d164f` |

---

## Context (왜)
DB 의 `projects.status` 는 `active / closed / archived` 만 정의하는데, UI 코드가 존재하지 않는 `completed` 값과 비교하고 있었다 → 완료된 프로젝트가 진행중(active) 카테고리로 오표시. To-Be 분리(트랙 B) 착수 전 기술 부채 정리.

## Decision (무엇을)
UI 의 `completed` 비교를 제거하고 **DB enum 값(`closed`/`archived`)으로 완료 판정을 정규화**한다. enum 에 `completed` 를 추가하는 방향은 채택하지 않는다.

⚠️ 주의: 이 결정은 `projects.status` 에 관한 것이다. **`business_plans.status` 의 이중 lifecycle**(draft/proposed/won/lost/cancelled + planning/active/completed)은 별개 미해결 항목 (AUDIT-2026-06-10 §4 참고).

## Consequences (결과)
### Positive
- DB-UI 상태값 일치. 완료 프로젝트 오분류 해소.
### Negative / Trade-off
- 없음 (1줄 정규화).
### 영향 받는 코드
- `public/index.html` 1줄.

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| enum 에 completed 추가 | DB 를 UI 에 맞춤 | closed/archived 와 의미 중복, 마이그레이션 불필요한 확장 |
