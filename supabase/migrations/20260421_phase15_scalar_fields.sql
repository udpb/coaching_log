-- Phase 1.5: make several coaching-log fields queryable/chartable by splitting
-- them into scalar columns rather than natural-language blobs.

-- next_checkin: previously a free-text column ("목요일에 메시지로 점검").
-- Split into a concrete date and a channel enum so we can drive reminders.
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS next_checkin_date date;

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS next_checkin_channel text;
-- Expected values: 'message' | 'call' | 'video' | 'email' | 'inperson' | 'other'
-- (Keeping as text for flexibility; UI will constrain input.)

-- last_done_rate: 0.0 – 1.0 fraction derived from last_number ("11/15 인터뷰" → 0.73).
-- Model also emits numerator/denominator explicitly so we don't re-parse later.
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS last_done_numerator numeric;

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS last_done_denominator numeric;

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS last_done_rate numeric;
