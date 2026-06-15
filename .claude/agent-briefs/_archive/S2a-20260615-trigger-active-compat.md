# 브리프 S2a-20260615-trigger-active-compat — 트리거 active 호환 (ADR-023 롤아웃 1단계)

## 배경 (Why)
ADR-023 (docs/decisions/023-status-single-lifecycle-coachfinder-sot.md 필독) 롤아웃 **1단계**. 최종 목표는 business_plans.status 를 planning/active/completed/cancelled 단일 라이프사이클로 통일하고 트리거가 `active` 진입 시 발화. 하지만 coach-finder 가 아직 `won` 을 보내므로, **지금 트리거를 active 전용으로 바꾸면 수주가 깨진다.** 그래서 1단계는 **과도기 호환**: 트리거가 `won` OR `active` 둘 다에서 발화하게 한다.

⚠️ 이 단계에서는 CHECK 제약·데이터 변환·coach-finder 코드를 **건드리지 않는다** (각각 4·3·2단계). 트리거 함수/조건만.

## 산출물
신규 마이그레이션 1개: `supabase/migrations/20260615_phase_ac_trigger_active_compat.sql`

## 스펙
현행 트리거(`20260428_phase5b_business_plans.sql` 정의 + `20260605_phase_x_tobe_foundations.sql:35-73` 함수 재정의): `CREATE TRIGGER bp_on_won AFTER UPDATE ... WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status='won' AND NEW.project_id IS NULL)`.

변경:
1. **트리거 발화 조건 확장**: `NEW.status IN ('won','active')` 로. 그리고 **AFTER INSERT OR UPDATE** 로 확장(사업이 처음부터 active/won 으로 생성되는 경우도 커버). INSERT 시엔 OLD 가 없으므로 WHEN 조건을 INSERT/UPDATE 양쪽에서 안전하게 작성:
   - UPDATE: `OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('won','active') AND NEW.project_id IS NULL`
   - INSERT: `NEW.status IN ('won','active') AND NEW.project_id IS NULL`
   - 트리거를 둘로 나누거나(bp_lifecycle_ins / bp_lifecycle_upd), 하나의 WHEN 으로 `TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status` 형태. **함수 본문에서 TG_OP 분기**가 안전. 판단해 구현하고 보고.
2. **함수 본문은 기존 그대로 재사용**: projects 생성 + business_plans.project_id 역링크 + project_members(가입자) + project_invites(미가입). `project_id IS NULL` 가드로 **중복 생성·재발화 방지** (이미 projects 있는 won 10건은 재발화 안 됨).
3. 기존 트리거명(bp_on_won)은 DROP 후 새로 만들거나 유지 — 변경 금지 항목이므로 ADR-023 을 근거로 재정의함을 헤더 주석에 명시. 트리거명은 `bp_lifecycle_sync` 로 바꾸되 기존 bp_on_won 은 DROP (이름 변종 방어).
4. 멱등(CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER). 헤더 주석(한국어, phase_z/aa 스타일) + `-- 검증` (트리거 존재·조건 확인 SQL, 그리고 "won/active 둘 다 발화" 설명).
5. ⚠️ **completed/cancelled 동기화는 이 단계에서 넣지 않는다** (최종 4단계에서). 1단계는 "생성"만 active 호환.

## CAN touch
- 신규 마이그레이션 파일 1개만.

## MUST NOT
- 기존 마이그레이션 수정 금지. CHECK 제약·데이터·index.html·api·coach-finder 금지. RLS 금지. git 금지.
- 함수 본문 로직(누가 members/invites 되는지) 변경 금지 — 발화 조건만 확장.

## 검증
- SQL 문법·멱등 자체 점검. 트리거가 won·active 양쪽에서, INSERT·UPDATE 양쪽에서, project_id NULL 일 때만 발화함을 조건식으로 증명.
- 기존 won 10건(project_id 있음) 재발화 안 됨을 가드로 설명.
- ⚠️ 라이브 적용은 메인이 함.
- Return Format 5섹션.
