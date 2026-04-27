-- Phase 4-D: coach directory (master pool)
-- Designed to (a) serve as single source of truth for 800+ coaches,
-- (b) support ongoing updates with audit trail, and
-- (c) be ready for future PM-facing RAG recommendation (embeddings).

-- ─────────────────────────────────────────────────────────────
-- 1. coaches_directory — master table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coaches_directory (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Upstream id from coach-finder JSON (used as upsert anchor on sync)
  external_id          text UNIQUE,

  -- Identity
  name                 text NOT NULL,
  email                text,
  phone                text,
  gender               text,

  -- Location
  location             text,
  country              text,
  regions              text[] NOT NULL DEFAULT '{}',

  -- Organization
  organization         text,
  position             text,

  -- Specialization (multi-select arrays — GIN indexed below)
  industries           text[] NOT NULL DEFAULT '{}',
  expertise            text[] NOT NULL DEFAULT '{}',
  roles                text[] NOT NULL DEFAULT '{}',
  language             text,
  -- Free-form ops labels (e.g. '#여성창업가전문', '#로컬브랜드전문')
  tags                 text[] NOT NULL DEFAULT '{}',

  -- International work
  overseas             boolean DEFAULT false,
  overseas_detail      text,

  -- Profile body (source of truth for future embedding)
  intro                text,
  career_history       text,
  education            text,
  underdogs_history    text,
  current_work         text,
  tools_skills         text,
  career_years         numeric,
  career_years_raw     text,

  -- Media
  photo_url            text,     -- external CDN URL or supabase storage public URL
  photo_filename       text,     -- original filename (for admin display)

  -- PM-facing segmentation
  tier                 text,     -- 'S' | 'A' | 'B' | 'C' | ...
  category             text,
  business_type        text,

  -- Availability (drives future RAG recommendation filter)
  availability_status  text NOT NULL DEFAULT 'available'
                       CHECK (availability_status IN ('available','limited','unavailable')),
  max_concurrent_projects integer,

  -- Link to actual login account (nullable — most directory rows never log in)
  linked_user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Lifecycle
  status               text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','inactive','archived','draft')),
  notes                text,     -- internal ops memo

  -- Timestamps
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  last_synced_at       timestamptz
  --
  -- FUTURE (Phase 4-E): add a pgvector embedding column for semantic search.
  --   CREATE EXTENSION IF NOT EXISTS vector;
  --   embedding vector(1536), embedding_updated_at timestamptz
  -- Then populate via scheduled function: embed(intro || career_history || ...)
  -- and query with `order by embedding <=> query_embedding limit N`.
);

