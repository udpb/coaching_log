-- ─────────────────────────────────────────────────────────────────────
-- Phase G2-B (2026-05-15): profiles.onboarded_at 컬럼
--
-- 목적:
--   신규 코치가 Magic Link 로 첫 로그인할 때 환영 모달 + 정보 등록
--   안내를 1회만 노출. 등록 완료 시점에 onboarded_at = now() 저장 →
--   이후 재로그인 시 모달 안 뜸.
--
-- 컬럼:
--   onboarded_at timestamptz nullable
--     · null  → 신규 (환영 모달 노출)
--     · 값 있음 → 온보딩 완료
--
-- 적용 안전성:
--   · ADD COLUMN IF NOT EXISTS — 기존 row 영향 없음 (모두 null 시작)
--   · 기존 사용자는 next login 시 일회성 모달 보게 됨 — 의도적 (정보 미등록자
--     도 안내 받게).
--   · 이미 정보 등록 완료한 사용자에게도 환영 메시지 한 번 노출 — 가벼운 트레
--     이드오프 (UX 메리트가 더 큼).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

COMMENT ON COLUMN public.profiles.onboarded_at IS
  'Phase G2-B: 신규 코치 온보딩 환영 모달 1회 노출 후 now() 저장. null = 신규.';

-- 코치 본인이 자기 onboarded_at 만 UPDATE 가능하도록 RLS 보강.
-- 기존 profiles UPDATE policy 가 이미 self-update 허용한다고 가정 (Phase 4a).
-- 정책 누락 가능성 대비 idempotent 추가:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.profiles'::regclass
      AND polname = 'profiles_self_update'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "profiles_self_update" ON public.profiles
        FOR UPDATE TO authenticated
        USING (id = auth.uid())
        WITH CHECK (id = auth.uid())
    $sql$;
  END IF;
END $$;

-- 검증:
--   SELECT id, role, onboarded_at FROM profiles WHERE id = auth.uid();
--   UPDATE profiles SET onboarded_at = now() WHERE id = auth.uid();  -- 본인만
