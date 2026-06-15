-- ─────────────────────────────────────────────────────────────────────
-- Phase AC (2026-06-15): 수주 트리거 active 과도기 호환 (ADR-023 롤아웃 1단계)
--
-- 근거: docs/decisions/023-status-single-lifecycle-coachfinder-sot.md (Accepted 2026-06-15).
--   ADR-023 은 business_plans.status 를 사업 전체 단일 라이프사이클
--   (planning/active/completed/cancelled)의 진실원천으로 만든다. 최종적으로 트리거는
--   status='active' 진입 시 projects 를 생성한다. 그러나 coach-finder 가 아직 'won' 을
--   보내므로(2단계 전), 지금 'active' 전용으로 바꾸면 수주 흐름이 깨진다.
--   → 본 1단계는 **과도기 호환**: 트리거가 'won' OR 'active' 둘 다에서 발화하게 한다.
--
-- ⚠️ 변경 금지 항목(bp_on_won 트리거)이지만 ADR-023 승인으로 재정의 허용. 본 마이그레이션은
--   **트리거 발화 조건만** 확장한다. 함수 본문(누가 members/invites 되는지)은
--   phase_x(20260605_phase_x_tobe_foundations.sql:35-73) 정의 그대로 재사용.
--
-- 이 단계에서 건드리지 않는 것 (각각 다음 단계):
--   - CHECK 제약 정본화(planning/active/completed/cancelled) → 4단계
--   - 데이터 변환(won→active 등)                              → 3단계
--   - completed/cancelled 동기화(projects closed/archived)    → 4단계
--   - coach-finder 코드 / index.html / RLS                    → 별도
--
-- 변경 요약:
--   1) 트리거명 bp_on_won → bp_lifecycle_sync_ins/_upd (기존 bp_on_won DROP).
--      ※ TG_OP 는 WHEN 절에서 못 쓰므로 INSERT/UPDATE 트리거를 분리(함수는 공유).
--   2) AFTER UPDATE → AFTER INSERT + AFTER UPDATE (처음부터 active/won 생성도 커버).
--   3) 발화 조건 NEW.status='won' → NEW.status IN ('won','active').
--   4) project_id IS NULL 가드 유지 → 이미 projects 보유한 기존 won 10건 재발화 방지.
--
-- 멱등: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER. 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. 함수 본문 — phase_x 정의 그대로 재현 (변경 없음) ════════════════════
-- (a) projects 생성 + business_plan_id 역링크
-- (b) 가입 accepted 코치 → project_members
-- (c) 미가입 accepted 코치 → project_invites (예약, PM 명시 승격 대기)
-- INSERT/UPDATE 양쪽에서 호출되지만 본문은 NEW 만 참조하므로 OLD 부재(INSERT) 안전.
CREATE OR REPLACE FUNCTION public.handle_business_plan_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  -- ★ projects 생성 시 business_plan_id 역링크 동시 기록
  INSERT INTO public.projects (name, description, status, start_date, end_date, created_by, business_plan_id)
  VALUES (NEW.title, NEW.description, 'active', NEW.target_start_date, NEW.target_end_date, NEW.created_by, NEW.id)
  RETURNING id INTO new_project_id;

  UPDATE public.business_plans
     SET project_id = new_project_id
   WHERE id = NEW.id;

  INSERT INTO public.project_members (project_id, user_id, role, added_by)
  SELECT new_project_id, cd.linked_user_id, 'coach', NEW.created_by
    FROM public.business_plan_coaches bpc
    JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
   WHERE bpc.business_plan_id = NEW.id
     AND bpc.status = 'accepted'
     AND cd.linked_user_id IS NOT NULL
  ON CONFLICT (project_id, user_id) DO NOTHING;

  INSERT INTO public.project_invites (project_id, coach_directory_id, role, invited_by)
  SELECT new_project_id, bpc.coach_directory_id, 'coach', NEW.created_by
    FROM public.business_plan_coaches bpc
    JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
   WHERE bpc.business_plan_id = NEW.id
     AND bpc.status = 'accepted'
     AND cd.linked_user_id IS NULL
  ON CONFLICT (project_id, coach_directory_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ═══ 2. 트리거 재정의 — won/active × INSERT/UPDATE 호환 ═════════════════════
-- ⚠️ TG_OP 는 트리거 함수 본문에서만 유효하고 CREATE TRIGGER 의 WHEN 절에서는
--    사용 불가(ERROR 42703). 따라서 INSERT 용·UPDATE 용 트리거를 분리한다.
--    (함수 handle_business_plan_won 은 공유 — 본문은 NEW 만 참조해 양쪽 안전.)
-- 기존 bp_on_won 및 이전 이름 변종 모두 제거 후 재생성(멱등).
DROP TRIGGER IF EXISTS bp_on_won              ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync      ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync_ins  ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync_upd  ON public.business_plans;

-- INSERT: 처음부터 won/active 로 생성되는 경우 (OLD 없음 → 전이 검사 생략).
CREATE TRIGGER bp_lifecycle_sync_ins
  AFTER INSERT ON public.business_plans
  FOR EACH ROW
  WHEN (NEW.status IN ('won','active') AND NEW.project_id IS NULL)
  EXECUTE FUNCTION public.handle_business_plan_won();

-- UPDATE: status 가 실제로 won/active 로 바뀐 경우만 (이미 projects 보유 시 가드).
CREATE TRIGGER bp_lifecycle_sync_upd
  AFTER UPDATE ON public.business_plans
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('won','active')
    AND NEW.project_id IS NULL
  )
  EXECUTE FUNCTION public.handle_business_plan_won();

