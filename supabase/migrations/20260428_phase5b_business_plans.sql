-- Phase 5-B: business_plans + coach evaluations + 수주 trigger
-- Why: PM이 사업 기획 단계부터 수주, 코치 평가까지 일관되게 관리할 수 있도록
-- business_plans / business_plan_coaches / coach_evaluations 3개 테이블을 추가한다.
-- 수주(status='won') 시 트리거가 자동으로 projects 행과 project_members(accepted
-- 코치들)를 만들어 주므로 PM이 별도로 손으로 옮길 필요가 없고 누락도 방지된다.
-- coach_evaluations는 admin/pm만 SELECT 가능하다 — coach 본인은 자신의 평가를
-- 보지 못하는 것이 의도된 동작이다.
-- Idempotent: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS, CREATE OR REPLACE
-- 패턴으로 재실행 안전.

-- ─────────────────────────────────────────────────────────────
-- 1. business_plans — PM이 관리하는 사업 기획/제안 단위
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  client_org        text,
  description       text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','proposed','won','lost','cancelled')),
  target_start_date date,
  target_end_date   date,
  estimated_budget  numeric,
  notes             text,
  project_id        uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_plans_status     ON public.business_plans(status);
CREATE INDEX IF NOT EXISTS idx_business_plans_created_by ON public.business_plans(created_by);
CREATE INDEX IF NOT EXISTS idx_business_plans_project    ON public.business_plans(project_id);

-- ─────────────────────────────────────────────────────────────
-- 2. business_plan_coaches — 사업 기획에 후보로 올라간 코치들
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_plan_coaches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_plan_id    uuid NOT NULL REFERENCES public.business_plans(id) ON DELETE CASCADE,
  coach_directory_id  uuid NOT NULL REFERENCES public.coaches_directory(id) ON DELETE CASCADE,
  rank                int,
  status              text NOT NULL DEFAULT 'candidate'
                      CHECK (status IN ('candidate','proposed','accepted','rejected','withdrawn')),
  notes               text,
  added_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at            timestamptz DEFAULT now(),
  UNIQUE (business_plan_id, coach_directory_id)
);

CREATE INDEX IF NOT EXISTS idx_bp_coaches_bp      ON public.business_plan_coaches(business_plan_id);
CREATE INDEX IF NOT EXISTS idx_bp_coaches_cd      ON public.business_plan_coaches(coach_directory_id);
CREATE INDEX IF NOT EXISTS idx_bp_coaches_status  ON public.business_plan_coaches(status);

-- ─────────────────────────────────────────────────────────────
-- 3. coach_evaluations — admin/pm이 코치를 평가하는 기록
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_evaluations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_directory_id   uuid NOT NULL REFERENCES public.coaches_directory(id) ON DELETE CASCADE,
  business_plan_id     uuid REFERENCES public.business_plans(id) ON DELETE SET NULL,
  project_id           uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  evaluator_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_overall       int CHECK (rating_overall BETWEEN 1 AND 5),
  rating_communication int CHECK (rating_communication BETWEEN 1 AND 5),
  rating_expertise     int CHECK (rating_expertise BETWEEN 1 AND 5),
  rating_reliability   int CHECK (rating_reliability BETWEEN 1 AND 5),
  would_rehire         boolean,
  comment              text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_evals_cd        ON public.coach_evaluations(coach_directory_id);
CREATE INDEX IF NOT EXISTS idx_coach_evals_evaluator ON public.coach_evaluations(evaluator_id);
CREATE INDEX IF NOT EXISTS idx_coach_evals_bp        ON public.coach_evaluations(business_plan_id);
CREATE INDEX IF NOT EXISTS idx_coach_evals_project   ON public.coach_evaluations(project_id);

-- ─────────────────────────────────────────────────────────────
-- 4. updated_at 트리거 — projects_touch_updated_at 패턴 재사용
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.business_plans_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS business_plans_touch_updated_at ON public.business_plans;
CREATE TRIGGER business_plans_touch_updated_at
  BEFORE UPDATE ON public.business_plans
  FOR EACH ROW EXECUTE FUNCTION public.business_plans_touch_updated_at();

CREATE OR REPLACE FUNCTION public.coach_evaluations_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS coach_evaluations_touch_updated_at ON public.coach_evaluations;
CREATE TRIGGER coach_evaluations_touch_updated_at
  BEFORE UPDATE ON public.coach_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.coach_evaluations_touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. 수주 트리거 — status 'won' 전환 시 projects + project_members 자동 생성
