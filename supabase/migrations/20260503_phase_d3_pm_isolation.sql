-- Phase D3 — PM/Admin 가시성 분리 (2026-05-03)
--
-- 변경 의도:
--   이전(Phase 5-A): PM = "내부 직원 read-all". is_admin_or_pm() 한 함수로
--   admin/pm 묶음 → 모든 PM 이 모든 사업·코칭일지를 봄.
--
--   현재(D3): PM 은 "본인이 PM 인 사업" 만 봄.
--     - projects.created_by = auth.uid()  (PM 이 직접 만든 프로젝트)
--     - 또는 project_members 에 본인이 user_id=me 로 들어가 있음
--       (다른 PM 이 협업 차 명시적으로 추가한 경우)
--   Admin 만 전체 가시성 유지 (시스템 슈퍼유저).
--
--   결정 근거: 사용자 요청 "PM 은 본인 사업만, 단 이메일을 추가한 사람은
--   같이 볼 수 있도록" (2026-05-03 대화).
--
-- 동시에:
--   - project_members.role 에서 'lead_coach' 제거 (메인/보조 구분 안 함 결정).
--     기존 lead_coach 데이터는 'coach' 로 마이그.
--   - project_members.role 에 'pm' 추가 — 협업 PM 을 멤버로 들이는 케이스.
--   - coaches_directory_history.SELECT 는 admin only 로 좁힘 (audit 은 PM 권한 밖).
--
-- 멱등성: 모든 DROP POLICY / DROP CONSTRAINT 는 IF EXISTS, helper 함수는
-- CREATE OR REPLACE. 두 번 돌려도 안전.

-- ─────────────────────────────────────────────────────────────
-- 1. project_members.role enum 갱신
--    기존: ('lead_coach','coach','observer')
--    새  : ('pm','coach','observer')
--    데이터: lead_coach → coach 로 자동 마이그
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;

UPDATE public.project_members
   SET role = 'coach'
 WHERE role = 'lead_coach';

ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('pm', 'coach', 'observer'));

