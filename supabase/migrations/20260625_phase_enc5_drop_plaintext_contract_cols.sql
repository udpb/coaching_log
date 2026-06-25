-- ─────────────────────────────────────────────────────────────────────
-- Phase ENC5 (2026-06-25): coach_contract_info 평문 6컬럼 + business_number
--                          형식 CHECK 제약 제거 (ADR-024 최종 단계)
--
-- ⚠️⚠️ 파괴적(DESTRUCTIVE) 마이그레이션 — 데이터 영구 삭제. 적용 전 필독. ⚠️⚠️
--
-- 배경 (ADR-024):
--   coach_contract_info 의 계좌·주소·사업자 정보를 서버사이드 AES-256-GCM 으로
--   암호화해 필드별 *_enc 컬럼에 저장(ENC1 추가 · ENC2 서버유틸 · ENC3 앱 전환 ·
--   ENC4 백필). 평문 컬럼이 남아 있으면 DB 덤프·anon키 우회·수탁사 접근 시
--   금융정보가 그대로 노출되어 암호화 의미가 반감 → 본 단계에서 평문 컬럼 제거.
--   business_number 형식검증은 ENC2 서버(POST)로 이동했으므로 평문 컬럼의
--   CHECK 제약(Phase L)도 함께 제거한다.
--
-- 본 마이그레이션(ENC5)이 하는 일:
--   (1) business_number 형식 CHECK 제약 DROP (제약은 평문 컬럼에 의존).
--   (2) 평문 민감 6컬럼 DROP:
--       address · bank_name · account_number · account_holder       (Phase D5)
--       business_number · business_name                             (Phase L)
--   *_enc 6컬럼 · 비민감 컬럼(coach_directory_id · is_business · tax_type ·
--   updated_at · updated_by)은 유지. RLS·트리거·정책 변경 없음.
--
-- ⚠️ Prerequisites — 아래가 전부 충족·검증된 후에만 적용할 것 (운영자 판단):
--   [ ] ENC1 배포: *_enc 6컬럼 존재.
--   [ ] ENC2 배포: 서버 암복호 엔드포인트 + business_number 형식검증(CHECK 대체).
--   [ ] ENC3 배포: coaching_log index.html 평문 직접접근 잔존 0.
--   [ ] coach-finder(별도 레포) 전환 완료: client/ 평문 6컬럼 직접 SELECT/UPSERT
--       잔존 0. ★ 미완이면 절대 적용 금지 — coach-finder 가 평문 읽다 깨짐.
--   [ ] ENC4 백필 완료·검증: 모든 행 *_enc 채워짐
--       (각 필드 <field> NOT NULL AND <field>_enc NULL = 0).
--   [ ] DB 백업/스냅샷 확보(운영 공유 DB · 되돌리기 대비). DROP COLUMN 은
--       평문 데이터를 영구 삭제하므로 백업 없이 적용 금지.
--
-- 성격: 파괴적 DDL(컬럼·제약 영구 삭제) · 멱등(DROP ... IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────

-- (1) business_number 형식 CHECK 제약 제거 (Phase L 에서 추가됨)
ALTER TABLE public.coach_contract_info
  DROP CONSTRAINT IF EXISTS coach_contract_info_business_number_format;

-- (2) 평문 민감 6컬럼 제거
ALTER TABLE public.coach_contract_info
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS account_number,
  DROP COLUMN IF EXISTS account_holder,
  DROP COLUMN IF EXISTS business_number,
  DROP COLUMN IF EXISTS business_name;

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- (1) 평문 6컬럼이 전부 제거됐는지 → 0행 기대
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'coach_contract_info'
--      AND column_name IN (
--        'address', 'bank_name', 'account_number',
--        'account_holder', 'business_number', 'business_name'
--      );
--   -- 기대: 0행
--
--   -- (2) *_enc 6컬럼 + 비민감 컬럼이 그대로 남았는지 → 11행 기대
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name = 'coach_contract_info'
--    ORDER BY 1;
--   -- 기대(11행): account_holder_enc · account_number_enc · address_enc ·
--   --   bank_name_enc · business_name_enc · business_number_enc   (*_enc 6)
--   --   coach_directory_id · is_business · tax_type · updated_at · updated_by (비민감 5)
--
--   -- (3) business_number CHECK 제약 제거 확인 → 0행 기대
--   SELECT conname
--     FROM pg_constraint
--    WHERE conrelid = 'public.coach_contract_info'::regclass
--      AND conname = 'coach_contract_info_business_number_format';
--   -- 기대: 0행
--
--   -- (4) 앱 회귀(수동): coaching_log·coach-finder 계약정보 뷰 표시·저장·
--   --     계약서 생성이 *_enc 경유로 정상 동작하는지 확인.
-- ─────────────────────────────────────────────────────────────────────