--    SECURITY DEFINER로 RLS 우회(시스템 동작). AFTER UPDATE이므로 NEW를
--    바꾸는 대신 별도 UPDATE로 project_id를 채운다.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_business_plan_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  INSERT INTO public.projects (name, description, status, start_date, end_date, created_by)
  VALUES (NEW.title, NEW.description, 'active', NEW.target_start_date, NEW.target_end_date, NEW.created_by)
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bp_on_won ON public.business_plans;
CREATE TRIGGER bp_on_won
  AFTER UPDATE ON public.business_plans
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status = 'won'
    AND NEW.project_id IS NULL
  )
  EXECUTE FUNCTION public.handle_business_plan_won();

-- ─────────────────────────────────────────────────────────────
-- 6. RLS — business_plans
--    SELECT: admin/pm 전체, 또는 연결된 project의 멤버
--    INSERT: admin/pm
--    UPDATE: admin 전체, pm은 본인이 만든 것만
--    DELETE: admin only
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.business_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "business_plans_select" ON public.business_plans;
CREATE POLICY "business_plans_select"
  ON public.business_plans FOR SELECT
  USING (
    public.is_admin_or_pm()
    OR (project_id IS NOT NULL AND public.is_project_member(project_id))
  );

DROP POLICY IF EXISTS "business_plans_insert" ON public.business_plans;
CREATE POLICY "business_plans_insert"
  ON public.business_plans FOR INSERT
  WITH CHECK (public.is_admin_or_pm());

DROP POLICY IF EXISTS "business_plans_update" ON public.business_plans;
CREATE POLICY "business_plans_update"
  ON public.business_plans FOR UPDATE
  USING (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "business_plans_delete" ON public.business_plans;
CREATE POLICY "business_plans_delete"
  ON public.business_plans FOR DELETE
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 7. RLS — business_plan_coaches
--    SELECT: admin/pm
--    INSERT/UPDATE/DELETE: admin 전체, pm은 본인이 만든 business_plan에 한해
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.business_plan_coaches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bp_coaches_select" ON public.business_plan_coaches;
CREATE POLICY "bp_coaches_select"
  ON public.business_plan_coaches FOR SELECT
  USING (public.is_admin_or_pm());

DROP POLICY IF EXISTS "bp_coaches_insert" ON public.business_plan_coaches;
CREATE POLICY "bp_coaches_insert"
  ON public.business_plan_coaches FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.business_plans bp
         WHERE bp.id = business_plan_coaches.business_plan_id
           AND bp.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "bp_coaches_update" ON public.business_plan_coaches;
CREATE POLICY "bp_coaches_update"
  ON public.business_plan_coaches FOR UPDATE
  USING (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.business_plans bp
         WHERE bp.id = business_plan_coaches.business_plan_id
           AND bp.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.business_plans bp
         WHERE bp.id = business_plan_coaches.business_plan_id
           AND bp.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "bp_coaches_delete" ON public.business_plan_coaches;
CREATE POLICY "bp_coaches_delete"
  ON public.business_plan_coaches FOR DELETE
  USING (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.business_plans bp
         WHERE bp.id = business_plan_coaches.business_plan_id
           AND bp.created_by = auth.uid()
      )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 8. RLS — coach_evaluations
--    SELECT: admin/pm only (coach 본인은 자신 평가를 못 봄 — 의도된 동작)
--    INSERT: admin/pm
--    UPDATE: admin 전체, pm은 본인이 작성한 것만
--    DELETE: admin only
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coach_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach_evaluations_select" ON public.coach_evaluations;
CREATE POLICY "coach_evaluations_select"
  ON public.coach_evaluations FOR SELECT
  USING (public.is_admin_or_pm());

DROP POLICY IF EXISTS "coach_evaluations_insert" ON public.coach_evaluations;
CREATE POLICY "coach_evaluations_insert"
  ON public.coach_evaluations FOR INSERT
  WITH CHECK (public.is_admin_or_pm());

DROP POLICY IF EXISTS "coach_evaluations_update" ON public.coach_evaluations;
CREATE POLICY "coach_evaluations_update"
  ON public.coach_evaluations FOR UPDATE
  USING (
    public.is_admin()
    OR (public.is_pm() AND evaluator_id = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (public.is_pm() AND evaluator_id = auth.uid())
  );

DROP POLICY IF EXISTS "coach_evaluations_delete" ON public.coach_evaluations;
CREATE POLICY "coach_evaluations_delete"
  ON public.coach_evaluations FOR DELETE
  USING (public.is_admin());
