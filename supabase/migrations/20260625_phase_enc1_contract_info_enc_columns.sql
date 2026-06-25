-- ─────────────────────────────────────────────────────────────────────
-- Phase ENC1 (2026-06-25): coach_contract_info 민감 6필드 암호문 컬럼 추가
--
-- 배경 (ADR-024):
--   coach_contract_info 의 계좌·주소·사업자 정보가 평문(text)으로 저장됨
--   (Phase D5 20260515_*, Phase L 20260516_*). DB 덤프·anon키 우회·수탁사
--   접근 시 금융정보 평문 노출 위험. → 서버사이드 AES-256-GCM 으로 암호화해
--   필드별 *_enc 컬럼에 저장한다(키는 Vercel env CONTRACT_ENC_KEYS).
--
-- 본 마이그레이션(ENC1)이 하는 일:
--   민감 6필드의 **암호문 저장 공간(컬럼)만** 추가한다. 암호화 로직(ENC2)·
--   백필(ENC4)·평문 제거(ENC5)는 후속 단계. 평문 컬럼은 이 단계에서 유지
--   (dual-read 전환기).
--
-- 추가 컬럼 (전부 nullable text, 기본값 없음 — 평문 NULL → 암호문도 NULL):
--   address_enc · bank_name_enc · account_number_enc
--   account_holder_enc · business_number_enc · business_name_enc
--
-- 암호문 형식: v<N>:<iv>.<tag>.<ciphertext> (각 부분 base64).
--   v<N> = 키 버전 태그(복호 시 CONTRACT_ENC_KEYS 맵에서 키 라우팅).
--
-- 성격: 데이터 무변경 · 가산적 DDL · 멱등(ADD COLUMN IF NOT EXISTS).
--
-- RLS:
--   새 컬럼은 행 단위 정책(cci_select / cci_insert / cci_update / cci_delete,
--   Phase D5)에 **자동 포함**된다. RLS 정책은 컬럼이 아니라 행에 작동하므로
--   _enc 컬럼을 위한 신규 정책이 필요 없다. → 본 마이그레이션은 RLS 정책을
--   추가/변경하지 않는다(ADR-024: 권한 모델 불변).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.coach_contract_info
  ADD COLUMN IF NOT EXISTS address_enc         text,
  ADD COLUMN IF NOT EXISTS bank_name_enc       text,
  ADD COLUMN IF NOT EXISTS account_number_enc  text,
  ADD COLUMN IF NOT EXISTS account_holder_enc  text,
  ADD COLUMN IF NOT EXISTS business_number_enc text,
  ADD COLUMN IF NOT EXISTS business_name_enc   text;

COMMENT ON COLUMN public.coach_contract_info.address_enc IS
  'ADR-024: address AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';
COMMENT ON COLUMN public.coach_contract_info.bank_name_enc IS
  'ADR-024: bank_name AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';
COMMENT ON COLUMN public.coach_contract_info.account_number_enc IS
  'ADR-024: account_number AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';
COMMENT ON COLUMN public.coach_contract_info.account_holder_enc IS
  'ADR-024: account_holder AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';
COMMENT ON COLUMN public.coach_contract_info.business_number_enc IS
  'ADR-024: business_number AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';
COMMENT ON COLUMN public.coach_contract_info.business_name_enc IS
  'ADR-024: business_name AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정.';

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- (1) 6개 _enc 컬럼이 전부 text / nullable 로 추가됐는지
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'coach_contract_info'
--      AND column_name LIKE '%\_enc'
--    ORDER BY 1;
--   -- 기대: 6행, data_type = 'text', is_nullable = 'YES'
--   --   account_holder_enc | text | YES
--   --   account_number_enc | text | YES
--   --   address_enc        | text | YES
--   --   bank_name_enc      | text | YES
--   --   business_name_enc  | text | YES
--   --   business_number_enc| text | YES
--
--   -- (2) 기존 행 영향 0 (가산적 DDL — 새 컬럼은 전부 NULL)
--   SELECT count(*) FROM public.coach_contract_info WHERE address_enc IS NOT NULL;
--   -- 기대: 0
--
--   -- (3) RLS: 신규 컬럼 전용 정책 없음(행 단위 정책에 자동 포함). 정책 목록이
--   --     D5 의 cci_select/insert/update/delete 4개 그대로인지 확인.
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'coach_contract_info'
--    ORDER BY 1;
--   -- 기대: cci_delete, cci_insert, cci_select, cci_update (변동 없음)
-- ─────────────────────────────────────────────────────────────────────
