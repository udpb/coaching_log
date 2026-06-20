-- ─────────────────────────────────────────────────────────────────────
-- Phase AE (2026-06-15): status 스키마 확정 (ADR-023 롤아웃 4단계)
--
-- 근거: docs/decisions/023-status-single-lifecycle-coachfinder-sot.md (Accepted 2026-06-15).
-- 브리프: .claude/agent-briefs/S34-20260615-status-data-and-schema.md
--
-- ⚠️ 적용 순서 — 반드시 20260615_phase_ad_status_data_normalize.sql(A) 적용 후에만
--    본 파일(B)을 적용한다. A 가 구 어휘(won/draft/proposed/lost)를 정본 4값으로
--    변환·흡수해야:
--      · 본 파일 3.의 CHECK 정본화(planning/active/completed/cancelled) 위반 행이 0,
--      · 트리거에서 won 분기를 빼도 더 이상 won 이 들어오지 않음(2단계 후 + A 변환).
--    순서를 뒤집으면 CHECK 생성이 위반 행으로 실패하거나 수주 흐름이 깨진다.
--
-- 이 단계에서 하는 일:
--   1) 트리거 active 전용화 — bp_lifecycle_sync_ins/_upd 의 WHEN 에서 won 제거.
--      함수 본문(handle_business_plan_won) 불변. INSERT/UPDATE 트리거 분리 유지.
--   2) completed/cancelled → projects 동기화 트리거 신설(bp_status_propagate_upd):
--      completed → projects.status='closed', cancelled → projects.status='archived'.
--   3) CHECK 정본화 — business_plans_status_check 를 4값으로 좁힘
--      (적용 전 위반 행 0 확인, 있으면 RAISE 로 중단).
--
-- ⚠️ TG_OP 는 CREATE TRIGGER 의 WHEN 절에서 사용 불가(ERROR 42703 — phase_ac 교훈).
--    WHEN 절에는 NEW/OLD 컬럼 식만. TG_OP/OLD-부재 분기는 함수 본문에서만.
--    → INSERT 용·UPDATE 용 트리거를 물리적으로 분리한다.
--
-- 멱등: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + CREATE TRIGGER.
--    CHECK 는 DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT. 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 0. 적용 전 가드 — 구 어휘 잔존 시 중단 (A 미적용 방지) ════════════════
-- A(phase_ad)가 먼저 적용됐는지 확인. 구 어휘가 남아 있으면 CHECK 정본화가
-- 실패하므로 여기서 명시적으로 중단해 순서 위반을 조기에 드러낸다.
DO $$
DECLARE
  v_legacy int;
BEGIN
  SELECT count(*) INTO v_legacy
    FROM public.business_plans
   WHERE status NOT IN ('planning', 'active', 'completed', 'cancelled');
  IF v_legacy > 0 THEN
    RAISE EXCEPTION
      'phase_ae 중단: 정본 4값 밖 status 행이 % 건 존재. 먼저 phase_ad(A)를 적용하라.', v_legacy;
  END IF;
END $$;

-- ═══ 1. 트리거 active 전용화 (won 제거) ════════════════════════════════════
-- 함수 본문은 phase_ac 정의 그대로 재현 — 변경 없음(NEW 만 참조 → INSERT 안전).
CREATE OR REPLACE FUNCTION public.handle_business_plan_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  -- projects 생성 + business_plan_id 역링크
  INSERT INTO public.projects (name, description, status, start_date, end_date, created_by, business_plan_id)
  VALUES (NEW.title, NEW.description, 'active', NEW.target_start_date, NEW.target_end_date, NEW.created_by, NEW.id)
  RETURNING id INTO new_project_id;

  UPDATE public.business_plans
     SET project_id = new_project_id
   WHERE id = NEW.id;

  -- 가입 accepted 코치 → project_members
  INSERT INTO public.project_members (project_id, user_id, role, added_by)
  SELECT new_project_id, cd.linked_user_id, 'coach', NEW.created_by
    FROM public.business_plan_coaches bpc
    JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
   WHERE bpc.business_plan_id = NEW.id
     AND bpc.status = 'accepted'
     AND cd.linked_user_id IS NOT NULL
  ON CONFLICT (project_id, user_id) DO NOTHING;

  -- 미가입 accepted 코치 → project_invites (예약)
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

-- 기존 트리거(과도기 won/active) 제거 후 active 전용으로 재생성.
-- ⚠️ INSERT/UPDATE 분리 유지 — WHEN 절에 TG_OP 금지.
DROP TRIGGER IF EXISTS bp_on_won              ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync      ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync_ins  ON public.business_plans;
DROP TRIGGER IF EXISTS bp_lifecycle_sync_upd  ON public.business_plans;

-- INSERT: 처음부터 active 로 생성되는 경우 (OLD 없음 → 전이 검사 생략).
CREATE TRIGGER bp_lifecycle_sync_ins
  AFTER INSERT ON public.business_plans
  FOR EACH ROW
  WHEN (NEW.status = 'active' AND NEW.project_id IS NULL)
  EXECUTE FUNCTION public.handle_business_plan_won();

-- UPDATE: status 가 실제로 active 로 바뀐 경우만 (이미 projects 보유 시 가드).
CREATE TRIGGER bp_lifecycle_sync_upd
  AFTER UPDATE ON public.business_plans
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status = 'active'
    AND NEW.project_id IS NULL
  )
  EXECUTE FUNCTION public.handle_business_plan_won();

