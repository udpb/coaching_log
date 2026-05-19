-- ─────────────────────────────────────────────────────────────────────
-- Phase K (2026-05-16): projects INSERT RLS 정리
--
-- 사용자 보고: coaching-log 에서 PM 으로 로그인 후 프로젝트 생성 시
--   "new row violates row-level security policy for table 'projects'"
--
-- 진단:
--   Phase 4b·5a·D3 에 걸쳐 projects INSERT 정책 3개가 누적되어 있음.
--   AND 가 아닌 OR 평가지만, 이전 정책 (created_by 조건) 이 conflict 가능.
--   일관성 위해 모든 INSERT 정책 DROP + 단일 정책으로 통합.
--
-- 통합 정책:
--   admin 또는 pm role 인 사용자가 INSERT 가능
--   (created_by 는 클라이언트가 auth.uid() 로 set — trigger 또는 RPC 보장 권장)
-- ─────────────────────────────────────────────────────────────────────

-- 1) 기존 모든 INSERT 정책 DROP (이름 변종 모두)
DROP POLICY IF EXISTS "projects_owner_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_pm_admin" ON public.projects;

-- 2) 동적으로 남은 모든 INSERT 정책 일소 (위 4개 외에 이름 다른 게 있을 경우)
DO $$
DECLARE p text;
BEGIN
  FOR p IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'public.projects'::regclass AND polcmd = 'a'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.projects', p);
  END LOOP;
END $$;

-- 3) 단일 통합 정책
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_pm());

-- 4) created_by 자동 채움 trigger (이미 있으면 skip)
CREATE OR REPLACE FUNCTION public.projects_set_created_by()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_set_created_by_tr ON public.projects;
CREATE TRIGGER projects_set_created_by_tr
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_set_created_by();

-- ─────────────────────────────────────────────────────────────────────
-- 진단 (적용 전 확인용):
--   SELECT id, role FROM profiles WHERE id = auth.uid();
--   SELECT polname FROM pg_policy WHERE polrelid = 'public.projects'::regclass;
-- 적용 후 검증:
--   INSERT INTO projects (name) VALUES ('test') RETURNING id;  -- 성공해야
--   DELETE FROM projects WHERE name = 'test';
-- ─────────────────────────────────────────────────────────────────────
