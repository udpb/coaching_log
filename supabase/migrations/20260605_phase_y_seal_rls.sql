-- ─────────────────────────────────────────────────────────────────────
-- Phase Y (2026-06-05): To-Be 분리 2단계 — RLS 봉인
--
-- 트랙 B 2단계의 DB 절반. coaching-log UI 강등(SEAL1 브리프)과 **원자 동시배포**.
-- 목적: 수주前 자산(projects 직접생성·coaches_directory 쓰기)을 RLS로 봉인해
--   시간축 소유권을 코드+DB 양쪽에서 강제. coach-finder ADR-019.
--
-- ⚠️ RLS 한계(정직): RLS는 "어느 앱"인지 구분 못 함(둘 다 같은 role).
--   · projects INSERT 는 트리거(SECURITY DEFINER)만 쓰므로 정책 제거 = 완전 봉인.
--   · coaches_directory 는 admin/self 로 좁히되 coach-finder PM 벌크업로드 영향
--     검토 필요(아래 주석). business_plans/bpc 는 UI 강등이 1차 경계(RLS는 role
--     구분 불가라 미회수 — 3단계 API 경계 또는 현행 유지).
-- 멱등: DROP POLICY IF EXISTS + CREATE. 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. projects INSERT 봉인 — 트리거 전용 (가장 확실한 봉인) ════════════
-- 현행: projects_insert = is_admin OR is_pm (phase_k:36, 직접생성 허용).
-- 변경: 정책 제거 → authenticated 의 직접 INSERT 0. bp_on_won 트리거는
--   SECURITY DEFINER 라 RLS 우회 → 정상 작동(수주 시 projects 생성 유지).
-- 효과: coaching-log·coach-finder 어느 클라도 projects 직접 INSERT 불가.
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_admin_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_pm_admin" ON public.projects;
DROP POLICY IF EXISTS "projects_owner_insert" ON public.projects;
-- 남은 INSERT 정책 일소(이름 변종 방어)
DO $$
DECLARE p text;
BEGIN
  FOR p IN SELECT polname FROM pg_policy
            WHERE polrelid = 'public.projects'::regclass AND polcmd = 'a'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.projects', p); END LOOP;
END $$;
-- INSERT 정책 없음 = 직접 INSERT 차단. 트리거(definer)만 생성.
-- (projects UPDATE/DELETE/SELECT 정책은 불변 — 멤버 모니터링·관리 유지.)

-- ═══ 2. coaches_directory 쓰기 봉인 (D11: coach-finder 단독) ════════════
-- INSERT: phase O 가 PM 까지 열었으나(cd_admin_or_pm_insert), D11 로 admin 단독 회수.
--   · coach-finder 벌크업로드/단건등록은 admin 이 수행(PM 벌크는 추후 정책 결정).
--   · 코치 자가등록 RPC(ensure_my_coach_directory_row)는 SECURITY DEFINER 라 무영향.
--   · 자가등록 승인 RPC(approve_coach_application)도 definer 라 무영향.
DROP POLICY IF EXISTS "cd_admin_or_pm_insert" ON public.coaches_directory;
DROP POLICY IF EXISTS "cd_admin_insert" ON public.coaches_directory;
CREATE POLICY "cd_admin_insert" ON public.coaches_directory
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- UPDATE: admin OR 본인(self-edit) 유지 — coaching-log myinfo 프로필 self-edit 보존.
-- DELETE: admin only 유지(이미). coaching-log 의 클라 직접 DELETE(:9972)는
--   admin 아니면 이미 차단되며, UI 에서도 제거(SEAL1). 정책 변경 없음.

-- ═══ 3. business_plans / business_plan_coaches ═══════════════════════════
-- RLS 는 앱 구분 불가(coach-finder 도 pm). UI 강등(SEAL1: plans 탭·코치핀 제거)이
-- 1차 경계. 쓰기 정책은 현행 유지(is_admin_or_pm) — 회수하면 coach-finder 도 막힘.
-- 코드 경계가 필요하면 3단계 POST /api/won(별도 ADR).
-- → 본 마이그레이션에선 business_plans/bpc RLS 미변경.

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- projects INSERT 정책 0개 확인
--   SELECT polname FROM pg_policy WHERE polrelid='public.projects'::regclass AND polcmd='a';
--   -- → 0 rows
--   -- 수주 트리거는 여전히 작동(definer): 테스트 BP won → projects 생성되는지
--   -- coaches_directory INSERT = admin only
--   SELECT polname FROM pg_policy WHERE polrelid='public.coaches_directory'::regclass AND polcmd='a';
--   -- → cd_admin_insert
-- ⚠️ 원자배포: 이 마이그레이션은 SEAL1(coaching-log UI 강등)과 같은 시점에.
--    UI 가 먼저 배포 안 되면 PM 이 coaching-log 프로젝트생성 버튼 눌러 INSERT 실패 에러.
-- ─────────────────────────────────────────────────────────────────────
