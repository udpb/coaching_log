-- ─────────────────────────────────────────────────────────────────────
-- Phase M2 (2026-05-20): business_plans 에 지급 일정 (잔금 100% / 50-50 분할) 컬럼 추가
--
-- 배경:
--   계약일로부터 지급일이 3개월 초과 시 선금 50% + 잔금 50% 형태로 분할 지급
--   필요. 그 미만은 잔금 100%. 사용자 샘플 (액션코치 김은영) 기준 — 제3조 4항
--   다음에 2줄만 추가하면 됨:
--     "지급 형태: 선금(50%) / 잔금(50%)"
--     "지급 시기: (선금) N, (잔금) M"
--
-- 추가 컬럼:
--   payment_schedule           text    'lump' | 'installment'  default 'lump'
--   installment_midpay_note    text    선금 지급 시기 자유 텍스트 default 안내문
--   installment_balance_note   text    잔금 지급 시기 자유 텍스트 default 안내문
--
-- 흐름:
--   PM 사업 등록/수정 모달에서 토글 → installment 선택 시 두 시기 텍스트 노출
--   contractGen.ts 가 payment_schedule 보고 두 단락 조건부 삽입
--   템플릿은 docxtemplater {#installment}…{/installment} 블록으로 처리
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.business_plans
  ADD COLUMN IF NOT EXISTS payment_schedule         text NOT NULL DEFAULT 'lump',
  ADD COLUMN IF NOT EXISTS installment_midpay_note  text NOT NULL DEFAULT '사업계약 시작 후 2달 이내 지급',
  ADD COLUMN IF NOT EXISTS installment_balance_note text NOT NULL DEFAULT '계약 종료 후 한달 이내 지급';

ALTER TABLE public.business_plans
  DROP CONSTRAINT IF EXISTS bp_payment_schedule_enum;
ALTER TABLE public.business_plans
  ADD CONSTRAINT bp_payment_schedule_enum
    CHECK (payment_schedule IN ('lump', 'installment'));

COMMENT ON COLUMN public.business_plans.payment_schedule IS
  '지급 일정. lump = 검사 합격 후 잔금 100%, installment = 선금 50% + 잔금 50% 분할.';
COMMENT ON COLUMN public.business_plans.installment_midpay_note IS
  'installment 일 때만 사용. 계약서 제3조 4항 "지급 시기: (선금) ..." 에 들어가는 문구.';
COMMENT ON COLUMN public.business_plans.installment_balance_note IS
  'installment 일 때만 사용. 계약서 제3조 4항 "지급 시기: ..., (잔금) ..." 에 들어가는 문구.';

-- 검증:
--   UPDATE business_plans SET payment_schedule='installment',
--          installment_midpay_note='사업 시작 후 1개월 이내 지급',
--          installment_balance_note='검사 완료 후 4주 이내 지급'
--    WHERE id='...';
--   잘못된 값:
--     UPDATE business_plans SET payment_schedule='foo' WHERE ...;
--     → CHECK violation
