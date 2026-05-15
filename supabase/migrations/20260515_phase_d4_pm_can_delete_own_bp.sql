-- ─────────────────────────────────────────────────────────────────────
-- Phase D4 (2026-05-15): PM 이 본인이 만든 사업(business_plan) 을 삭제할 수
-- 있도록 RLS DELETE policy 확장.
--
-- 배경:
--   20260428_phase5b_business_plans.sql 의 business_plans_delete 정책이
--   admin 만 허용 (USING (public.is_admin())). PM 이 본인이 등록한
--   사업도 삭제할 수 없어 UX 문제. UPDATE 정책은 이미 PM 본인 사업
--   허용하는 패턴 (created_by = auth.uid()) 이라 DELETE 도 같게 정렬.
--
-- 효과:
--   · admin       → 모든 사업 삭제 가능 (변화 없음)
--   · pm          → 본인이 created_by 인 사업만 삭제 가능 (신규 권한)
--   · 일반 coach  → 삭제 불가 (정책 미통과)
--
-- 안전 장치:
--   · business_plan_coaches 는 ON DELETE CASCADE 로 자동 정리 (phase5b 정의)
--   · rfp_history.business_plan_id 는 ON DELETE SET NULL (phase E3) — 히스토리
--     보존되지만 사업 링크만 끊김. PM 본인 데이터라 정합성 OK.
--
-- 후속:
--   · 사업이 status='won' 으로 coaching-log projects 와 연결된 경우, 트리거
--     로 자동 생성된 projects 는 별도로 정리되지 않음. won 상태 사업 삭제는
--     향후 별도 정책 (예: confirm + manual cleanup) 으로 보완.
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "business_plans_delete" ON public.business_plans;

CREATE POLICY "business_plans_delete"
  ON public.business_plans FOR DELETE
  USING (
    public.is_admin()
    OR (public.is_pm() AND created_by = auth.uid())
  );

-- 검증:
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claim.sub = '<PM_uuid>';
-- DELETE FROM business_plans WHERE id = '<bp_uuid_created_by_other_pm>';   -- 0 rows (RLS 거부)
-- DELETE FROM business_plans WHERE id = '<bp_uuid_created_by_me>';         -- 1 row (성공)
