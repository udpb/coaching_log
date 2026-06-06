-- ─────────────────────────────────────────────────────────────────────
-- Phase V (2026-06-05): project_members RLS 완화 — PM 협업 시 멤버 수정 데드락 해소
--
-- 문제 (라이브 진단):
--   PM 이 프로젝트의 코치 배정(role/현황)을 수정·해제하려 하면 조용히 실패.
--   원인: project_members 의 INSERT/UPDATE/DELETE RLS 가
--     "admin OR (pm AND 그 프로젝트의 created_by = auth.uid())"
--   로, **본인이 만든 프로젝트만** 수정 가능. projects.created_by NULL 은
--   0건(진단 완료)이므로 고아행 문제는 아니고, **다른 PM/admin 이 만든
--   프로젝트(또는 bp_on_won 트리거가 생성한 프로젝트)** 를 현재 PM 이 수정
--   하려 할 때 RLS 가 0행 처리 → "현황 수정 안 됨".
--
-- 결정 (coach-finder ADR-010, 옵션 A):
--   coaching-log 는 소수 내부 PM 의 협업 도구다. PM 끼리 서로의 프로젝트
--   코치 배정을 관리할 수 있어야 운영이 된다(특히 bp_on_won 으로 자동
--   생성된 프로젝트는 created_by 가 BP 작성자라 다른 PM 이 못 만짐).
--   → INSERT/UPDATE/DELETE 를 `is_admin_or_pm()` 로 완화한다(PM 이면 누구든).
--   SELECT 는 기존 유지(admin/pm 전체 + 본인 멤버).
--
-- 보안 고려:
--   · coaching-log 는 내부 신뢰 사용자(admin/pm)만 PM 권한을 가진다
--     (가입 도메인 트리거 handle_new_user). 외부 coach 는 PM 불가.
--   · 따라서 "모든 PM 이 모든 프로젝트 멤버 관리"는 허용 가능한 신뢰 모델.
--   · coach role 은 여전히 INSERT/UPDATE/DELETE 불가(정책에 미포함).
--
-- 범위/철학:
--   · 기존 정책 DROP + 재생성(완화)만. 테이블/컬럼/트리거 무변경. idempotent.
--   · projects 테이블 자체의 UPDATE/DELETE 정책은 본 마이그레이션 범위 밖
--     (필요 시 별도). 본 건은 project_members 멤버십 관리에 한정.
-- ─────────────────────────────────────────────────────────────────────

-- INSERT: admin/pm 누구든 (기존: admin OR pm-of-own-project)
DROP POLICY IF EXISTS "project_members_admin_insert" ON public.project_members;
CREATE POLICY "project_members_admin_insert"
  ON public.project_members FOR INSERT
  WITH CHECK (public.is_admin_or_pm());

-- UPDATE: admin/pm 누구든
DROP POLICY IF EXISTS "project_members_admin_update" ON public.project_members;
CREATE POLICY "project_members_admin_update"
  ON public.project_members FOR UPDATE
  USING (public.is_admin_or_pm())
  WITH CHECK (public.is_admin_or_pm());

-- DELETE: admin/pm 누구든
DROP POLICY IF EXISTS "project_members_admin_delete" ON public.project_members;
CREATE POLICY "project_members_admin_delete"
  ON public.project_members FOR DELETE
  USING (public.is_admin_or_pm());

-- SELECT 정책은 변경하지 않는다 (admin/pm 전체 + 본인 멤버 — phase5a).

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   SELECT polname, cmd FROM pg_policies
--    WHERE tablename = 'project_members' ORDER BY cmd;
--   -- INSERT/UPDATE/DELETE 가 is_admin_or_pm() 만 참조하는지 확인.
--   -- PM 계정으로 다른 PM 의 프로젝트 멤버 role UPDATE → 성공해야 함.
-- ─────────────────────────────────────────────────────────────────────
