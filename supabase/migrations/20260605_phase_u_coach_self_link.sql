-- ─────────────────────────────────────────────────────────────────────
-- Phase U (2026-06-05): 코치 self-link RPC — 온보딩 데드락 해소
--
-- 문제:
--   신규 코치는 가입 후 온보딩(계약정보 입력)을 강제받는데, 온보딩 화면
--   (myinfo)이 coaches_directory.linked_user_id = auth.uid() 연결을 전제한다.
--   autolink 트리거(20260423_phase4d)는 *이메일이 정확히 일치하는* directory
--   행에만 linked_user_id 를 채운다. 코치가
--     · 초대 이메일과 다른 이메일로 가입했거나
--     · directory 에 본인 행이 아직 없으면(자가등록 승인 전 등)
--   linked_user_id 가 NULL 로 남아 → myinfo 진입이 "admin 문의" 로 막히고,
--   RLS 상 코치는 directory INSERT 불가(admin only) · 미연결이라 UPDATE 도 불가
--   → 온보딩도 다른 메뉴도 못 가는 데드락.
--
-- 결정 (coach-finder ADR-009, 옵션 A):
--   코치 본인이 호출하는 SECURITY DEFINER RPC 로 데드락을 푼다.
--     1) 같은 이메일(대소문자 무시)의 미연결 directory 행이 있으면 → 자동 연결
--     2) 없으면 → 가입자 이름·이메일로 신규 directory 행 생성(status='draft',
--        tier=NULL). admin 이 나중에 tier 부여/검수.
--        ※ status='draft' 선택 이유: CHECK 제약 허용값('active','inactive',
--          'archived','draft') 중 "미검수·미노출"에 해당. 추천 RPC
--          (only_status='active')·코치 검색에서 자동 제외되어, 검수 전 코치가
--          PM 검색에 뜨지 않는다.
--   함수는 auth.uid() 와 본인 profiles.email 만 사용 → 타인 행 연결/생성 불가.
--
-- 보안:
--   · SECURITY DEFINER 로 RLS(INSERT admin-only)를 우회하되, 대상은 항상
--     호출자 본인(auth.uid())으로 강제 → 권한 상승 경로 없음.
--   · 이미 연결된 행이 있으면 그대로 반환(idempotent, 중복 생성 방지).
--   · linked_user_id UNIQUE 제약이 한 user 가 여러 행에 연결되는 것을 막음.
--   · authenticated 에게만 EXECUTE 부여. anon 불가.
--
-- 범위/철학:
--   · 신규 함수 추가만. 기존 테이블/정책/트리거 무변경. idempotent.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_my_coach_directory_row()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_name   text;
  v_cd_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- 1) 이미 연결된 행이 있으면 그대로 반환 (idempotent)
  SELECT id INTO v_cd_id
    FROM public.coaches_directory
   WHERE linked_user_id = v_uid
   LIMIT 1;
  IF v_cd_id IS NOT NULL THEN
    RETURN v_cd_id;
  END IF;

  -- 호출자 본인의 이메일/이름 (profiles = auth.users 미러)
  SELECT lower(email),
         coalesce(nullif(trim(display_name), ''), split_part(email, '@', 1))
    INTO v_email, v_name
    FROM public.profiles
   WHERE id = v_uid;

  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'no email on profile';
  END IF;

  -- 2) 같은 이메일의 미연결 행이 있으면 연결
  UPDATE public.coaches_directory
     SET linked_user_id = v_uid
   WHERE linked_user_id IS NULL
     AND lower(email) = v_email
   RETURNING id INTO v_cd_id;

  IF v_cd_id IS NOT NULL THEN
    RETURN v_cd_id;
  END IF;

  -- 3) 없으면 본인 행 신규 생성 (status='draft' = 미검수·검색 미노출, tier 미정)
  INSERT INTO public.coaches_directory (name, email, status, linked_user_id)
  VALUES (v_name, v_email, 'draft', v_uid)
  RETURNING id INTO v_cd_id;

  RETURN v_cd_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_coach_directory_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_coach_directory_row() TO authenticated;

COMMENT ON FUNCTION public.ensure_my_coach_directory_row() IS
  '코치 본인의 coaches_directory 행을 보장(연결 or 생성). 온보딩 데드락 해소. SECURITY DEFINER + auth.uid() 강제. coach-finder ADR-009.';

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 코치 JWT 로 (또는 service-role 로 SET LOCAL ROLE 흉내):
--   SELECT public.ensure_my_coach_directory_row();   -- → uuid 반환
--   -- 재호출 시 같은 uuid (idempotent), 중복 행 미생성
--   SELECT count(*) FROM coaches_directory WHERE linked_user_id = auth.uid();  -- = 1
--   -- status='draft' 행은 admin 이 검수·tier 부여 대상 (검색 미노출):
--   SELECT id, name, email, status, tier FROM coaches_directory
--    WHERE status = 'draft';
-- ─────────────────────────────────────────────────────────────────────