-- Indexes for PM search / ops filtering
CREATE UNIQUE INDEX IF NOT EXISTS coaches_email_lower
  ON public.coaches_directory (lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS coaches_external_id     ON public.coaches_directory (external_id);
CREATE INDEX IF NOT EXISTS coaches_status          ON public.coaches_directory (status);
CREATE INDEX IF NOT EXISTS coaches_availability    ON public.coaches_directory (availability_status);
CREATE INDEX IF NOT EXISTS coaches_tier            ON public.coaches_directory (tier);
CREATE INDEX IF NOT EXISTS coaches_linked          ON public.coaches_directory (linked_user_id);

CREATE INDEX IF NOT EXISTS coaches_expertise_gin   ON public.coaches_directory USING GIN (expertise);
CREATE INDEX IF NOT EXISTS coaches_regions_gin     ON public.coaches_directory USING GIN (regions);
CREATE INDEX IF NOT EXISTS coaches_industries_gin  ON public.coaches_directory USING GIN (industries);
CREATE INDEX IF NOT EXISTS coaches_roles_gin       ON public.coaches_directory USING GIN (roles);
CREATE INDEX IF NOT EXISTS coaches_tags_gin        ON public.coaches_directory USING GIN (tags);

-- Trigram for Korean substring search on name / organization
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS coaches_name_trgm ON public.coaches_directory USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS coaches_org_trgm  ON public.coaches_directory USING GIN (organization gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- 2. updated_at trigger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.coaches_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS coaches_touch ON public.coaches_directory;
CREATE TRIGGER coaches_touch
  BEFORE UPDATE ON public.coaches_directory
  FOR EACH ROW EXECUTE FUNCTION public.coaches_touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Audit log table + trigger (who changed what, when)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coaches_directory_history (
  id          bigserial PRIMARY KEY,
  coach_id    uuid NOT NULL,
  op          text NOT NULL,           -- 'UPDATE' | 'DELETE'
  changed_by  uuid,
  changed_at  timestamptz DEFAULT now(),
  snapshot    jsonb NOT NULL           -- full OLD row just before change
);

CREATE INDEX IF NOT EXISTS coaches_history_coach ON public.coaches_directory_history (coach_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.coaches_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.coaches_directory_history (coach_id, op, changed_by, snapshot)
  VALUES (OLD.id, TG_OP, auth.uid(), to_jsonb(OLD));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;

DROP TRIGGER IF EXISTS coaches_audit_tr ON public.coaches_directory;
CREATE TRIGGER coaches_audit_tr
  BEFORE UPDATE OR DELETE ON public.coaches_directory
  FOR EACH ROW EXECUTE FUNCTION public.coaches_audit();

-- ─────────────────────────────────────────────────────────────
-- 4. RLS on coaches_directory
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coaches_directory ENABLE ROW LEVEL SECURITY;

-- Anyone logged in can read — drives coach search UX for PMs / project-member
-- assignment. If this is too open later, tighten to specific roles.
DROP POLICY IF EXISTS "cd_read_authenticated" ON public.coaches_directory;
CREATE POLICY "cd_read_authenticated" ON public.coaches_directory
  FOR SELECT TO authenticated USING (true);

-- Insert: admin only
DROP POLICY IF EXISTS "cd_admin_insert" ON public.coaches_directory;
CREATE POLICY "cd_admin_insert" ON public.coaches_directory
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- Update: admin OR the linked coach editing their own row
DROP POLICY IF EXISTS "cd_admin_or_self_update" ON public.coaches_directory;
CREATE POLICY "cd_admin_or_self_update" ON public.coaches_directory
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR linked_user_id = auth.uid())
  WITH CHECK (public.is_admin() OR linked_user_id = auth.uid());

-- Delete: admin only
DROP POLICY IF EXISTS "cd_admin_delete" ON public.coaches_directory;
CREATE POLICY "cd_admin_delete" ON public.coaches_directory
  FOR DELETE TO authenticated USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5. RLS on history — admin read-only, no write (trigger owns INSERT)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coaches_directory_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cdh_admin_read" ON public.coaches_directory_history;
CREATE POLICY "cdh_admin_read" ON public.coaches_directory_history
  FOR SELECT TO authenticated USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 6. Supabase Storage bucket for coach photos
--    (public read so browsers can render <img src=…> without auth)
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('coach-photos', 'coach-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "coach_photos_read" ON storage.objects;
CREATE POLICY "coach_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'coach-photos');

DROP POLICY IF EXISTS "coach_photos_admin_insert" ON storage.objects;
CREATE POLICY "coach_photos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'coach-photos' AND public.is_admin());

DROP POLICY IF EXISTS "coach_photos_admin_update" ON storage.objects;
CREATE POLICY "coach_photos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'coach-photos' AND public.is_admin())
  WITH CHECK (bucket_id = 'coach-photos' AND public.is_admin());

DROP POLICY IF EXISTS "coach_photos_admin_delete" ON storage.objects;
CREATE POLICY "coach_photos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'coach-photos' AND public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 7. Optional: auto-link coach_directory to profiles when emails match.
--    Useful if a coach signs up with the same email as their directory row.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autolink_coach_on_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  UPDATE public.coaches_directory
     SET linked_user_id = NEW.id
   WHERE linked_user_id IS NULL
     AND lower(email) = lower(NEW.email);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS autolink_coach_on_profile_tr ON public.profiles;
CREATE TRIGGER autolink_coach_on_profile_tr
  AFTER INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.autolink_coach_on_profile();
