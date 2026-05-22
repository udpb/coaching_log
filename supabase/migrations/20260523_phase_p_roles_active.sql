-- ─────────────────────────────────────────────────────────────────────
-- Phase P (2026-05-23): coaches_directory 에 역할 분리 컬럼 추가
--
-- 배경:
--   기존 roles text[] 는 코치가 수행 가능한 역할만 저장 (코칭/강의/운영).
--   2026 활동 희망 여부 별도 — Google Form 응답에 3가지 옵션:
--     1) 경험/역량 보유 + 올해 적극 참여 의사 → capable + active
--     2) 경험/역량 보유 (의향 없음)             → capable only
--     3) 올해 적극 참여 의사 (경험 미보유)       → active only
--
-- 추가 컬럼:
--   roles_capable      text[]  경험·역량 보유한 역할 ['코칭','강의','운영']
--   roles_active_2026  text[]  2026년 적극 활동 의향 역할
--
-- 사용 예 (coach-finder UI sorting):
--   "올해 코칭 활동 의향" 필터 → WHERE '코칭' = ANY(roles_active_2026)
--   "강의 가능 코치" → WHERE '강의' = ANY(roles_capable)
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.coaches_directory
  ADD COLUMN IF NOT EXISTS roles_capable     text[],
  ADD COLUMN IF NOT EXISTS roles_active_2026 text[];

CREATE INDEX IF NOT EXISTS coaches_roles_capable_gin
  ON public.coaches_directory USING GIN (roles_capable);
CREATE INDEX IF NOT EXISTS coaches_roles_active_gin
  ON public.coaches_directory USING GIN (roles_active_2026);

COMMENT ON COLUMN public.coaches_directory.roles_capable IS
  '경험·역량 보유한 역할. 예: {코칭,강의,운영}.';
COMMENT ON COLUMN public.coaches_directory.roles_active_2026 IS
  '2026년 적극 활동 의향 역할. 매년 응답 후 갱신.';
