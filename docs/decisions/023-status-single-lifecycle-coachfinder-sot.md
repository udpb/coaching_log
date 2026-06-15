# ADR-023: 사업 status 단일 라이프사이클 — coach-finder 진실원천, coaching-log 추종

| 메타 | 값 |
|------|----|
| 상태 | Accepted (사용자 승인 2026-06-15) |
| 일자 | 2026-06-15 |
| 작성자 | 메인 세션 (사용자: "PM이 coach-finder로 사업 전체 관리, coaching-log는 프로세스 따라감") |
| Supersedes | coach-finder ADR-014 (DB enum 정본 draft/proposed/won/lost/cancelled) — 본 ADR 이 대체 |
| 관련 | ADR-018/019 (To-Be 봉인) · 연성테스트 미발현 버그 |

---

## Context (왜)
`business_plans.status`(coach-finder)와 `projects.status`(coaching-log)가 **두 테이블 + 이중 어휘**로 갈려 PM·코치 모두 혼란:
- coach-finder 가 DB `won` 을 화면에서 "진행 중"으로, `lost/cancelled`(무산)를 "종료"로 뭉뚱그림 → 수주(won)와 진행(active), 종료와 무산이 안 구분됨.
- "진행중/종료" 상태가 실제로는 coaching-log 의 projects 에 있어, **PM 이 coach-finder 에서 사업의 전체 프로세스를 못 본다**(거꾸로).
- 연성테스트가 `business_plans.status='active'`(UI 별칭이 DB로 샘)로 저장돼 트리거(`won` 대기)를 빗나감 → 코칭로그에 안 뜸.

**사용자 관점 (결정의 기준):** 사업 관리 주체는 PM, 핵심 도구는 coach-finder. **coach-finder 에서 모든 프로세스가 표시되어야 하고, coaching-log 는 그 프로세스를 따라간다.** 필요한 단계는 **기획 / 진행중 / 종료** 3개.

## Decision (무엇을)
**`business_plans.status` 를 사업 전체 라이프사이클의 단일 진실원천으로 만든다.** coaching-log 의 projects 는 이를 추종(미러)한다.

### status 어휘 (영어 정본 — 3단계 + 무산)
| 사용자 표시 | business_plans.status (SoT) | 의미 |
|---|---|---|
| 기획 | `planning` | 사업 준비 (수주 전, coach-finder) |
| 진행중 | `active` | 수주 확정 → 코칭 진행 |
| 종료 | `completed` | 코칭 종료 |
| (무산) | `cancelled` | 수주 못 함/취소 |

- **폐지**: `draft`·`proposed`·`won`·`lost` 는 위 4개로 매핑 흡수. 특히 **`won` 제거** — "기획 → 진행중(`active`)" 전환이 곧 수주이며, 그 전환점이 코칭로그 생성 트리거.

### projects(coaching-log) 추종
- `business_plans.status` 가 `active` 로 전환되는 순간 → 트리거가 projects 생성(`active`).
- `business_plans.status` 가 `completed`/`cancelled` 로 가면 → 트리거가 projects.status 동기화(closed).
- projects.status 어휘도 정합: `active`(진행중) / `closed`(종료) / `archived`(보관). coaching-log 는 사업 상태를 **읽어 표시만**, 라이프사이클 주도권은 coach-finder.

### 트리거 재정의 (bp_on_won → bp_lifecycle_sync)
- 현행 `WHEN NEW.status='won'` → **`WHEN NEW.status='active' AND NEW.project_id IS NULL`** (생성) + `completed/cancelled` 동기화 분기. SECURITY DEFINER 유지(봉인 우회). INSERT 도 커버(처음부터 active 로 생성되는 경우).

