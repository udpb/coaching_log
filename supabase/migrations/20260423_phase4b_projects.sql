-- Phase 4-B: introduce projects + project_members so coaches can be assigned
-- to specific engagements. coaching_logs gets an optional project_id FK.
-- RLS: admin keeps read-all; coach sees own rows OR rows in projects they're
-- a member of. project_id is nullable so pre-existing logs stay visible to
-- their owning coach without any backfill.

-- ─────────────────────────────────────────────────────────────
-- 1. projects table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  start_date  date,
  end_date    date,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);

-- ─────────────────────────────────────────────────────────────
-- 2. project_members — who's assigned to what
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'coach' CHECK (role IN ('lead_coach','coach','observer')),
  added_at   timestamptz DEFAULT now(),
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);

-- ─────────────────────────────────────────────────────────────
-- 3. coaching_logs — add project_id FK (nullable → 기존 데이터 보호)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coaching_logs_project ON public.coaching_logs(project_id);

-- ─────────────────────────────────────────────────────────────
-- 4. Helper: is current user a member of project X?
--    SECURITY DEFINER avoids RLS recursion on project_members.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_project_member(pid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
     WHERE project_id = pid AND user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_project_member(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS on projects — admin all, coach only own projects
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select"
  ON public.projects FOR SELECT
  USING (public.is_admin() OR public.is_project_member(id));

DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
CREATE POLICY "projects_admin_insert"
  ON public.projects FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "projects_admin_update" ON public.projects;
CREATE POLICY "projects_admin_update"
  ON public.projects FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "projects_admin_delete" ON public.projects;
CREATE POLICY "projects_admin_delete"
  ON public.projects FOR DELETE
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 6. RLS on project_members
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select"
  ON public.project_members FOR SELECT
  USING (public.is_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "project_members_admin_insert" ON public.project_members;
CREATE POLICY "project_members_admin_insert"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "project_members_admin_delete" ON public.project_members;
CREATE POLICY "project_members_admin_delete"
  ON public.project_members FOR DELETE
  USING (public.is_admin());

DROP POLICY IF EXISTS "project_members_admin_update" ON public.project_members;
CREATE POLICY "project_members_admin_update"
  ON public.project_members FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 7. coaching_logs RLS — extend SELECT to include project members.
--    Existing policies are dropped and rewritten (the old ones from
--    20260421_phase4a_roles_rls.sql stay exactly the same except SELECT).
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "coaching_logs_select" ON public.coaching_logs;
CREATE POLICY "coaching_logs_select"
  ON public.coaching_logs FOR SELECT
  USING (
    coach_id = auth.uid()                               -- own rows
    OR public.is_admin()                                -- admin sees all
    OR (project_id IS NOT NULL AND public.is_project_member(project_id))
  );

-- INSERT stays: you can only create rows as yourself.
-- UPDATE/DELETE stay: coach owns own rows only (admin is read-only).
-- (These policies are defined in 20260421_phase4a_roles_rls.sql; no change.)

-- ─────────────────────────────────────────────────────────────
-- 8. Keep projects.updated_at fresh
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.projects_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS projects_touch_updated_at ON public.projects;
CREATE TRIGGER projects_touch_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_touch_updated_at();
