-- ─────────────────────────────────────────────────────────────────────
-- Phase S (2026-06-01): ai_usage — 인증 사용자별 AI 호출 일일 캡 영속 카운터
--
-- 목적:
--   coach-finder 의 Gemini 엔드포인트(recommend·recommend_stream·parse_pdf)를
--   인증 사용자가 무제한 호출할 수 있는 P0 취약점(AUDIT-2026-06-01 · P0-C Part2)을
--   막기 위한 영속 카운터. 한 번의 호출당 1행을 기록하고, coach-finder 서버가
--   "오늘(UTC) user_id 의 행 수"를 세어 per-user 일일 캡을 강제한다.
--
-- 출처: coach-finder ADR-007 (per-user AI rate cap).
--
-- 접근 모델:
--   · INSERT/COUNT 는 coach-finder 서버의 SUPABASE_SERVICE_ROLE 이 수행 → RLS 우회.
--   · 사용자/anon 의 직접 접근은 없음 (write 정책 미부여 = 차단).
--   · admin 만 감사 목적 SELECT 허용 (기존 public.is_admin() 헬퍼 재사용,
--     정의: 20260421_phase4a_roles_rls.sql).
--
-- 범위/철학:
--   · 안전한 신규 테이블 추가만. 기존 테이블/정책/함수 무변경.
--   · idempotent — IF NOT EXISTS · DROP POLICY IF EXISTS 라서 재실행 안전.
--   · endpoint 에 CHECK 제약을 의도적으로 두지 않음 — 라벨 추가(예: 'recommend',
--     'recommend_stream', 'parse_pdf' 외 신규) 유연성 확보. 값은 서버가 통제.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid        NOT NULL,
  endpoint   text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- per-user 일일 카운트 쿼리(user_id = ? AND created_at >= 오늘 00:00)를 커버.
CREATE INDEX IF NOT EXISTS ai_usage_user_time_idx
  ON public.ai_usage (user_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- 카운트/INSERT 는 coach-finder 서버의 service-role 이 RLS 우회. 사용자/anon 직접 접근 없음.
-- write 정책을 부여하지 않으므로 authenticated/anon 의 INSERT/UPDATE/DELETE 는 차단됨.
DROP POLICY IF EXISTS ai_usage_admin_select ON public.ai_usage;
CREATE POLICY ai_usage_admin_select ON public.ai_usage
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ── 코멘트 ────────────────────────────────────────────────────────────
COMMENT ON TABLE public.ai_usage IS
  'AI 호출 1건당 1행. coach-finder ADR-007 per-user 일일 캡의 영속 카운터. INSERT/COUNT 는 service-role.';
COMMENT ON COLUMN public.ai_usage.endpoint IS
  '호출된 AI 엔드포인트 라벨. 예: recommend, recommend_stream, parse_pdf (CHECK 없음 — 서버가 통제).';

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- service-role 로 호출 1건 기록
--   INSERT INTO public.ai_usage (user_id, endpoint)
--   VALUES ('00000000-0000-0000-0000-000000000000', 'recommend');
--
--   -- 오늘(UTC) 해당 사용자 호출 수 = 일일 캡 비교 대상
--   SELECT count(*) FROM public.ai_usage
--    WHERE user_id = '00000000-0000-0000-0000-000000000000'
--      AND created_at >= date_trunc('day', now());
--
--   -- 정책 확인 (admin SELECT 1개)
--   SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.ai_usage'::regclass;
--   -- → ai_usage_admin_select
-- ─────────────────────────────────────────────────────────────────────