## Consequences
### Positive
- PM 이 coach-finder 한 곳에서 기획→진행중→종료 전체 표시·관리 (사용자 요구 충족).
- coaching-log 는 단순 추종 — 상태 어휘 혼선 제거.
- 연성테스트류(active 저장) 자동 정상화 — active 가 곧 트리거 발화 조건.
### Negative / Trade-off
- **두 제품 + 트리거 + 데이터 동시 변경** — 롤아웃 순서 어김 시 수주 흐름 깨짐(원자성 필요).
- coach-finder ADR-014 폐기(supersede) + coach-finder 코드(markWon·normalizeStatus·라벨·"종료" 액션 신설) 대수술.
- 기존 `won` 10건(이미 projects 보유) → `active` 마이그레이션 시 트리거 재발화 방지(project_id 가드).
### 영향
- coaching-log: 신규 마이그레이션(트리거 재정의 + CHECK 정리 + 데이터 변환) · index.html(status 라벨).
- coach-finder: status 어휘·전이·라벨·종료 액션 (별도 레포, 대응 ADR 필요).

## Alternatives Considered
| 옵션 | 왜 기각 |
|------|------|
| 두 테이블(business_plans/projects) 통합 | 봉인 아키텍처(수주前/後 분리) 대수술 — 위험 과다 |
| 현행 won 유지 + 라벨만 수정 | "진행중/종료"가 coaching-log 에 남아 PM 이 coach-finder 에서 전체 못 봄 — 사용자 요구 미충족 |
| coaching-log 가 status SoT | PM 핵심 도구가 coach-finder 라는 사용자 관점과 반대 |

## 삭제/취소 정책 (2026-06-15 추가 — 사용자 삭제 질문 발)
현행(조사 결과): coach-finder 가 사업을 **하드 삭제**(`.delete()`)한다. business_plan_coaches 는 CASCADE 동반 삭제, coach_evaluations·rfp_history 는 SET NULL, 그러나 **coaching-log 의 projects·project_members·coaching_logs 는 그대로 남아 고아(orphan)** 가 된다. 삭제 전 경고도 부실하고 수주된 사업도 제약 없이 삭제됨.

본 ADR 의 "coach-finder=SoT, coaching-log=추종" 원칙상 삭제도 추종해야 한다:
- **세션 기록(coaching_logs)은 보존** — 실제 코칭 이력이므로 사업이 사라져도 지우지 않는다.
- **수주 후(projects 생성됨) 사업은 하드 삭제 금지** → coach-finder 가 `cancelled`(soft) 처리. 트리거가 projects.status 를 closed/archived 로 동기화.
- **수주 전(planning) 사업**은 하드 삭제 허용(연결 프로젝트 없음).
- 기존 고아 projects(이미 BP 끊긴 것) → 데이터 정리 단계에서 진단 후 처리(archived 표시 또는 보존).
- ⚠️ 세부(고아 개수·처리 방식)는 데이터 정리 단계에서 라이브 진단 후 사용자와 확정.

## Migration / Rollout (순서 = 원자성 핵심)
1. **coaching-log 트리거 과도기 호환**: `won` OR `active` 둘 다 발화하도록 먼저 배포(기존 won 안 깨지게).
2. **coach-finder 코드**: status 를 planning/active/completed/cancelled 로 전이하도록 + 라벨 + "종료" 액션 신설 배포.
3. **데이터 마이그레이션**: 기존 `won`→`active`, `draft/proposed`→`planning`, `lost`→`cancelled` (project_id 있는 행은 트리거 재발화 skip).
4. **CHECK 제약 정본화**: business_plans.status = (planning/active/completed/cancelled) 로 좁힘. 트리거에서 won 분기 제거.
5. glossary·HANDOFF·CLAUDE.md status 정본 명문화.

## 검증 (Acceptance)
- [ ] coach-finder 에서 사업이 기획→진행중→종료 전부 표시
- [ ] "진행중"(active) 전환 시 coaching-log 에 프로젝트 생성, "종료" 시 동기화
- [ ] 기존 won 10건 회귀 0(projects 유지, 재발화 없음)
- [ ] 연성테스트 정상화
- [ ] 사용자 명시 승인
