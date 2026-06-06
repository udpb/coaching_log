-- ─────────────────────────────────────────────────────────────────────
-- Phase W (2026-06-05): project_invites — 미가입 코치 "초대 예약" 테이블
--
-- 문제:
--   PM 이 프로젝트에 코치를 배정하려면 project_members.user_id(auth FK,
--   NOT NULL)가 필요 → 코치가 coaching-log 에 가입(magic link 클릭)하기
--   전에는 배정 불가. 초대 메일을 보내도 "등록이 안 됨"(가입 ≠ 배정).
--   또한 코치를 한 명씩 검색·배정해야 해 일괄 등록이 까다로움.
--
-- 결정 (coach-finder ADR-013, 옵션: 체크박스 일괄 + project_invites 분리):
--   미가입 코치(coaches_directory.linked_user_id IS NULL)는 본 테이블에
--   "초대 예약"으로 보관한다. 가입자는 기존대로 project_members 에 즉시 INSERT.
--   화면은 members(배정됨) + invites(가입대기)를 합쳐 표시. 코치가 나중에
--   가입(linked_user_id 채워짐)하면 PM 이 "배정하기" 를 *명시적으로* 눌러
--   project_members 로 승격한다(자동 트리거 지양 — 숨은 동작 = 꼬임의 원천).
--
-- 설계 원칙 (안 꼬임):
--   · coach_directory_id 기반(이메일 아님). 코치가 directory 에 있어야 invite
--     가능(coach-finder 에 먼저 등록). linked_user_id 추적이 자연스럽다.
--   · members 와 invites 를 물리적으로 분리 → 가입자(user_id)/미가입자(directory)
--     를 한 테이블에 섞지 않는다.
--   · 승격은 명시적 RPC(promote_invite_to_member) — 트리거 없음.
--
-- 범위/철학: 신규 테이블 + RPC + RLS 추가만. 기존 테이블 무변경. idempotent.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.project_invites (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  coach_directory_id  uuid NOT NULL REFERENCES public.coaches_directory(id) ON DELETE CASCADE,
  role                text NOT NULL DEFAULT 'coach'
                      CHECK (role IN ('lead_coach','coach','observer')),
  invited_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at          timestamptz NOT NULL DEFAULT now(),
  -- 한 프로젝트에 같은 directory 코치를 중복 초대하지 않음
  UNIQUE (project_id, coach_directory_id)
);

CREATE INDEX IF NOT EXISTS idx_project_invites_project ON public.project_invites(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invites_cd      ON public.project_invites(coach_directory_id);

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT/UPDATE/DELETE = admin/pm (project_members 와 동일 신뢰 모델, ADR-010).
DROP POLICY IF EXISTS "project_invites_select" ON public.project_invites;
CREATE POLICY "project_invites_select" ON public.project_invites
  FOR SELECT USING (public.is_admin_or_pm());

DROP POLICY IF EXISTS "project_invites_insert" ON public.project_invites;
CREATE POLICY "project_invites_insert" ON public.project_invites
  FOR INSERT WITH CHECK (public.is_admin_or_pm());

DROP POLICY IF EXISTS "project_invites_update" ON public.project_invites;
CREATE POLICY "project_invites_update" ON public.project_invites
  FOR UPDATE USING (public.is_admin_or_pm()) WITH CHECK (public.is_admin_or_pm());

DROP POLICY IF EXISTS "project_invites_delete" ON public.project_invites;
CREATE POLICY "project_invites_delete" ON public.project_invites
  FOR DELETE USING (public.is_admin_or_pm());

-- ── 승격 RPC: invite → project_members (명시적, 가입 완료 코치만) ──────────
-- PM 이 "배정하기" 를 누를 때 호출. directory 행에 linked_user_id 가 있어야
-- 승격 가능(가입 완료). 성공 시 members 에 INSERT + invite 행 삭제.
CREATE OR REPLACE FUNCTION public.promote_invite_to_member(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proj   uuid;
  v_cd     uuid;
  v_role   text;
  v_uid    uuid;
  v_mid    uuid;
BEGIN
  -- 호출자 권한: admin/pm 만 (RLS 우회 함수라 명시 체크)
  IF NOT public.is_admin_or_pm() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT project_id, coach_directory_id, role
    INTO v_proj, v_cd, v_role
    FROM public.project_invites WHERE id = p_invite_id;
  IF v_proj IS NULL THEN
    RAISE EXCEPTION 'invite not found';
  END IF;

  -- 코치 가입 여부 = directory.linked_user_id
  SELECT linked_user_id INTO v_uid
    FROM public.coaches_directory WHERE id = v_cd;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'coach not joined yet';  -- 아직 가입 전 → 승격 불가
  END IF;

  -- members 로 INSERT (이미 있으면 그대로 두고 invite 만 정리)
  INSERT INTO public.project_members (project_id, user_id, role, added_by)
  VALUES (v_proj, v_uid, v_role, auth.uid())
  ON CONFLICT (project_id, user_id) DO NOTHING
  RETURNING id INTO v_mid;

  -- 승격 완료 → invite 제거
  DELETE FROM public.project_invites WHERE id = p_invite_id;

  RETURN v_mid;  -- 이미 멤버였으면 NULL 일 수 있음(무해)
END;
$$;

REVOKE ALL ON FUNCTION public.promote_invite_to_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_invite_to_member(uuid) TO authenticated;

COMMENT ON TABLE public.project_invites IS
  '미가입 코치의 프로젝트 초대 예약(coach_directory_id 기반). 가입 후 promote_invite_to_member 로 project_members 승격. coach-finder ADR-013.';

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 정책 4개 확인
--   SELECT polname, cmd FROM pg_policies WHERE tablename='project_invites';
--   -- 미가입 코치 초대 후, 그 코치가 가입(linked_user_id 채워짐)하면:
--   SELECT public.promote_invite_to_member('<invite uuid>');  -- → member uuid
--   -- 가입 전 호출 시 'coach not joined yet' 예외
-- ─────────────────────────────────────────────────────────────────────
