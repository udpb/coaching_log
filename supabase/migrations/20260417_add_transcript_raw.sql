-- Add columns to store the original STT transcript and flag AI-extracted drafts
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS transcript_raw text;

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS ai_extracted boolean DEFAULT false;
