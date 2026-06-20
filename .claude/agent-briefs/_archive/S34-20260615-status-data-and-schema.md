# 브리프 S34-20260615 — status 데이터 변환(3단계) + 트리거 active 전용·CHECK 정본·동기화(4단계)

## 배경 (Why)
ADR-023 (docs/decisions/023-status-single-lifecycle-coachfinder-sot.md 필독) 롤아웃 **3·4단계**. 현재:
- 1단계 ✅ 배포: 트리거 `bp_lifecycle_sync_ins`/`_upd` 가 won·active 둘 다 발화(project_id NULL 가드). 함수 `handle_business_plan_won()`.
- 2단계 ✅ 배포: coach-finder 가 active 저장.
- 라이브 데이터(진단 2026-06-15): `won` 10건(전부 project_id 있음), `active` 1건(연성테스트, project_id NULL). 나머지 값 0건. (2단계 배포 후 신규 active 수주가 생겼을 수 있으니 **조건부로** 작성.)

## 산출물 (마이그레이션 2개 — 적용 순서 A→B)
1. `supabase/migrations/20260615_phase_ad_status_data_normalize.sql` (3단계 데이터)
2. `supabase/migrations/20260615_phase_ae_status_schema_final.sql` (4단계 스키마)

## A. 3단계 — 데이터 변환 (phase_ad)
구 어휘 → 정본 변환. **project_id 있는 행은 트리거 재발화 안 됨**(가드)이므로 안전:
- `UPDATE business_plans SET status='active'    WHERE status='won';`
- `UPDATE business_plans SET status='planning'  WHERE status IN ('draft','proposed');`
- `UPDATE business_plans SET status='cancelled' WHERE status='lost';`

**연성테스트류 복구** — `status='active' AND project_id IS NULL` 인 사업(트리거를 못 거친 것)에 대해 projects 를 생성해야 한다. active→active 는 upd 트리거(OLD DISTINCT NEW)를 못 깨우므로, **DO 블록으로 각 해당 행에 트리거 함수 로직을 수동 실행**하거나(권장: 함수를 재사용 가능한 형태면 호출, 아니면 INSERT projects + 역링크 + members/invites 직접 — phase_x/phase_ac 함수 본문과 동일하게), 또는 **status 토글**(active→planning→active)로 upd 트리거 발화. 어느 방식이든 **이미 project 있는 행은 건드리지 말 것**(project_id IS NULL 한정). 멱등: 두 번 실행해도 projects 중복 생성 안 되게(project_id 재확인).

**고아 진단(처리는 보고만)**: `projects` 중 `business_plan_id IS NULL` 또는 `business_plan_id` 가 삭제된 BP 를 가리키는 행 수를 `-- 검증` 쿼리로 집계. **삭제/변경은 하지 말고** 개수만 보고(사용자 결정 대기 — ADR-023 삭제정책 미확정).

헤더 주석 + `-- 검증`(변환 전후 status 분포, 연성테스트 project 생겼는지, 고아 수).

## B. 4단계 — 스키마 확정 (phase_ae) — A 적용 후에만
1. **트리거 active 전용화**: `bp_lifecycle_sync_ins`/`_upd` 의 WHEN 을 `NEW.status = 'active'` 로(won 제거). 함수 본문 불변(생성). 2단계 후 won 은 안 들어오고 A 가 won 을 없앴으므로 안전.
2. **completed/cancelled → projects 동기화**: business_plans 가 completed/cancelled 로 바뀔 때 연결 projects.status 를 동기화하는 트리거 신설(예 `bp_status_propagate`):
   - `NEW.status='completed' AND project_id IS NOT NULL` → `UPDATE projects SET status='closed'   WHERE id=NEW.project_id;`
   - `NEW.status='cancelled' AND project_id IS NOT NULL` → `UPDATE projects SET status='archived' WHERE id=NEW.project_id;`
   - AFTER UPDATE, WHEN(OLD.status DISTINCT FROM NEW.status). SECURITY DEFINER 함수.
3. **CHECK 정본화**: `business_plans_status_check` 를 DROP 후 `CHECK (status IN ('planning','active','completed','cancelled'))` 로 재생성. (A 후라 위반 행 없음 — 적용 전 위반 행 0 확인 쿼리 포함, 있으면 RAISE 로 중단.)
4. 멱등(DROP IF EXISTS + CREATE). 헤더 주석 + `-- 검증`(트리거 목록, CHECK 정의, completed/cancelled 동기화 매트릭스).

## CAN touch
- 위 신규 마이그레이션 2개만.

## MUST NOT
- 기존 마이그레이션 수정 금지. coach-finder·index.html·api 금지. 고아 데이터 삭제 금지(진단만). git 금지.
- ⚠️ B 는 A 적용 후에만 안전(순서 의존) — 두 파일 모두 작성하되 헤더에 순서 명시.

## 검증
- 두 파일 SQL 문법·멱등 자체 점검. **트리거 WHEN 절에 TG_OP 사용 금지**(함수 본문에서만 — 직전 phase_ac 핫픽스 교훈). INSERT/UPDATE 분리.
- A: 변환 매트릭스(won→active 등) + 연성테스트 복구 로직 + 고아 진단 쿼리.
- B: active 전용 발화 + completed/cancelled 동기화 + CHECK 4값. 기존 won 10건(active 변환됨, project 있음) 재발화 0 설명.
- ⚠️ 라이브 적용은 메인/사용자. 적용 순서 A→B 명시.
- Return Format 5섹션.
