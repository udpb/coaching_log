-- Phase F (Firebase 0%): support coach-finder's project model on top of
-- coaching-log's existing business_plans / business_plan_coaches /
-- coach_evaluations triple. Coach-finder's "Project" is the same concept
-- as a coaching-log BP, so we extend the BP tables rather than duplicating.
--
-- What gets added:
--   1. business_plan_coaches.payment_info jsonb
--      Stores coach-finder's per-coach payment fields
--      ({payRole, payGrade, payUnit, payRatio, unitPrice, sessions, totalAmount}).
--      Nullable; coaching-log doesn't populate it (BPs created in coaching-log
--      stay payment-less unless someone fills it in via coach-finder).
--   2. business_plan_coaches.task_summary text
--      Coach-finder stores `taskSummary` per coach (e.g., "워크숍 운영").
--      Different from `notes` which is meant for PM internal memos.
--   3. business_plans.client text
--      Coach-finder has a `client` field separate from client_org.
--      In Firestore it's free-form. We map it to a new column rather than
--      stretching client_org's semantics.
--   4. business_plans.total_budget numeric
--      Coach-finder's `totalBudget` (사업 총 예산). Numeric in KRW.
--   5. business_plans.status check constraint extended to include
--      'planning' / 'active' / 'completed' (coach-finder's three states)
--      ALONGSIDE the existing 'draft' / 'proposed' / 'won' / 'lost' /
--      'cancelled'. The 수주(won) trigger logic only fires when transitioning
--      to 'won'; the new states never reach the trigger so they're safe.
--      A status-mapping comment on the column documents which UI uses which.
--
-- This migration is idempotent (DROP CONSTRAINT IF EXISTS / IF NOT EXISTS).

-- ─────────────────────────────────────────────────────────────
-- 1. business_plan_coaches: payment_info + task_summary
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.business_plan_coaches
  ADD COLUMN IF NOT EXISTS payment_info jsonb,
  ADD COLUMN IF NOT EXISTS task_summary text;

COMMENT ON COLUMN public.business_plan_coaches.payment_info IS
  'coach-finder의 코치별 단가 정보. {payRole, payGrade, payUnit, payRatio, unitPrice, sessions, totalAmount}. coaching-log은 이 필드를 채우지 않음.';
COMMENT ON COLUMN public.business_plan_coaches.task_summary IS
  'coach-finder의 코치별 업무 요약 (예: "워크숍 운영"). PM 내부 메모는 notes 컬럼 사용.';

-- ─────────────────────────────────────────────────────────────
-- 2. business_plans: client + total_budget
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.business_plans
  ADD COLUMN IF NOT EXISTS client text,
  ADD COLUMN IF NOT EXISTS total_budget numeric;

COMMENT ON COLUMN public.business_plans.client IS
  'coach-finder가 사용하는 고객사 자유 텍스트 필드. client_org는 정형 조직명, client는 자유 입력. UI가 다른 의미로 쓰일 수 있음.';
COMMENT ON COLUMN public.business_plans.total_budget IS
  '사업 총 예산 (원). coach-finder의 totalBudget과 매핑. coaching-log의 estimated_budget과 별개.';

-- ─────────────────────────────────────────────────────────────
-- 3. business_plans.status — extend allowed values
-- ─────────────────────────────────────────────────────────────
-- Drop old constraint, add a wider one. The bp_on_won trigger fires
-- only on transition to 'won', so adding 'planning'/'active'/'completed'
-- as additional values is non-disruptive.
ALTER TABLE public.business_plans
  DROP CONSTRAINT IF EXISTS business_plans_status_check;

ALTER TABLE public.business_plans
  ADD CONSTRAINT business_plans_status_check
  CHECK (status IN (
    -- coaching-log's lifecycle (Phase 5-B)
    'draft','proposed','won','lost','cancelled',
    -- coach-finder's lifecycle (legacy from Firestore)
    'planning','active','completed'
  ));

COMMENT ON COLUMN public.business_plans.status IS
  'BP lifecycle. coaching-log uses draft/proposed/won/lost/cancelled (수주 트리거는 won에만 fire). coach-finder uses planning/active/completed. UI가 자신의 lifecycle만 노출.';
