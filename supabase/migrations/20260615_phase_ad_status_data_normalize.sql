-- ─────────────────────────────────────────────────────────────────────
-- Phase AD (2026-06-15): status 데이터 변환 (ADR-023 롤아웃 3단계)
--
-- 근거: docs/decisions/023-status-single-lifecycle-coachfinder-sot.md (Accepted 2026-06-15).
-- 브리프: .claude/agent-briefs/S34-20260615-status-data-and-schema.md
--
-- ⚠️ 적용 순서 — 본 파일(A=phase_ad)을 먼저 적용하고,
--    그 다음에 20260615_phase_ae_status_schema_final.sql(B=phase_ae)을 적용한다.
--    B 는 CHECK 를 4값(planning/active/completed/cancelled)으로 좁히므로,
--    A 가 구 어휘(won/draft/proposed/lost)를 먼저 흡수해야 위반 행이 0이 된다.
--    순서를 뒤집으면 B 의 CHECK 정본화가 실패한다.
--
-- 선행(이미 배포):
--   1단계(phase_ac): 트리거 bp_lifecycle_sync_ins/_upd 가 won·active 둘 다 발화
--                    (NEW.project_id IS NULL 가드). 함수 handle_business_plan_won().
--   2단계: coach-finder 가 active 저장.
--
-- 라이브 진단(2026-06-15): won 10건(전부 project_id 있음), active 1건(연성테스트,
--   project_id NULL). 나머지 구 값 0건. (2단계 후 신규 active 수주가 생겼을 수 있어
--   조건부·멱등으로 작성 — 특정 건수에 의존하지 않는다.)
--
-- 이 단계에서 하는 일:
--   1) 구 어휘 → 정본 변환 (won→active, draft/proposed→planning, lost→cancelled).
--   2) 연성테스트류(active AND project_id IS NULL) projects 복구 — 멱등.
--   3) 고아 projects 진단 — 개수만 보고. 삭제/변경 금지(ADR-023 삭제정책 미확정).
--
-- 이 단계에서 하지 않는 것 (→ 4단계 phase_ae):
--   - 트리거 active 전용화(won 제거) · completed/cancelled→projects 동기화
--   - CHECK 정본화(planning/active/completed/cancelled)
--
-- 멱등: UPDATE 는 WHERE 로 대상 한정(재실행 시 변환 대상 0). 복구 DO 블록은
--   project_id IS NULL 재확인으로 두 번 실행해도 projects 중복 생성 없음.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. 구 어휘 → 정본 변환 ═══════════════════════════════════════════════
-- ⚠️ 이 행들은 project_id 가드(NEW.project_id IS NULL)에 의해 트리거 재발화가
--    차단된다. 특히 won 10건은 전부 project_id IS NOT NULL → won→active UPDATE 가
--    트리거를 깨워도 가드에서 미발화(projects 중복 생성·members/invites 재삽입 0).
--    DISTINCT 가드(OLD.status IS DISTINCT FROM NEW.status)와 무관하게 project_id
--    가드만으로 안전하다.

-- won → active (수주 확정 사업 = 진행중)
UPDATE public.business_plans
   SET status = 'active'
 WHERE status = 'won';

-- draft / proposed → planning (수주 전 준비 단계)
UPDATE public.business_plans
   SET status = 'planning'
 WHERE status IN ('draft', 'proposed');

-- lost → cancelled (무산/취소)
UPDATE public.business_plans
   SET status = 'cancelled'
 WHERE status = 'lost';

-- ═══ 2. 연성테스트류 복구 — active 인데 projects 없는 행 ════════════════════
-- 배경: coach-finder 가 'active' 를 저장했으나 1단계 트리거 배포 *전*에 들어간
--   행(또는 active→active 무변동으로 upd 트리거 DISTINCT 가드를 못 깬 행)은
--   projects 가 안 생겼다. 이들에 대해 트리거 함수와 동일한 생성 로직을 수동 실행.
--
-- 멱등 핵심: 루프 진입 조건이 project_id IS NULL 이고, 생성 직후 project_id 를
--   채우므로 두 번 실행해도 (1회차에 채워진) 행은 2회차에서 제외 → projects 중복 0.
--   함수 본문(phase_x/phase_ac)과 동일: projects INSERT + 역링크 + members + invites.
--   ON CONFLICT 로 members/invites 재삽입도 무해.
DO $$
DECLARE
  r               record;
  v_new_project_id uuid;
