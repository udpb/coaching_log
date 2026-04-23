-- Phase 4-A: role separation + row-level isolation.
-- Admin (udpb@udimpact.ai) sees every coach's sessions. All other users
-- default to 'coach' and only see / edit / delete their own rows.

-- ─────────────────────────────────────────────────────────────
-- 1. profiles table (mirror of auth.users + role column)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  role text NOT NULL DEFAULT 'coach' CHECK (role IN ('admin', 'coach')),
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 2. Auto-create a profile whenever a new auth user signs up.
--    udpb@udimpact.ai is seeded as the first admin.
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
    CASE WHEN NEW.email = 'udpb@udimpact.ai' THEN 'admin' ELSE 'coach' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 3. Backfill: create profile rows for already-existing auth users
--    (the trigger above only fires for new signups).
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, display_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1)),
  CASE WHEN u.email = 'udpb@udimpact.ai' THEN 'admin' ELSE 'coach' END
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Defensive: make sure udpb@udimpact.ai is admin even if the row already
-- existed with role='coach' (e.g. created before this migration).
UPDATE public.profiles
   SET role = 'admin'
 WHERE email = 'udpb@udimpact.ai'
   AND role <> 'admin';

-- ─────────────────────────────────────────────────────────────
-- 4. is_admin() helper — SECURITY DEFINER so it can read profiles
--    without tripping RLS (otherwise policies that call it would
--    infinitely recurse into their own table).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS on profiles itself
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_admin_only" ON public.profiles;
CREATE POLICY "profiles_update_admin_only"
  ON public.profiles FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Allow users to insert their own row (handled by trigger normally, but
-- this keeps the edge case of manual insertions workable).
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
CREATE POLICY "profiles_insert_self"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- 6. coaching_logs — replace the open policy with admin-view-all +
--    coach-owns-own. Admin is read-only by design (no edit/delete).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coaching_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access" ON public.coaching_logs;

DROP POLICY IF EXISTS "coaching_logs_select" ON public.coaching_logs;
CREATE POLICY "coaching_logs_select"
  ON public.coaching_logs FOR SELECT
  USING (coach_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "coaching_logs_insert" ON public.coaching_logs;
CREATE POLICY "coaching_logs_insert"
  ON public.coaching_logs FOR INSERT
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS "coaching_logs_update" ON public.coaching_logs;
CREATE POLICY "coaching_logs_update"
  ON public.coaching_logs FOR UPDATE
  USING (coach_id = auth.uid())
  WITH CHECK (coach_id = auth.uid());

DROP POLICY IF EXISTS "coaching_logs_delete" ON public.coaching_logs;
CREATE POLICY "coaching_logs_delete"
  ON public.coaching_logs FOR DELETE
  USING (coach_id = auth.uid());
