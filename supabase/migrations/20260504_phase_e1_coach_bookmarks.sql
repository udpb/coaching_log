-- Phase E1 — Coach bookmarks (PM별 영구 숏리스트)
-- 2026-05-04
--
-- 의도: PM 이 "이 코치 다음에 다시 봐야지" 라고 표시하고 나중에 빠르게 복귀.
--   Catalant·Upwork·Toptal 모두 가진 표준 패턴. 8명 선택은 일회성이라 영구
--   숏리스트가 별도 필요.
--
-- 격리: user_id = auth.uid() 엄격. 다른 PM 의 북마크는 절대 안 보임.
-- 데이터 범위: 사용자별 (RLS 로 server side 강제).
--
-- 멱등성: CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS 패턴.

CREATE TABLE IF NOT EXISTS public.coach_bookmarks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coach_directory_id  uuid NOT NULL REFERENCES public.coaches_directory(id) ON DELETE CASCADE,
  note                text,             -- 짧은 메모 ("PMF 분야 강함" 등). 선택.
  tags                text[] DEFAULT '{}', -- PM 본인용 자유 태그. (선택)
  created_at          timestamptz DEFAULT now(),
  UNIQUE (user_id, coach_directory_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_bookmarks_user
  ON public.coach_bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_bookmarks_coach
  ON public.coach_bookmarks (coach_directory_id);

-- ─────────────────────────────────────────────────────────────
-- RLS — user_id = auth.uid() 엄격. admin 도 다른 사용자 북마크는 안 봄
-- (개인 노트라 개인정보 성격).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.coach_bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookmarks_select_own" ON public.coach_bookmarks;
CREATE POLICY "bookmarks_select_own"
  ON public.coach_bookmarks FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "bookmarks_insert_own" ON public.coach_bookmarks;
CREATE POLICY "bookmarks_insert_own"
  ON public.coach_bookmarks FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "bookmarks_update_own" ON public.coach_bookmarks;
CREATE POLICY "bookmarks_update_own"
  ON public.coach_bookmarks FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "bookmarks_delete_own" ON public.coach_bookmarks;
CREATE POLICY "bookmarks_delete_own"
  ON public.coach_bookmarks FOR DELETE
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_bookmarks TO authenticated;
