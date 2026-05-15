-- ─────────────────────────────────────────────────────────────────────
-- Phase J (2026-05-15): 신규 코치 자가 등록 신청 테이블
--
-- 배경:
--   admin 이 일일이 한 명씩 등록하는 흐름이 다음 사고 자주 발생:
--     · 필수 필드 누락 (우영승: external_id NULL, tier NULL)
--     · email/phone 컬럼 밀림 (300+ 명 — JSON 백업 자체에 적용)
--   → 코치 본인이 직접 채워서 신청하는 흐름 필요.
--   admin 검토 후 coaches_directory 로 정식 등록 (sanity 보장).
--
-- 흐름:
--   1. 코치 후보가 https://coach-finder.vercel.app/register 접속
--   2. 폼 작성 (이름·이메일·전화 필수 + 부가정보 선택)
--   3. INSERT INTO coach_applications (status='pending')
--   4. admin 이 검토 화면에서 보고 승인/거절
--      · 승인 → coaches_directory 에 INSERT (tier·category 는 admin 입력)
--      · 거절 → status='rejected' + rejected_reason
--
-- 테이블: coach_applications
--   id              uuid pk
--   name            text NOT NULL
--   email           text NOT NULL
--   phone           text NOT NULL
--   organization    text
--   position        text
--   country         text DEFAULT '한국'
--   intro           text
--   expertise       text[]    -- 다중 (선택)
--   industries      text[]
--   regions         text[]
--   submitted_at    timestamptz DEFAULT now()
--   status          text CHECK IN ('pending','approved','rejected')
--   reviewed_by     uuid (admin user)
--   reviewed_at     timestamptz
--   rejected_reason text
--   linked_coach_id uuid (승인 시 coaches_directory.id)
--
-- RLS:
--   · INSERT — public (anon role 도 가능). 코치 후보가 로그인 없이 신청.
--   · SELECT — admin 만 (대시보드 검토용).
--   · UPDATE/DELETE — admin 만 (승인·거절·삭제).
--
-- 보안:
--   · email + phone 으로 중복 신청 방지 (UNIQUE 인덱스 — 단, status='rejected'
--     인 경우 재신청 허용 — 트리거 또는 부분 인덱스).
--   · rate limit: 같은 IP 가 짧은 시간 다수 신청은 클라이언트 처리.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coach_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 필수 필드 (NOT NULL)
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text NOT NULL CHECK (length(trim(phone)) > 0),
  -- 선택 필드
  organization text,
  position text,
  country text DEFAULT '한국',
  intro text,
  expertise text[] DEFAULT '{}',
  industries text[] DEFAULT '{}',
  regions text[] DEFAULT '{}',
  -- 메타
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejected_reason text,
  linked_coach_id uuid REFERENCES public.coaches_directory(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.coach_applications IS
  'Phase J (2026-05-15): 신규 코치 자가 등록 신청 임시 테이블. admin 승인 시 coaches_directory 로 이전.';

CREATE INDEX IF NOT EXISTS coach_applications_status_idx
  ON public.coach_applications(status, submitted_at DESC);

-- 중복 신청 방지 (pending 상태에서만 unique)
CREATE UNIQUE INDEX IF NOT EXISTS coach_applications_pending_email_phone_uq
  ON public.coach_applications(email, phone)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.coach_applications ENABLE ROW LEVEL SECURITY;

-- INSERT: anon 포함 누구나 (코치 후보가 로그인 없이 신청)
DROP POLICY IF EXISTS "coach_applications_insert_public" ON public.coach_applications;
CREATE POLICY "coach_applications_insert_public"
  ON public.coach_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    -- 안전 장치: pending 상태로만 INSERT 가능 (다른 status 로 직접 INSERT 금지)
    status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND linked_coach_id IS NULL
  );

-- SELECT: admin 만
DROP POLICY IF EXISTS "coach_applications_select_admin" ON public.coach_applications;
CREATE POLICY "coach_applications_select_admin"
  ON public.coach_applications FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- UPDATE: admin 만 (승인·거절 처리)
DROP POLICY IF EXISTS "coach_applications_update_admin" ON public.coach_applications;
CREATE POLICY "coach_applications_update_admin"
  ON public.coach_applications FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DELETE: admin 만
DROP POLICY IF EXISTS "coach_applications_delete_admin" ON public.coach_applications;
CREATE POLICY "coach_applications_delete_admin"
  ON public.coach_applications FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────
-- 승인 helper 함수 — admin 이 호출하면 coaches_directory 로 이전 + linked_coach_id 채움.
-- tier, category 는 admin 이 별도 인자로 전달.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_coach_application(
  p_application_id uuid,
  p_tier integer,
  p_category text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app RECORD;
  v_new_id uuid;
  v_new_external_id text;
BEGIN
  -- admin 권한 체크
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;

  -- pending 상태인 신청만 처리
  SELECT * INTO v_app
  FROM public.coach_applications
  WHERE id = p_application_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already processed';
  END IF;

  -- external_id 자동 부여: 기존 max + 1
  SELECT COALESCE(MAX(NULLIF(external_id, '')::integer), 800) + 1
    INTO v_new_external_id
  FROM public.coaches_directory
  WHERE external_id ~ '^[0-9]+$';

  v_new_id := gen_random_uuid();
  INSERT INTO public.coaches_directory(
    id, external_id, name, email, phone, organization, position,
    country, intro, expertise, industries, regions,
    tier, category, status
  ) VALUES (
    v_new_id,
    v_new_external_id::text,
    v_app.name, v_app.email, v_app.phone,
    v_app.organization, v_app.position,
    COALESCE(v_app.country, '한국'),
    v_app.intro,
    v_app.expertise, v_app.industries, v_app.regions,
    p_tier,
    p_category,
    'active'
  );

  UPDATE public.coach_applications
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      linked_coach_id = v_new_id
  WHERE id = p_application_id;

  RETURN v_new_id;
END;
$$;

-- 거절 helper 함수
CREATE OR REPLACE FUNCTION public.reject_coach_application(
  p_application_id uuid,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;

  UPDATE public.coach_applications
  SET status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejected_reason = p_reason
  WHERE id = p_application_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found or already processed';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- public INSERT 가능 (anon)
--   INSERT INTO coach_applications(name, email, phone)
--   VALUES ('홍길동', 'test@example.com', '010-1234-5678');
--
--   -- admin: SELECT 가능
--   SELECT * FROM coach_applications WHERE status = 'pending';
--
--   -- admin: 승인
--   SELECT approve_coach_application('<app_id>', 2, '코치');
--   -- → coaches_directory 에 새 row + linked_coach_id 설정
--
--   -- admin: 거절
--   SELECT reject_coach_application('<app_id>', '경력 부족');
-- ─────────────────────────────────────────────────────────────────────