-- ═══ 2. completed/cancelled → projects 동기화 트리거 신설 ═══════════════════
-- business_plans 가 completed/cancelled 로 전이될 때 연결된 projects.status 동기화.
--   completed → projects.status = 'closed'   (코칭 종료)
--   cancelled → projects.status = 'archived' (무산/취소 → 보관)
-- SECURITY DEFINER (봉인 RLS 우회). UPDATE 전용 — INSERT 시점엔 종료/취소로
-- 시작하는 일이 없고 project_id 도 없으므로 UPDATE 한 갈래면 충분.
-- ⚠️ WHEN 절에 TG_OP 금지 → UPDATE 전용 트리거 하나만 둔다.
CREATE OR REPLACE FUNCTION public.handle_business_plan_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NEW.project_id NOT NULL 인 경우만 진입(WHEN 에서 보장). status 별 매핑.
  IF NEW.status = 'completed' THEN
    UPDATE public.projects SET status = 'closed'   WHERE id = NEW.project_id;
  ELSIF NEW.status = 'cancelled' THEN
    UPDATE public.projects SET status = 'archived' WHERE id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bp_status_propagate      ON public.business_plans;
DROP TRIGGER IF EXISTS bp_status_propagate_upd  ON public.business_plans;

CREATE TRIGGER bp_status_propagate_upd
  AFTER UPDATE ON public.business_plans
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status IN ('completed', 'cancelled')
    AND NEW.project_id IS NOT NULL
  )
  EXECUTE FUNCTION public.handle_business_plan_terminal();

-- ═══ 3. CHECK 정본화 — 4값으로 좁힘 ═══════════════════════════════════════
-- 적용 전 위반 행 재확인(0의 가드는 0.에서 이미 했으나 방어적으로 한 번 더).
-- inline CHECK 는 phase5b 에서 Postgres 가 business_plans_status_check 로 자동 명명.
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.business_plans
   WHERE status NOT IN ('planning', 'active', 'completed', 'cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'phase_ae 중단: business_plans_status_check 정본화 불가 — 위반 행 % 건. phase_ad 먼저.', v_bad;
  END IF;
END $$;

ALTER TABLE public.business_plans
  DROP CONSTRAINT IF EXISTS business_plans_status_check;

ALTER TABLE public.business_plans
  ADD CONSTRAINT business_plans_status_check
  CHECK (status IN ('planning', 'active', 'completed', 'cancelled'));

-- ─────────────────────────────────────────────────────────────────────
-- 검증 (라이브는 메인이 실행):
--
-- (1) 트리거 목록 — active 전용 발화 + terminal 동기화 확인:
--     SELECT tgname,
--            (tgtype & 4) <> 0  AS fires_insert,
--            (tgtype & 16) <> 0 AS fires_update,
--            pg_get_triggerdef(oid)
--       FROM pg_trigger
--      WHERE tgrelid = 'public.business_plans'::regclass
--        AND NOT tgisinternal
--      ORDER BY tgname;
--     -- 기대:
--     --   bp_lifecycle_sync_ins  (INSERT, WHEN status='active' AND project_id IS NULL)
--     --   bp_lifecycle_sync_upd  (UPDATE, WHEN ... status='active' ... project_id IS NULL)
--     --   bp_status_propagate_upd(UPDATE, WHEN ... status IN (completed,cancelled) ... project_id NOT NULL)
--     --   business_plans_touch_updated_at (BEFORE UPDATE)
--     -- bp_on_won / 'won' 포함 WHEN 은 0행(제거됨).
--
-- (2) CHECK 정의 4값:
--     SELECT pg_get_constraintdef(oid)
--       FROM pg_constraint
--      WHERE conrelid='public.business_plans'::regclass AND conname='business_plans_status_check';
--     -- 기대: CHECK (status = ANY (ARRAY['planning','active','completed','cancelled']))
--     -- 위반 INSERT 거부 확인:
--     --   INSERT ... status='won'  → 23514 check_violation (롤백).
--
-- (3) 기존 won 10건(→ phase_ad 에서 active 로 변환, 전부 project_id 있음) 재발화 0:
--     이 행들은 project_id IS NOT NULL → bp_lifecycle_sync_upd 의 project_id IS NULL
--     가드에서 차단되어 어떤 UPDATE 가 와도 projects 중복 생성·members/invites 재삽입
--     0건. 본 마이그레이션 자체는 정의만 교체하고 데이터 UPDATE 를 하지 않으므로
--     재발화가 발생할 트리거 이벤트 자체가 없다.
--     (진단: SELECT count(*) FROM business_plans WHERE status='active' AND project_id IS NOT NULL;)
--
-- (4) completed/cancelled 동기화 매트릭스 (테스트 BP 로 확인 — 라이브):
--     - UPDATE status active→completed, project_id NOT NULL
--          → projects.status = 'closed'    (발화)
--     - UPDATE status active→cancelled, project_id NOT NULL
--          → projects.status = 'archived'  (발화)
--     - UPDATE status active→completed, project_id NULL
--          → 미발화 (project_id NOT NULL 가드 — 연결 project 없음, 동기화 대상 없음)
--     - UPDATE status completed→completed (무변동)
--          → 미발화 (DISTINCT 가드)
--     - UPDATE status planning→active
--          → bp_status_propagate_upd 미발화(IN 목록 밖), bp_lifecycle_sync_upd 발화(생성)
-- ─────────────────────────────────────────────────────────────────────
