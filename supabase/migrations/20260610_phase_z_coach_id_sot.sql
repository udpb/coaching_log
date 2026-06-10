-- ─────────────────────────────────────────────────────────────────────
-- Phase Z (2026-06-10): coaching_logs.coach_id — 마이그레이션 SoT 복구
--
-- 경위: 라이브 DB 의 coaching_logs 에는 coach_id uuid 컬럼이 **이미 존재**한다.
--   프론트(public/index.html)가 insert 시 coach_id = currentUser.id 로 쓰고,
--   phase4a(20260421) 의 RLS 4개 정책이 coach_id = auth.uid() 를 참조하며
--   앱이 정상 동작 중. 그러나 supabase/migrations/ 어디에도 이 컬럼을
--   추가하는 DDL 이 없었다 — 과거 수동 SQL 로 추가된 것 (2026-06-10 감사에서 발견).
--   본 파일은 "마이그레이션 = 스키마 SoT" 원칙을 복구하기 위한 라이브 패리티용:
--   라이브 DB 에는 no-op(멱등), 신규 재구축 시에는 컬럼을 생성한다.
--
-- ⚠️ 재현성 한계 (정직): 빈 DB 에서 마이그레이션을 시간순 재생하면
--   20260421_phase4a_roles_rls.sql 이 본 파일(20260610)보다 먼저 실행되고,
--   그 시점엔 coach_id 가 없어 정책 생성(coach_id = auth.uid())이 실패한다.
--   "적용된 마이그레이션 파일 수정 금지" 원칙 때문에 phase4a 를 고칠 수 없으므로,
--   본 파일은 라이브 패리티 보장까지만 담당한다. 제로베이스 재구축이 필요하면
--   별도 절차 문서(본 파일을 phase4a 앞에 수동 선행 적용 등)가 필요하다.
--
-- 멱등: ADD COLUMN IF NOT EXISTS · FK 는 pg_constraint 존재 검사 후 조건부
--   · CREATE INDEX IF NOT EXISTS. 두 번 실행해도 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. 컬럼 추가 (라이브에 이미 있으므로 IF NOT EXISTS 필수) ═══════════
-- FK 는 일부러 인라인으로 걸지 않는다 — 라이브 컬럼에 FK 가 이미 있는지
-- 불명이므로, 컬럼과 FK 를 별도 문장으로 분리해 FK 단계 문제가 컬럼
-- 추가에 영향을 주지 않게 한다 (FK 는 아래 2단계에서 조건부).
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS coach_id uuid;

-- ═══ 2. FK 조건부 추가 — coach_id → auth.users(id) ═══════════════════════
-- ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS 는 Postgres 에 없으므로
-- pg_constraint 직접 검사. 이름이 아니라 "coach_id 위의 FK 존재 여부"로
-- 검사한다 — 라이브 FK 가 다른 이름(수동 생성)으로 존재할 가능성 방어.
-- NOT VALID 로 추가: 기존 행에 고아 coach_id(탈퇴 유저 등)가 있어도
-- 제약 추가 자체는 실패하지 않게. 검증은 3단계에서 별도 시도.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.coaching_logs'::regclass
       AND c.contype  = 'f'
       AND a.attname  = 'coach_id'
  ) THEN
    ALTER TABLE public.coaching_logs
      ADD CONSTRAINT coaching_logs_coach_id_fkey
      FOREIGN KEY (coach_id) REFERENCES auth.users(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- ═══ 3. FK 검증 시도 (실패해도 마이그레이션은 통과) ═══════════════════════
-- · 라이브 FK 가 다른 이름으로 이미 있으면 2단계가 스킵되어 본 이름이
--   없을 수 있음 → undefined_object 를 잡아 NOTICE 로 처리.
-- · 고아 coach_id 행이 있으면 VALIDATE 가 실패 → WARNING 만 남기고
--   NOT VALID 상태 유지 (신규 행에는 FK 가 즉시 강제됨).
DO $$
BEGIN
  ALTER TABLE public.coaching_logs
    VALIDATE CONSTRAINT coaching_logs_coach_id_fkey;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'coaching_logs_coach_id_fkey 없음 — 라이브 FK 가 다른 이름으로 선재하는 것으로 보고 스킵';
  WHEN others THEN
    RAISE WARNING 'coaching_logs_coach_id_fkey VALIDATE 실패(고아 coach_id 행 가능성) — NOT VALID 유지: %', SQLERRM;
END $$;

-- ═══ 4. 인덱스 (RLS 정책 4개가 coach_id = auth.uid() 로 매번 필터) ═══════
CREATE INDEX IF NOT EXISTS coaching_logs_coach_id_idx
  ON public.coaching_logs (coach_id);

-- ═══ 5. 백필 — 하지 않음 ═════════════════════════════════════════════════
-- coaching_logs.coach 는 자유 텍스트 코치 "이름"(동명이인·표기 변형 가능)이라
-- auth.users 로 신뢰할 수 있는 매핑이 불가. 라이브 행들은 insert 시점에
-- 이미 coach_id 가 채워져 왔으므로(프론트가 currentUser.id 기록) 백필 불필요.
-- coach_id 가 NULL 인 잔존 행은 RLS 상 admin 만 보이는 현행 동작 그대로 둔다.

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 컬럼 존재 + 타입 확인 → 1 row (coach_id | uuid | YES)
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'coaching_logs'
--      AND column_name  = 'coach_id';
--
--   -- 인덱스 확인 → 1 row (coaching_logs_coach_id_idx)
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND tablename  = 'coaching_logs'
--      AND indexname  = 'coaching_logs_coach_id_idx';
--
--   -- (참고) coach_id 위 FK 존재 + validated 여부 확인
--   SELECT c.conname, c.convalidated
--     FROM pg_constraint c
--     JOIN pg_attribute a
--       ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
--    WHERE c.conrelid = 'public.coaching_logs'::regclass
--      AND c.contype  = 'f'
--      AND a.attname  = 'coach_id';
-- ─────────────────────────────────────────────────────────────────────