-- ─────────────────────────────────────────────────────────────────────
-- 적용 후 검증 (라이브는 메인이 실행):
--
-- (1) 트리거 2개(bp_lifecycle_sync_ins/_upd) 존재 + WHEN 조건 확인, bp_on_won 0행:
--     SELECT tgname,
--            (tgtype & 4) <> 0  AS fires_insert,   -- TRIGGER_TYPE_INSERT
--            (tgtype & 16) <> 0 AS fires_update,   -- TRIGGER_TYPE_UPDATE
--            pg_get_triggerdef(oid)
--       FROM pg_trigger
--      WHERE tgrelid = 'public.business_plans'::regclass
--        AND NOT tgisinternal;
--     -- 기대: bp_lifecycle_sync 1행, fires_insert=t, fires_update=t.
--     --       bp_on_won 은 0행(DROP 됨).
--
-- (2) 발화 조건 매트릭스 — 'won' 과 'active' 둘 다, project_id NULL 일 때만 잡힘:
--     - UPDATE status NULL/draft→'won',    project_id NULL  → 발화 (기존 흐름 유지)
--     - UPDATE status draft→'active',       project_id NULL  → 발화 (ADR-023 신규)
--     - INSERT status='active',             project_id NULL  → 발화 (처음부터 active)
--     - INSERT status='won',                project_id NULL  → 발화 (처음부터 won)
--     - UPDATE 무엇이든,                    project_id NOT NULL → 미발화 (가드)
--     - UPDATE status='won'→'won'(무변동),  project_id NULL  → 미발화 (DISTINCT 가드)
--     - UPDATE/INSERT status='lost'/'cancelled'/'proposed'  → 미발화 (IN 목록 밖)
--
-- (3) 기존 won 10건 회귀 0:
--     이 10건은 이미 projects 를 보유 → business_plans.project_id IS NOT NULL.
--     본 마이그레이션은 함수/트리거 정의만 교체하고 UPDATE 를 트리거하지 않으므로
--     재발화 자체가 없다. 추후 어떤 UPDATE 가 와도 project_id NOT NULL 가드에서 차단되어
--     projects 중복 생성·members/invites 재삽입이 발생하지 않는다.
--     (참고 진단: SELECT count(*) FROM business_plans WHERE status='won' AND project_id IS NOT NULL;)
-- ─────────────────────────────────────────────────────────────────────
