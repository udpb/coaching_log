-- Phase F supplement: add legacy_firestore_id to business_plans so the
-- one-time Firestore→Supabase migration script (tools/firestore-to-supabase.mjs
-- in coach-finder) can be safely re-run without creating duplicate BPs.
--
-- The column is text (Firestore docs use numeric millis-since-epoch IDs as
-- strings) and UNIQUE. NULLs are allowed because BPs created in
-- coaching-log won't have a Firestore counterpart.
--
-- Idempotent.

ALTER TABLE public.business_plans
  ADD COLUMN IF NOT EXISTS legacy_firestore_id text;

-- Use a partial unique index so multiple NULLs are still fine.
CREATE UNIQUE INDEX IF NOT EXISTS business_plans_legacy_firestore_id_uniq
  ON public.business_plans(legacy_firestore_id)
  WHERE legacy_firestore_id IS NOT NULL;

COMMENT ON COLUMN public.business_plans.legacy_firestore_id IS
  'For one-time Firestore→Supabase migration. Stores the original Firestore project doc id. NULL for native coaching-log/coach-finder BPs.';
