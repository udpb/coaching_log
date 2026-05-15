-- ─────────────────────────────────────────────────────────────────────
-- Phase D5 (2026-05-15): 코치 계약 정보 별도 테이블 + 세분화 RLS
--
-- 배경:
--   계약서 자동 채움 위해 코치별 주소·계좌·원천세 구분 등 필요. 그러나
--   `coaches_directory` 의 UPDATE policy 는 admin 또는 본인 (linked_user_id)
--   만 허용 — PM 이 계약서 생성 모달에서 입력해도 RLS 거부.
--
--   민감 정보(계좌)라 PM 이 모든 코치 정보를 수정할 수 있게 풀면 위험.
--   → 별도 테이블로 분리, 컬럼 단위 분리 효과 + RLS 정밀 제어.
--
-- 테이블: coach_contract_info
--   coach_directory_id (PK) → coaches_directory(id) CASCADE
--   주소·계좌·원천세 구분
--   주민등록번호는 저장 X (계약서 빈칸 또는 1회성 모달 입력)
--
-- RLS:
--   SELECT/INSERT/UPDATE — 3가지 주체 허용:
--     · admin (전체)
--     · 코치 본인 (linked_user_id = auth.uid())
--     · 그 코치가 투입된 사업의 PM (created_by = auth.uid())
--   DELETE — admin 만 (실제로는 ON DELETE CASCADE 로 자동 정리)
--
-- 이후 사용처:
--   coach-finder /lib/contractGen.ts 가 fetch → 누락 시 모달로 PM 입력
--   → 이 테이블에 UPSERT → 같은 사업의 다음 계약서 생성 시 자동 채움.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coach_contract_info (
  coach_directory_id uuid PRIMARY KEY REFERENCES public.coaches_directory(id) ON DELETE CASCADE,
  -- 주소 (계약서 말미 "코치에 대한 통지" 표)
  address text,
  -- 계좌 (제3조 4항 지급 계좌)
  bank_name text,
  account_number text,
  account_holder text,
  -- 원천세 구분: business_3_3 (사업소득 3.3%) / other_8_8 (기타소득 8.8%)
  tax_type text CHECK (tax_type IS NULL OR tax_type IN ('business_3_3', 'other_8_8')),
  -- 변경 추적
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.coach_contract_info IS
  'Phase D5: 코치 계약서 자동 채움용 민감 정보. coaches_directory 와 분리한 이유는 PM 이 본인 사업 투입 코치 정보만 수정 가능하게 RLS 세분화하기 위함.';

COMMENT ON COLUMN public.coach_contract_info.tax_type IS
  'business_3_3 = 사업소득 3.3% / other_8_8 = 기타소득 8.8%';

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION public.coach_contract_info_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  NEW.updated_by = COALESCE(NEW.updated_by, auth.uid());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_contract_info_set_updated_at_tr ON public.coach_contract_info;
CREATE TRIGGER coach_contract_info_set_updated_at_tr
  BEFORE INSERT OR UPDATE ON public.coach_contract_info
  FOR EACH ROW EXECUTE FUNCTION public.coach_contract_info_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.coach_contract_info ENABLE ROW LEVEL SECURITY;

-- 공통 조건: admin / 코치 본인 / 해당 코치가 투입된 사업의 PM
-- 함수로 추출하면 SELECT/INSERT/UPDATE 정책에서 재사용 가능.
CREATE OR REPLACE FUNCTION public.can_access_coach_contract_info(target_coach_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.coaches_directory cd
      WHERE cd.id = target_coach_id
        AND cd.linked_user_id = auth.uid()
    )
    OR (
      public.is_pm()
      AND EXISTS (
        SELECT 1 FROM public.business_plan_coaches bpc
        JOIN public.business_plans bp ON bp.id = bpc.business_plan_id
        WHERE bpc.coach_directory_id = target_coach_id
          AND bp.created_by = auth.uid()
      )
    );
$$;

DROP POLICY IF EXISTS "cci_select" ON public.coach_contract_info;
CREATE POLICY "cci_select" ON public.coach_contract_info
  FOR SELECT TO authenticated
  USING (public.can_access_coach_contract_info(coach_directory_id));

DROP POLICY IF EXISTS "cci_insert" ON public.coach_contract_info;
CREATE POLICY "cci_insert" ON public.coach_contract_info
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_coach_contract_info(coach_directory_id));

DROP POLICY IF EXISTS "cci_update" ON public.coach_contract_info;
CREATE POLICY "cci_update" ON public.coach_contract_info
  FOR UPDATE TO authenticated
  USING (public.can_access_coach_contract_info(coach_directory_id))
  WITH CHECK (public.can_access_coach_contract_info(coach_directory_id));

-- DELETE 는 admin 만 (CASCADE 가 대부분 처리하므로 거의 호출 안 됨)
DROP POLICY IF EXISTS "cci_delete" ON public.coach_contract_info;
CREATE POLICY "cci_delete" ON public.coach_contract_info
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- admin
--   SELECT * FROM coach_contract_info;                              -- 전체
--
--   -- 코치 본인 (linked_user_id = my uid)
--   SET LOCAL request.jwt.claim.sub = '<coach_uid>';
--   SELECT * FROM coach_contract_info WHERE coach_directory_id = '<my_cd_id>';  -- 본인 정보
--
--   -- PM (created_by = my uid, 코치 X 가 내 사업에 투입됨)
--   SET LOCAL request.jwt.claim.sub = '<pm_uid>';
--   SELECT * FROM coach_contract_info WHERE coach_directory_id = '<coach_X_id>';  -- 가능
--   SELECT * FROM coach_contract_info WHERE coach_directory_id = '<coach_Y_id>';  -- 막힘 (사업에 없음)
-- ─────────────────────────────────────────────────────────────────────
