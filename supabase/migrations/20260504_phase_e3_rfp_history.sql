-- Phase E3 — RFP 추천 히스토리 (PM별 영구)
-- 2026-05-04
--
-- 의도: PM 이 작성한 RFP + Gemini extraction 결과를 영구 저장 → 비슷한
--   사업 다시 진행 시 "최근 검색" 에서 재사용. 재추천은 그 RFP 텍스트로
--   /api/recommend 재호출 (코치 풀이 그 사이 갱신됐을 수 있어 stored
--   recommendations 는 안 보관 — 추천 결과는 휘발적, RFP 만 영구).
--
-- 격리: user_id = auth.uid() 엄격 (PM 본인 RFP만). admin 도 다른 사용자
--   RFP 못 봄 (개인 작업물 성격).
--
-- 데이터 범위: 🔴 사용자별 (RLS 강제).
--
-- 멱등성: CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.rfp_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rfp_text      text NOT NULL,
  extraction    jsonb,        -- Gemini 가 추출한 project_name/domains/skills/...
  filters       jsonb,        -- 호출 시점 filter state (재현용)
  result_count  integer,      -- 추천 받은 코치 수 (참고용)
  title         text,         -- extraction.project_name 또는 rfp_text 앞 80자
  business_plan_id uuid REFERENCES public.business_plans(id) ON DELETE SET NULL,
                              -- (선택) 이 RFP 가 특정 BP 용이었으면 연결.
  created_at    timestamptz DEFAULT now(),
  last_used_at  timestamptz DEFAULT now(),
  use_count     integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_rfp_history_user_created
  ON public.rfp_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rfp_history_bp
  ON public.rfp_history (business_plan_id) WHERE business_plan_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- RLS — user_id = auth.uid() 엄격
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.rfp_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rfp_history_select_own" ON public.rfp_history;
CREATE POLICY "rfp_history_select_own"
  ON public.rfp_history FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "rfp_history_insert_own" ON public.rfp_history;
CREATE POLICY "rfp_history_insert_own"
  ON public.rfp_history FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "rfp_history_update_own" ON public.rfp_history;
CREATE POLICY "rfp_history_update_own"
  ON public.rfp_history FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "rfp_history_delete_own" ON public.rfp_history;
CREATE POLICY "rfp_history_delete_own"
  ON public.rfp_history FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfp_history TO authenticated;
