-- Phase 5-A: introduce 'pm' role between admin and coach.
-- Why: UDImpact/Underdogs internal staff need read-all visibility (coaching_logs,
-- projects, coach directory) without admin powers (no profile mutation, no
-- coach-directory edits, no managing other PMs/admins). Admin stays the
-- super-user; coaches keep their own data scope.
--
-- Mapping:
--   udpb@udimpact.ai, udpb@underdogs.co.kr           → admin (existing)
--   *@udimpact.ai or *@underdogs.co.kr (others)      → pm    (NEW)
--   everyone else                                    → coach (default)
--
-- This migration is idempotent: drops & recreates constraints/policies/functions.

-- ─────────────────────────────────────────────────────────────
-- 1. profiles.role check constraint → admin | pm | coach
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'pm', 'coach'));

-- ─────────────────────────────────────────────────────────────
-- 2. handle_new_user() — auto-assignment trigger function
--    admin emails → admin
--    @udimpact.ai or @underdogs.co.kr → pm
--    else → coach
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    CASE
      WHEN NEW.email IN ('udpb@udimpact.ai', 'udpb@underdogs.co.kr') THEN 'admin'
      WHEN NEW.email ILIKE '%@udimpact.ai' OR NEW.email ILIKE '%@underdogs.co.kr' THEN 'pm'
      ELSE 'coach'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Trigger itself was created in 20260421_phase4a_roles_rls.sql; no change needed.

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill: promote internal staff currently sitting at role='coach'
-- ─────────────────────────────────────────────────────────────
UPDATE public.profiles
   SET role = 'pm'
 WHERE role = 'coach'
   AND email IS NOT NULL
   AND (email ILIKE '%@udimpact.ai' OR email ILIKE '%@underdogs.co.kr')
   AND email NOT IN ('udpb@udimpact.ai', 'udpb@underdogs.co.kr');

-- Defensive: make sure the secondary admin email is admin too
UPDATE public.profiles
   SET role = 'admin'
 WHERE email IN ('udpb@udimpact.ai', 'udpb@underdogs.co.kr')
   AND role <> 'admin';

-- ─────────────────────────────────────────────────────────────
-- 4. Helper functions: is_pm(), is_admin_or_pm()
--    SECURITY DEFINER pattern matches is_admin() so policies that call
--    them won't recurse into profiles RLS.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_pm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'pm'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_pm() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin_or_pm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role IN ('admin', 'pm')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_or_pm() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS rewrites — 3-tier reflection
-- ─────────────────────────────────────────────────────────────

-- 5.1 profiles
--   SELECT: own row, or admin/pm sees all
--   UPDATE: admin only (PMs cannot mutate other roles)
--   INSERT: self only (handled normally by trigger)
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin_or_pm());

-- profiles_update_admin_only and profiles_insert_self stay as defined in 4a;
-- they don't need to widen for PM.

-- 5.2 coaching_logs
--   SELECT: own + admin + pm + project member
--   INSERT/UPDATE/DELETE: own (admin/pm cannot edit other people's logs)
DROP POLICY IF EXISTS "coaching_logs_select" ON public.coaching_logs;
CREATE POLICY "coaching_logs_select"
  ON public.coaching_logs FOR SELECT
  USING (
    coach_id = auth.uid()
    OR public.is_admin_or_pm()
    OR (project_id IS NOT NULL AND public.is_project_member(project_id))
  );

-- INSERT/UPDATE/DELETE policies from phase4a still hold (own rows only).

-- 5.3 projects
--   SELECT: admin + pm + project member
--   INSERT: admin + pm
--   UPDATE/DELETE: admin all, pm only own (created_by)
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select"
  ON public.projects FOR SELECT
  USING (public.is_admin_or_pm() OR public.is_project_member(id));

DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
CREATE POLICY "projects_admin_insert"
  ON public.projects FOR INSERT
  WITH CHECK (public.is_admin_or_pm());

DROP POLICY IF EXISTS "projects_admin_update" ON public.projects;
CREATE POLICY "projects_admin_update"
  ON public.projects FOR UPDATE
  USING (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "projects_admin_delete" ON public.projects;
CREATE POLICY "projects_admin_delete"
  ON public.projects FOR DELETE
  USING (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  );

-- 5.4 project_members
--   SELECT: admin + pm + own membership
--   INSERT/UPDATE/DELETE: admin all; pm only on projects they created
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;
CREATE POLICY "project_members_select"
  ON public.project_members FOR SELECT
  USING (
    public.is_admin_or_pm()
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "project_members_admin_insert" ON public.project_members;
CREATE POLICY "project_members_admin_insert"
  ON public.project_members FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_members.project_id
           AND p.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "project_members_admin_update" ON public.project_members;
CREATE POLICY "project_members_admin_update"
  ON public.project_members FOR UPDATE
  USING (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_members.project_id
           AND p.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_members.project_id
           AND p.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "project_members_admin_delete" ON public.project_members;
CREATE POLICY "project_members_admin_delete"
  ON public.project_members FOR DELETE
  USING (
    public.is_admin()
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.projects p
         WHERE p.id = project_members.project_id
           AND p.created_by = auth.uid()
      )
    )
  );

-- 5.5 coaches_directory
--   SELECT: any authenticated (already open) — leave as-is
--   INSERT: admin only
--   UPDATE: admin OR own linked row (PM cannot edit)
--   DELETE: admin only
-- The cd_read_authenticated / cd_admin_insert / cd_admin_or_self_update /
-- cd_admin_delete policies from 20260423_phase4d_coaches_directory.sql already
-- match this matrix. No change needed for Phase A.

-- 5.6 coaches_directory_history
--   SELECT: admin + pm (PMs need audit visibility for ops review)
DROP POLICY IF EXISTS "cdh_admin_read" ON public.coaches_directory_history;
CREATE POLICY "cdh_admin_read"
  ON public.coaches_directory_history FOR SELECT
  TO authenticated
  USING (public.is_admin_or_pm());
