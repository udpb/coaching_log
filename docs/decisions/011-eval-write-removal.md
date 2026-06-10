# ADR-011: 평가(coach_evaluations) 쓰기 권한을 coach-finder 로 단독 이전

| 메타 | 값 |
|------|----|
| 상태 | Accepted (소급 기록 — 결정·구현 2026-06-06, 문서화 2026-06-10) |
| 일자 | 2026-06-06 |
| 작성자 | 메인 세션 (사용자 승인) |
| 관련 브리프 | `.claude/agent-briefs/_archive/EVAL1-remove-write.md` |
| 근거 커밋 | `b5712d6` (fix(eval)), `076e0ef` (merge) |

---

## Context (왜)
coaching-log 와 coach-finder 가 `coach_evaluations` 테이블에 **양쪽에서 쓰기**를 하고 있었다 (INTEGRATED_ARCHITECTURE Gap 3). 평가는 코치 섭외 결정(coach-finder 의 핵심 신뢰 신호)에 직결되는데, 두 제품이 각자 작성/수정하면 데이터 일관성과 책임 소재가 모호해진다.

## Decision (무엇을)
**평가의 쓰기(작성·수정·삭제)는 coach-finder 단독. coaching-log 는 읽기 전용.**
- coaching-log UI 에서 평가 모달, 쓰기 함수(`saveBPEval`/`deleteBPEval`/`openBPEvalCreateModal`/`openBPEvalEditModal`), 쓰기 버튼 제거 (438줄 제거).
- 평가 목록 표시(읽기)는 유지. "평가 작성은 coach-finder 에서" 안내 추가.

## Consequences (결과)
### Positive
- 평가 데이터의 단일 작성 주체 확보 — 제품 간 충돌 제거.
- To-Be 분리 아키텍처(ADR-018/019)의 선행 정지작업.
### Negative / Trade-off
- coaching-log 사용자(PM)는 평가 작성 시 coach-finder 로 이동해야 함.
- RLS 차원의 쓰기 봉인은 별도 (UI 강등이 1차 경계).
### 영향 받는 코드 · 문서 · DB
- `public/index.html` (모달·함수·버튼 제거) · DB 무변경.

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| 양쪽 쓰기 + 충돌 해결 | 두 제품 모두 쓰기 유지 | 충돌 해결 복잡도, 책임 모호 |
| coaching-log 단독 쓰기 | 반대 방향 이전 | 평가는 섭외 의사결정 도구 — coach-finder 가 자연 소유자 |

## 검증 (Acceptance)
- [x] `node --check` 통과, 제거 함수 grep 0건 (커밋 시점)
- [x] 읽기 경로(`_bpDetailEvaluations`) 동작 유지 확인
