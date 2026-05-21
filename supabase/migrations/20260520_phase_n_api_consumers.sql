-- ─────────────────────────────────────────────────────────────────────
-- Phase N (2026-05-20): 외부/내부 시스템 통합용 API 키 관리
--
-- 배경:
--   사내 LMS·파트너 시스템 등이 코치 정보를 fetch 해서 자기 화면에 노출.
--   admin 이 키별로 허용 필드·엔드포인트·rate limit 설정 가능해야 함.
--
-- 테이블:
--   api_consumers
--     name              text  — 사용처 ("사내 LMS", "파트너 채널")
--     key_hash          text  — sha256 해시 (생성 시점에만 평문 노출)
--     key_prefix        text  — 첫 12자 (lms_ABC123…) 식별용 표시
--     allowed_fields    text[] — Coach 응답에서 허용할 필드 화이트리스트
--     allowed_endpoints text[] — coaches, project_coaches 중 허용 목록
--     rate_limit_per_day int  — 일일 호출 한도 (기본 1000)
--     is_active         bool  — 즉시 차단 가능
--     notes             text  — admin 메모
--   api_consumer_usage (간단 로그)
--     consumer_id, endpoint, status_code, request_at
--
-- 보안:
--   RLS: admin 만 SELECT/INSERT/UPDATE/DELETE.
--   서버는 SUPABASE_SERVICE_ROLE 로 직접 조회 (RLS 우회) — 검증은 서버 미들웨어 책임.
--   key_hash 만 저장 → DB 유출돼도 평문 키 복원 불가.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.api_consumers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  key_hash           text NOT NULL UNIQUE,
  key_prefix         text NOT NULL,
  allowed_fields     text[] NOT NULL DEFAULT '{}',
  allowed_endpoints  text[] NOT NULL DEFAULT ARRAY['coaches'],
  rate_limit_per_day int NOT NULL DEFAULT 1000,
  is_active          boolean NOT NULL DEFAULT true,
  notes              text,
  created_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

CREATE INDEX IF NOT EXISTS api_consumers_active_idx
  ON public.api_consumers(is_active) WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.api_consumer_usage (
  id          bigserial PRIMARY KEY,
  consumer_id uuid REFERENCES public.api_consumers(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  status_code int,
  request_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_consumer_usage_consumer_idx
  ON public.api_consumer_usage(consumer_id, request_at DESC);

-- 90일 이상 된 로그는 자동 청소 (필요시 cron 으로 재실행)
COMMENT ON TABLE public.api_consumer_usage IS
  '간단 호출 로그. 운영 부담 회피 위해 90일 이전 항목은 주기적으로 정리 권장.';

-- ── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE public.api_consumers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_consumer_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_consumers_admin_all ON public.api_consumers;
CREATE POLICY api_consumers_admin_all ON public.api_consumers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS api_consumer_usage_admin_read ON public.api_consumer_usage;
CREATE POLICY api_consumer_usage_admin_read ON public.api_consumer_usage
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ── 코멘트 ────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.api_consumers.key_hash IS
  'sha256(api_key). 평문은 생성 시점 1회만 노출, 이후 복원 불가.';
COMMENT ON COLUMN public.api_consumers.allowed_fields IS
  '응답에 포함될 필드 화이트리스트. 예: {name, organization, intro, photo_url, expertise}.';
COMMENT ON COLUMN public.api_consumers.allowed_endpoints IS
  '호출 가능한 엔드포인트. 현재 지원: coaches, project_coaches.';