-- ─────────────────────────────────────────────────────────────
-- 2. Helper: is_pm_of_project(p_id)
--    PM 이며, 그 프로젝트의 created_by 거나 project_members 에 본인이 들어가 있음.
--    SECURITY DEFINER 로 RLS 재귀 없이 안전하게 조회.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_pm_of_project(p_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_pm()
    AND (
      EXISTS (
        SELECT 1 FROM public.projects
         WHERE id = p_id AND created_by = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.project_members
         WHERE project_id = p_id AND user_id = auth.uid()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_pm_of_project(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS — projects
-- ─────────────────────────────────────────────────────────────
-- SELECT: admin all / PM 본인 프로젝트 (created_by OR 멤버) / coach 멤버
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select"
  ON public.projects FOR SELECT
  USING (
    public.is_admin()
    OR public.is_pm_of_project(id)
    OR public.is_project_member(id)
  );

-- INSERT: admin + 모든 PM (새 프로젝트 자유롭게 생성)
DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
CREATE POLICY "projects_admin_insert"
  ON public.projects FOR INSERT
  WITH CHECK (public.is_admin() OR public.is_pm());

-- UPDATE/DELETE: admin OR pm 이 본인 프로젝트 (created_by) — 기존 phase5a 정책 유지
-- (project_members 에 pm 으로 들어간 협업 PM 도 update 권한 줄지 결정 필요.
--  당장은 보수적으로 created_by 만 — 사고 위험 줄이기. 향후 확장 가능.)
-- 정책은 phase5a 에 이미 정의되어 있으니 변경 없음.

-- ─────────────────────────────────────────────────────────────
-- 4. RLS — coaching_logs
-- ─────────────────────────────────────────────────────────────
-- SELECT: 본인 log / admin / PM 이 본인 프로젝트의 log / 같은 프로젝트 멤버
DROP POLICY IF EXISTS "coaching_logs_select" ON public.coaching_logs;
CREATE POLICY "coaching_logs_select"
  ON public.coaching_logs FOR SELECT
  USING (
    coach_id = auth.uid()
    OR public.is_admin()
    OR (
      project_id IS NOT NULL
      AND public.is_pm_of_project(project_id)
    )
    OR (
      project_id IS NOT NULL
      AND public.is_project_member(project_id)
    )
  );

-- INSERT/UPDATE/DELETE 는 phase4a 그대로 (own only).

-- ─────────────────────────────────────────────────────────────
-- 5. RLS — profiles
--    SELECT: 본인 / admin / PM 이 본인 프로젝트의 멤버 profiles
--    UPDATE: admin only (phase4a 정책 유지)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  USING (
    id = auth.uid()
    OR public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1
          FROM public.project_members pm
          JOIN public.projects p ON p.id = pm.project_id
         WHERE pm.user_id = profiles.id
           AND (
             p.created_by = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.project_members me
                WHERE me.project_id = p.id AND me.user_id = auth.uid()
             )
           )
      )
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 6. RLS — project_members
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select"
  ON public.project_members FOR SELECT
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR public.is_pm_of_project(project_id)
  );

-- INSERT: admin OR pm 이 본인 프로젝트 (created_by OR 멤버)
DROP POLICY IF EXISTS "project_members_admin_insert" ON public.project_members;
CREATE POLICY "project_members_admin_insert"
  ON public.project_members FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.is_pm_of_project(project_id)
  );

DROP POLICY IF EXISTS "project_members_admin_update" ON public.project_members;
CREATE POLICY "project_members_admin_update"
  ON public.project_members FOR UPDATE
  USING (
    public.is_admin()
    OR public.is_pm_of_project(project_id)
  )
  WITH CHECK (
    public.is_admin()
    OR public.is_pm_of_project(project_id)
  );

DROP POLICY IF EXISTS "project_members_admin_delete" ON public.project_members;
CREATE POLICY "project_members_admin_delete"
  ON public.project_members FOR DELETE
  USING (
    public.is_admin()
    OR public.is_pm_of_project(project_id)
  );

-- ─────────────────────────────────────────────────────────────
-- 7. RLS — business_plans
--    PM 본인 created_by 만. (ud-ops mirror 시 created_by 는 ud-ops PM 의
--    supabase user.id 로 들어옴, src/lib/supabase-sync.ts 참조.)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "business_plans_select" ON public.business_plans;
CREATE POLICY "business_plans_select"
  ON public.business_plans FOR SELECT
  USING (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  );

-- INSERT/UPDATE/DELETE 는 phase5b 그대로 (이미 admin OR pm AND created_by=me 패턴).

-- ─────────────────────────────────────────────────────────────
-- 8. RLS — business_plan_coaches
--    PM 본인 BP 의 멤버 / coach 본인이 후보로 올라간 row
--    NOTE: phase5b 의 실제 컬럼은 `coach_directory_id` (coaches_directory.id
--    참조) — auth.users.id 와 직접 비교 불가. coaches_directory.linked_user_id
--    를 거쳐 join 해야 함.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bp_coaches_select" ON public.business_plan_coaches;
CREATE POLICY "bp_coaches_select"
  ON public.business_plan_coaches FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.coaches_directory cd
       WHERE cd.id = business_plan_coaches.coach_directory_id
         AND cd.linked_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.business_plans bp
       WHERE bp.id = business_plan_coaches.business_plan_id
         AND public.is_pm()
         AND bp.created_by = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE 는 phase5b 그대로.

-- ─────────────────────────────────────────────────────────────
-- 9. RLS — coach_evaluations
--    PM 본인 BP 의 평가만 / coach 본인 평가는 의도적으로 안 보임 (phase5b 정책 유지)
--    단 admin_or_pm 호출은 admin OR pm AND bp.created_by 로 좁힘
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "coach_evaluations_select" ON public.coach_evaluations;
CREATE POLICY "coach_evaluations_select"
  ON public.coach_evaluations FOR SELECT
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.business_plans bp
       WHERE bp.id = coach_evaluations.business_plan_id
         AND public.is_pm()
         AND bp.created_by = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE 는 phase5b 그대로.

-- ─────────────────────────────────────────────────────────────
-- 10. RLS — coaches_directory_history
--     audit log 는 admin only — PM 권한 밖.
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cdh_admin_read" ON public.coaches_directory_history;
CREATE POLICY "cdh_admin_read"
  ON public.coaches_directory_history FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 11. 데이터 위생 — created_by NULL 인 옛 프로젝트 점검
--     (실제 데이터 수정은 안 함 — admin 이 수동 처리 권장. 진단만.)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  orphan_projects_count int;
  orphan_bps_count int;
BEGIN
  SELECT count(*) INTO orphan_projects_count
    FROM public.projects WHERE created_by IS NULL;
  SELECT count(*) INTO orphan_bps_count
    FROM public.business_plans WHERE created_by IS NULL;

  IF orphan_projects_count > 0 THEN
    RAISE NOTICE '[Phase D3] projects.created_by IS NULL: % rows. PM 에게 보이지 않을 수 있음. admin 수동 backfill 권장.', orphan_projects_count;
  END IF;
  IF orphan_bps_count > 0 THEN
    RAISE NOTICE '[Phase D3] business_plans.created_by IS NULL: % rows. PM 에게 보이지 않을 수 있음.', orphan_bps_count;
  END IF;
END $$;
