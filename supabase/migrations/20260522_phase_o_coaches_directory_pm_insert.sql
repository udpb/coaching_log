-- ─────────────────────────────────────────────────────────────────────
-- Phase O (2026-05-22): coaches_directory INSERT 정책에 PM 추가
--
-- 배경:
--   기존 cd_admin_insert (admin only) 였으나, PM 들도 자기 사업에 투입할
--   신규 코치를 직접 등록할 수 있어야 한다는 요청. 일괄 업로드 기능을
--   admin → admin + PM 으로 개방.
--
-- 변경:
--   기존 정책 'cd_admin_insert' 삭제 → 'cd_admin_or_pm_insert' 로 재생성
--   USING/CHECK: is_admin() OR is_pm()
--
-- 영향:
--   coach-finder · CoachBulkUploadModal (CSV 일괄 등록)
--   coach-finder · CoachFormModal (단건 신규)
--   둘 다 PM 도 가능해짐. (UI 가드도 같이 풀어줘야 함 — Home.tsx)
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cd_admin_insert" ON public.coaches_directory;
DROP POLICY IF EXISTS "cd_admin_or_pm_insert" ON public.coaches_directory;

CREATE POLICY "cd_admin_or_pm_insert" ON public.coaches_directory
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_pm());

COMMENT ON POLICY "cd_admin_or_pm_insert" ON public.coaches_directory IS
  'Phase O (2026-05-22): admin + PM 모두 신규 코치 등록 가능. UPDATE/DELETE 는 여전히 admin (또는 본인) 전용.';

-- 검증:
--   PM 계정으로 다음 가능:
--     INSERT INTO coaches_directory (external_id, name, email, tier, status)
--       VALUES ('9999', '테스트', 'test@example.com', '2', 'active');
--   coach 계정으로는 여전히 거부:
--     → RLS violation
