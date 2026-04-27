-- Phase 4-E: pgvector-based semantic search for the coaches directory.
-- Used to power future PM-facing recommendation ("business description → top coaches").

-- ─────────────────────────────────────────────────────────────
-- 1. Enable the pgvector extension
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────
-- 2. Embedding columns on coaches_directory
--    Dimension 1536 matches OpenAI `text-embedding-3-small`, which gives
--    strong Korean performance at ~$0.00002 / 1K tokens.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coaches_directory
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  -- Hash of the source text that was embedded. Lets the generator script
  -- skip rows whose profile hasn't changed.
  ADD COLUMN IF NOT EXISTS embedding_source_hash text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS embedding_model text;

-- ─────────────────────────────────────────────────────────────
-- 3. HNSW index on the embedding (cosine distance)
--    For 800 rows this is overkill speed-wise, but gives us headroom as
--    the directory grows. HNSW is more accurate than ivfflat at comparable
--    recall settings.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS coaches_embedding_hnsw
  ON public.coaches_directory
  USING hnsw (embedding vector_cosine_ops);

-- ─────────────────────────────────────────────────────────────
-- 4. Search RPC
--    Pass a query embedding + optional filters. Returns N best matches
--    ordered by cosine similarity (1 - distance).
--
--    SECURITY DEFINER runs as the function owner (bypasses RLS), so any
--    authenticated user can search without needing SELECT on the table.
--    The RPC only surfaces a fixed projection — we don't leak internal
--    notes or ops fields.
-- ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.search_coaches_by_embedding(vector, int, text, text, text[], text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.search_coaches_by_embedding(
  query_embedding   vector(1536),
  match_count       int     DEFAULT 10,
  only_status       text    DEFAULT 'active',
  only_availability text    DEFAULT 'available',   -- pass NULL to skip
  filter_tier       text[]  DEFAULT NULL,
  filter_expertise  text[]  DEFAULT NULL,
  filter_regions    text[]  DEFAULT NULL,
  filter_industries text[]  DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  external_id         text,
  name                text,
  email               text,
  organization        text,
  "position"          text,           -- quoted: 'position' is reserved in RETURNS TABLE column names
  tier                text,
  expertise           text[],
  regions             text[],
  industries          text[],
  roles               text[],
  photo_url           text,
  intro               text,
  career_years        numeric,
  availability_status text,
  similarity          float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.external_id, c.name, c.email, c.organization,
    c."position",
    c.tier, c.expertise, c.regions, c.industries, c.roles,
    c.photo_url, c.intro, c.career_years, c.availability_status,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.coaches_directory c
  WHERE c.embedding IS NOT NULL
    AND (only_status IS NULL OR c.status = only_status)
    AND (only_availability IS NULL OR c.availability_status = only_availability)
    AND (filter_tier IS NULL OR c.tier = ANY(filter_tier))
    AND (filter_expertise IS NULL OR c.expertise && filter_expertise)
    AND (filter_regions IS NULL OR c.regions && filter_regions)
    AND (filter_industries IS NULL OR c.industries && filter_industries)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_coaches_by_embedding TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Helper: invalidate embedding when the source profile text changes.
--    Any UPDATE that modifies a field used to build the embedding zeroes
--    out the hash, prompting the batch script to re-embed next run.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.coaches_invalidate_embedding_if_profile_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.name IS DISTINCT FROM OLD.name
      OR NEW.organization IS DISTINCT FROM OLD.organization
      OR NEW."position" IS DISTINCT FROM OLD."position"
      OR NEW.intro IS DISTINCT FROM OLD.intro
      OR NEW.career_history IS DISTINCT FROM OLD.career_history
      OR NEW.current_work IS DISTINCT FROM OLD.current_work
      OR NEW.underdogs_history IS DISTINCT FROM OLD.underdogs_history
      OR NEW.tools_skills IS DISTINCT FROM OLD.tools_skills
      OR NEW.industries IS DISTINCT FROM OLD.industries
      OR NEW.expertise IS DISTINCT FROM OLD.expertise
      OR NEW.roles IS DISTINCT FROM OLD.roles
      OR NEW.regions IS DISTINCT FROM OLD.regions
      OR NEW.tags IS DISTINCT FROM OLD.tags) THEN
    NEW.embedding_source_hash := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS coaches_invalidate_embedding ON public.coaches_directory;
CREATE TRIGGER coaches_invalidate_embedding
  BEFORE UPDATE ON public.coaches_directory
  FOR EACH ROW
  -- Skip if the update itself is writing the embedding (avoid infinite invalidation)
  WHEN (NEW.embedding IS NOT DISTINCT FROM OLD.embedding)
  EXECUTE FUNCTION public.coaches_invalidate_embedding_if_profile_changed();
