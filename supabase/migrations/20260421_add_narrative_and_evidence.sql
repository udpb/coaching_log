-- Phase 1 of the STT-to-log overhaul: let the AI write a rich narrative summary
-- of the session (instead of cramming everything into 18 one-line fields), and
-- attach per-field transcript-grounded evidence quotes so the coach can audit
-- why each value was chosen.

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS narrative_summary text;

-- extraction_evidence shape (per record, AI-drafted sessions only):
--   {
--     "stage":        { "quote": "...", "confidence": 0.0-1.0 },
--     "real_issue":   { "quote": "...", "confidence": 0.0-1.0 },
--     ...one entry per structured field the model answered
--   }
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS extraction_evidence jsonb DEFAULT '{}'::jsonb;