BEGIN
  FOR r IN
    SELECT id, title, description, target_start_date, target_end_date, created_by
      FROM public.business_plans
     WHERE status = 'active'
       AND project_id IS NULL          -- ★ 멱등 가드: 이미 project 있으면 스킵
  LOOP
    -- (a) projects 생성 + business_plan_id 역링크
    INSERT INTO public.projects (name, description, status, start_date, end_date, created_by, business_plan_id)
    VALUES (r.title, r.description, 'active', r.target_start_date, r.target_end_date, r.created_by, r.id)
    RETURNING id INTO v_new_project_id;

    -- (b) business_plans.project_id 채움 → 다음 회차/트리거 가드 성립
    UPDATE public.business_plans
       SET project_id = v_new_project_id
     WHERE id = r.id;

    -- (c) 가입(linked_user_id 있음) accepted 코치 → project_members
    INSERT INTO public.project_members (project_id, user_id, role, added_by)
    SELECT v_new_project_id, cd.linked_user_id, 'coach', r.created_by
      FROM public.business_plan_coaches bpc
      JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
     WHERE bpc.business_plan_id = r.id
       AND bpc.status = 'accepted'
       AND cd.linked_user_id IS NOT NULL
    ON CONFLICT (project_id, user_id) DO NOTHING;

    -- (d) 미가입(linked_user_id NULL) accepted 코치 → project_invites (예약)
    INSERT INTO public.project_invites (project_id, coach_directory_id, role, invited_by)
    SELECT v_new_project_id, bpc.coach_directory_id, 'coach', r.created_by
      FROM public.business_plan_coaches bpc
      JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
     WHERE bpc.business_plan_id = r.id
       AND bpc.status = 'accepted'
       AND cd.linked_user_id IS NULL
    ON CONFLICT (project_id, coach_directory_id) DO NOTHING;

    RAISE NOTICE 'phase_ad: 연성테스트 복구 — bp % → project %', r.id, v_new_project_id;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 검증 (라이브는 메인이 실행):
--
-- (1) 변환 매트릭스 — 변환 후 구 어휘 0건, 정본 4값만 존재:
--     SELECT status, count(*) FROM public.business_plans GROUP BY status ORDER BY status;
--     -- 기대: planning / active / completed / cancelled 만. won/draft/proposed/lost = 0행.
--     -- (참고: 변환 전 분포를 미리 떠 두면 won 10→active 등 매핑 확인 가능.)
--
-- (2) 연성테스트 복구 — active 인데 project 없는 행 0건:
--     SELECT count(*) AS active_without_project
--       FROM public.business_plans WHERE status='active' AND project_id IS NULL;
--     -- 기대: 0. (복구 전 1건 → DO 블록이 project 생성 후 project_id 채움.)
--     -- 생성된 project 확인:
--     SELECT p.id, p.name, p.status, p.business_plan_id
--       FROM public.projects p
--       JOIN public.business_plans bp ON bp.project_id = p.id
--      WHERE bp.status='active';
--
-- (3) 멱등 — 본 파일 두 번 실행해도 projects 수 불변:
--     SELECT count(*) FROM public.projects;   -- 1회/2회차 동일해야 함.
--
-- (4) 고아 projects 진단 — ⚠️ 삭제/변경 금지, 개수만 보고 (사용자 결정 대기):
--     -- (a) business_plan_id 가 NULL 인 projects (직접 생성 or BP 끊김):
--     SELECT count(*) AS orphan_null_bp
--       FROM public.projects WHERE business_plan_id IS NULL;
--     -- (b) business_plan_id 가 존재하지 않는 BP 를 가리키는 projects
--     --     (실제로는 FK ON DELETE SET NULL 이라 dangling 불가 → 보통 0,
--     --      방어적 점검):
--     SELECT count(*) AS orphan_dangling_bp
--       FROM public.projects p
--      WHERE p.business_plan_id IS NOT NULL
--        AND NOT EXISTS (SELECT 1 FROM public.business_plans bp WHERE bp.id = p.business_plan_id);
--     -- 두 수치는 보고만 한다. ADR-023 삭제정책(고아 처리 archived vs 보존)이
--     -- 라이브 진단 후 사용자와 확정될 때까지 어떤 DELETE/UPDATE 도 하지 않는다.
-- ─────────────────────────────────────────────────────────────────────
