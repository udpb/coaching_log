# 브리프 B1-20260615-projects-column-fix — projects 조회 컬럼명 버그 (내 참여 사업/배정 사업/계약서)

## 배경 (Why)
실사용 보고: "내 정보 > 내 참여 사업" 탭에서 `조회 실패: column projects_1.target_start_date does not exist` 에러로 탭 전체가 안 뜸.

원인 (확정): `projects` 테이블의 실제 컬럼은 **`start_date`/`end_date`** (supabase/migrations/20260423_phase4b_projects.sql:15-16). 그런데 프론트가 `project_members` → `project:project_id(...)` 조인으로 projects 를 조회할 때 존재하지 않는 `target_start_date`/`target_end_date` 를 select 함 → Supabase 가 쿼리 전체를 거부 → 탭 깨짐. (`target_start_date` 는 **business_plans** 테이블의 컬럼이며, bp_on_won 트리거가 business_plans.target_start_date → projects.start_date 로 올바르게 매핑해 넣는다. 즉 DB·트리거는 정상, 프론트 select 만 틀림.)

## 수정 방식 (Supabase select 별칭 — 최소 변경, 후속 코드 불변)
두 select 의 컬럼을 **별칭**으로 바꿔, 반환 객체 키는 `target_start_date`/`target_end_date` 로 유지한다. 이러면 후속 사용처(8240·8253·8293·8316·8376 등 `p.target_start_date`)는 **변경 불필요**.

1. `public/index.html:8224`
   - 현재: `.select('joined_at, project:project_id(id, name, target_start_date, target_end_date, status)')`
   - 변경: `.select('joined_at, project:project_id(id, name, target_start_date:start_date, target_end_date:end_date, status)')`
2. `public/index.html:8362`
   - 현재: `.select('role, joined_at, project:project_id(id, name, description, status, target_start_date, target_end_date)')`
   - 변경: `.select('role, joined_at, project:project_id(id, name, description, status, target_start_date:start_date, target_end_date:end_date)')`

각 변경 줄에 간결한 의도 주석 1줄 (예: `// projects 실제 컬럼은 start_date/end_date — 별칭으로 매핑 (B1)`).

## 절대 건드리지 말 것
- `business_plans` 를 조회하는 코드가 있으면 거기의 `target_start_date` 는 **올바르므로 그대로**. (현재 프론트는 business_plans 직접 조회 없음 — 혹시 있으면 STOP 후 보고.)
- 후속 사용처(8240·8253·8293·8316·8317·8376)의 `p.target_start_date`/`proj.target_start_date` 참조는 별칭 덕에 그대로 작동 — **수정하지 말 것.**
- downloadMyContract 의 docx 키(`start_date:`, `end_date:`)는 템플릿 키이므로 불변.

## CAN touch
- `public/index.html` (위 2줄만)

## MUST NOT
- DB·마이그레이션·API 변경 금지. RLS 금지. git 금지. 다른 컬럼/로직 변경 금지.

## 검증
- 인라인 스크립트 node --check.
- 변경 2줄 외 diff 없음을 보고 (git diff 로 확인하되 커밋은 메인).
- 별칭 문법이 Supabase select 규격(`alias:column`)에 맞는지 확인 보고.
- Return Format 5섹션.
