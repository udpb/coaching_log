# 브리프 B2-20260615-joined-at-fix — project_members.joined_at 컬럼 버그 + 스키마 정합 전수 점검

## 배경 (Why)
"내 참여 사업"/"배정 사업" 탭에서 `조회 실패: column project_members.joined_at does not exist`.
원인: project_members 실제 컬럼은 **`added_at`** (supabase/migrations/20260423_phase4b_projects.sql:32). 프론트가 `joined_at` 을 select·order 함. (직전 B1 이 같은 select 줄의 target_start_date 만 고치고 joined_at 을 놓쳤다.)

## 수정 (public/index.html)
1. **:8224** select: `joined_at,` → `joined_at:added_at,` (별칭 — 반환 키 유지)
2. **:8226** order: `.order('joined_at', { ascending: false })` → `.order('added_at', { ascending: false })` (order 는 실제 컬럼명 필요 — 별칭 불가)
3. **:8362** select: `role, joined_at,` → `role, joined_at:added_at,` (별칭)
4. **:8364** order: `.order('joined_at', ...)` → `.order('added_at', ...)`
각 변경에 간결한 주석(B2).

## 추가 — 스키마 정합 전수 점검 (재발 방지)
이런 컬럼명 불일치가 반복되므로, **projects · project_members · project_invites 를 조회(.from/.select)하는 모든 코드**를 찾아, select 한 컬럼이 실제 마이그레이션 정의에 존재하는지 대조하라.
- projects 실제 컬럼: id·name·description·status·start_date·end_date·created_by·created_at·updated_at·business_plan_id (phase4b:10-20, phase_x:27-29). **required_kpis 는 아직 없음**(ADR-022 미적용 — 조회 금지).
- project_members 실제 컬럼: id·project_id·user_id·role·added_at·added_by (phase4b:27-35).
- project_invites 실제 컬럼: supabase/migrations/20260605_phase_w_project_invites.sql 에서 확인.
- 불일치를 추가로 발견하면 같은 방식(별칭 또는 실컬럼)으로 수정하고 **목록으로 보고**. 발견 못 하면 "추가 불일치 없음" 명시.
- ⚠️ business_plans 를 조회하는 곳의 target_start_date 등은 올바르니 건드리지 말 것.

## CAN touch
- `public/index.html` 만.

## MUST NOT
- DB·마이그레이션·API·RLS 변경 금지. git 금지. business_plans 조회 컬럼 불변.

## 검증
- 인라인 스크립트 node --check.
- 변경 라인 목록 + 전수 점검 결과(점검한 .select 위치들과 각 컬럼 정합 여부) 보고.
- Return Format 5섹션.
