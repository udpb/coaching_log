-- ─────────────────────────────────────────────────────────────────────
-- Phase L (2026-05-16): coach_contract_info 에 사업자 정보 추가
--
-- 배경:
--   코치 중 사업자 등록증 보유 + 사업 계좌로 받고 싶은 경우 별도 입력 필요.
--   현재는 개인 계좌만 받음 — 사업자등록번호·상호 필드 누락.
--
-- 추가 컬럼:
--   is_business        boolean DEFAULT false  -- 사업자 여부 (체크박스)
--   business_number    text                   -- 사업자등록번호 (예: 123-45-67890)
--   business_name      text                   -- 상호 (사업자명)
--
-- 흐름:
--   코치 본인 → coaching-log "내 정보 > 계약 정보" 에서 사업자 여부 토글
--   ON 시 사업자번호·상호 입력 + 계좌도 사업자 계좌로 (기존 bank_name/account_*)
--   계약서 생성 시 사업자 정보 자동 반영 (contractGen.ts 변수 추가)
--   원천세 구분: 사업자 → '사업소득_3_3' 자동 선택 권장
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.coach_contract_info
  ADD COLUMN IF NOT EXISTS is_business boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_number text,
  ADD COLUMN IF NOT EXISTS business_name text;

-- 사업자번호 형식 가벼운 검증 (NULL 허용, 숫자/하이픈만)
ALTER TABLE public.coach_contract_info
  DROP CONSTRAINT IF EXISTS coach_contract_info_business_number_format;
ALTER TABLE public.coach_contract_info
  ADD CONSTRAINT coach_contract_info_business_number_format
    CHECK (
      business_number IS NULL
      OR business_number ~ '^[0-9\-]{10,15}$'
    );

COMMENT ON COLUMN public.coach_contract_info.is_business IS
  '사업자 등록 여부. true 면 business_number/name 권장.';
COMMENT ON COLUMN public.coach_contract_info.business_number IS
  '사업자등록번호 (예: 123-45-67890). 숫자·하이픈만.';
COMMENT ON COLUMN public.coach_contract_info.business_name IS
  '상호 (사업자명). 사업자 계좌 예금주와 동일한 경우 많음.';

-- 검증:
--   ALTER OK 면 다음 모두 가능:
--     UPDATE coach_contract_info SET is_business=true, business_number='123-45-67890',
--            business_name='유디임팩트' WHERE coach_directory_id='...';
--   잘못된 사업자번호 거부:
--     UPDATE coach_contract_info SET business_number='abc' WHERE ...;
--     → CHECK violation
