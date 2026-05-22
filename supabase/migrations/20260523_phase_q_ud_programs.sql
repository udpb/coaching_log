-- ─────────────────────────────────────────────────────────────────────
-- Phase Q (2026-05-23): coaches_directory 에 UD 프로그램 라벨 컬럼
--
-- 배경:
--   UCA (Underdogs Coach Academy) 기수별 출신 코치 식별 필요.
--   향후 다른 UD 프로그램 확장도 같은 컬럼에 추가 가능.
--
-- 추가 컬럼:
--   ud_programs text[]  참여한 UD 프로그램. 예: {UCA#4, UCA#3}
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.coaches_directory
  ADD COLUMN IF NOT EXISTS ud_programs text[];

CREATE INDEX IF NOT EXISTS coaches_ud_programs_gin
  ON public.coaches_directory USING GIN (ud_programs);

COMMENT ON COLUMN public.coaches_directory.ud_programs IS
  '참여한 UD 프로그램. 예: {UCA#4, UCA#3}. 향후 다른 프로그램 확장 가능.';

-- 검증:
--   UCA#4 출신 코치 조회:
--     SELECT name, country FROM coaches_directory WHERE 'UCA#4' = ANY(ud_programs);
