-- ─────────────────────────────────────────────────────────────────────
-- Phase R (2026-06-01): coach_applications 익명 INSERT 페이로드 상한 강화
--
-- 목적:
--   coach_applications 는 anon(로그인 없는 코치 후보)가 INSERT 가능한 공개
--   등록 테이블 (20260515_phase_j, RLS coach_applications_insert_public).
--   기존 방어: status/null CHECK · email 정규식 · pending 부분 unique 인덱스.
--   미흡: 텍스트 컬럼 길이 상한 · 배열(text[]) cardinality 상한이 없어
--         거대 페이로드(수 MB 텍스트 · 수만 원소 배열) 남용이 가능.
--   → 컬럼별 길이/배열 크기 상한 CHECK 제약을 추가해 남용 면적을 줄인다.
--
-- 출처: docs/AUDIT-2026-06-01.md — P1 (coaching-log · 브리프 SEC2).
--       "coach_applications anon INSERT 방어 (20260515_phase_j:91)".
--
-- 범위/철학:
--   · 안전한 추가 제약만 (결정 불필요). 기존 테이블/정책/함수/구조 무변경.
--   · 진짜 anti-spam(captcha · rate-limit)은 본 작업 범위 밖 (ADR-003 후보).
--
-- 구현 노트:
--   · 모든 제약은 NOT VALID — 기존 행은 검증 스킵, 신규 INSERT/UPDATE 에만
--     즉시 적용 (운영 데이터로 인한 ALTER 실패 방지). VALIDATE 는 의도적으로
--     생략 (기존 행 재검증 불필요).
--   · idempotent — DROP CONSTRAINT IF EXISTS 후 ADD 라서 재실행 안전.
--   · cardinality(NULL)=NULL → CHECK 통과(허용). DEFAULT '{}' 라 보통 비어있음.
-- ─────────────────────────────────────────────────────────────────────

-- name: 최대 100자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_name_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_name_len_chk
  CHECK (char_length(name) <= 100) NOT VALID;

-- email: 최대 320자 (RFC 5321 local 64 + @ + domain 255)
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_email_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_email_len_chk
  CHECK (char_length(email) <= 320) NOT VALID;

-- phone: 최대 40자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_phone_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_phone_len_chk
  CHECK (char_length(phone) <= 40) NOT VALID;

-- organization: NULL 허용 · 최대 200자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_organization_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_organization_len_chk
  CHECK (organization IS NULL OR char_length(organization) <= 200) NOT VALID;

-- position: NULL 허용 · 최대 200자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_position_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_position_len_chk
  CHECK (position IS NULL OR char_length(position) <= 200) NOT VALID;

-- country: NULL 허용 · 최대 100자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_country_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_country_len_chk
  CHECK (country IS NULL OR char_length(country) <= 100) NOT VALID;

-- intro: NULL 허용 · 최대 4000자
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_intro_len_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_intro_len_chk
  CHECK (intro IS NULL OR char_length(intro) <= 4000) NOT VALID;

-- expertise: text[] · 최대 30 원소 (cardinality(NULL)=NULL → 통과)
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_expertise_card_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_expertise_card_chk
  CHECK (cardinality(expertise) <= 30) NOT VALID;

-- industries: text[] · 최대 30 원소
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_industries_card_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_industries_card_chk
  CHECK (cardinality(industries) <= 30) NOT VALID;

-- regions: text[] · 최대 30 원소
ALTER TABLE public.coach_applications
  DROP CONSTRAINT IF EXISTS coach_applications_regions_card_chk;
ALTER TABLE public.coach_applications
  ADD CONSTRAINT coach_applications_regions_card_chk
  CHECK (cardinality(regions) <= 30) NOT VALID;

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 정상 신청은 그대로 통과 (anon)
--   INSERT INTO coach_applications(name, email, phone)
--   VALUES ('홍길동', 'test@example.com', '010-1234-5678');
--
--   -- 거대 텍스트 페이로드는 거부 (name_len_chk 위반)
--   INSERT INTO coach_applications(name, email, phone)
--   VALUES (repeat('가', 5000), 'big@example.com', '010-0000-0000');
--   -- ERROR: new row violates check constraint "coach_applications_name_len_chk"
--
--   -- 거대 intro 거부
--   INSERT INTO coach_applications(name, email, phone, intro)
--   VALUES ('홍길동', 'big2@example.com', '010-0000-0000', repeat('a', 5000));
--   -- ERROR: ... "coach_applications_intro_len_chk"
--
--   -- 거대 배열(31+ 원소) 거부
--   INSERT INTO coach_applications(name, email, phone, expertise)
--   VALUES ('홍길동', 'big3@example.com', '010-0000-0000',
--           (SELECT array_agg('x' || g) FROM generate_series(1, 50) g));
--   -- ERROR: ... "coach_applications_expertise_card_chk"
--
--   -- 제약 목록 확인
--   SELECT conname, convalidated
--   FROM pg_constraint
--   WHERE conrelid = 'public.coach_applications'::regclass
--     AND conname LIKE 'coach_applications_%_chk'
--   ORDER BY conname;
--   -- → 10개 (_len_chk 7 + _card_chk 3), convalidated = false (NOT VALID)
-- ─────────────────────────────────────────────────────────────────────
