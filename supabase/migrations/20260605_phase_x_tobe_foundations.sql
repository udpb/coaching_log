-- ─────────────────────────────────────────────────────────────────────
-- Phase X (2026-06-05): To-Be 분리 아키텍처 1단계 — 비파괴 DB 기반
--
-- 트랙 B(두 제품 분리) 1단계. 기존 동작을 깨지 않는 증분만:
--   1) bp_on_won 트리거에 미가입 코치 invite 보존 분기 추가
--   2) projects.business_plan_id 역링크 FK (orphan 방지)
--   3) coach_evaluations UNIQUE(business_plan_id, coach_directory_id) (중복 방지)
--
-- 출처: docs/ARCHITECTURE-SEPARATION-2026-06-05.md(워크플로 wul2659cc), coach-finder ADR-014/018.
-- 철학: 자동 승격 트리거는 만들지 않는다(Phase W·ADR-013 원칙). invite는 "예약"만,
--       member 승격은 PM 명시 클릭(promote_invite_to_member) 유지.
-- 멱등: CREATE OR REPLACE · IF NOT EXISTS · 조건부 ADD. 재실행 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. bp_on_won 트리거 — 미가입 코치 누락 보존 ═══════════════════════
-- 문제: 현행 트리거는 accepted 코치 중 linked_user_id IS NOT NULL(=가입자)만
--   project_members로 복사. 800+ 코치 대부분 미가입 → 수주 시 "배정했는데 멤버에서
--   사라짐". (phase5b:134)
-- 개선: 가입자는 종전대로 project_members, **미가입 accepted 코치는 project_invites로
--   예약**(Phase W 테이블 재사용). 코치가 나중에 가입하면 PM이 명시 '배정하기'로 승격.
--   → 수주 시 어느 accepted 코치도 사라지지 않는다(가입=멤버, 미가입=초대대기).
--
-- ═══ 2. projects.business_plan_id 역링크 FK (orphan 방지) ═══════════════
-- 현행: business_plans.project_id 단방향만 존재(phase5b:25). projects→BP 역참조 없어
--   "소속 사업 없는 project"(직접생성·BP삭제) 추적 불가.
-- 개선: projects.business_plan_id 추가(ON DELETE SET NULL=D5) + bp_on_won이 채움.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS business_plan_id uuid
  REFERENCES public.business_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_business_plan ON public.projects(business_plan_id);

-- 트리거 함수 재정의 (단일): (a)가입→members (b)미가입→invites 보존 + 양방향 링크.
-- 트리거 정의(WHEN 조건)는 불변 — 함수 본문만 교체.
CREATE OR REPLACE FUNCTION public.handle_business_plan_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  -- ★ projects 생성 시 business_plan_id 역링크 동시 기록
  INSERT INTO public.projects (name, description, status, start_date, end_date, created_by, business_plan_id)
  VALUES (NEW.title, NEW.description, 'active', NEW.target_start_date, NEW.target_end_date, NEW.created_by, NEW.id)
  RETURNING id INTO new_project_id;

  UPDATE public.business_plans
     SET project_id = new_project_id
   WHERE id = NEW.id;

  INSERT INTO public.project_members (project_id, user_id, role, added_by)
  SELECT new_project_id, cd.linked_user_id, 'coach', NEW.created_by
    FROM public.business_plan_coaches bpc
    JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
   WHERE bpc.business_plan_id = NEW.id
     AND bpc.status = 'accepted'
     AND cd.linked_user_id IS NOT NULL
  ON CONFLICT (project_id, user_id) DO NOTHING;

  INSERT INTO public.project_invites (project_id, coach_directory_id, role, invited_by)
  SELECT new_project_id, bpc.coach_directory_id, 'coach', NEW.created_by
    FROM public.business_plan_coaches bpc
    JOIN public.coaches_directory cd ON cd.id = bpc.coach_directory_id
   WHERE bpc.business_plan_id = NEW.id
     AND bpc.status = 'accepted'
     AND cd.linked_user_id IS NULL
  ON CONFLICT (project_id, coach_directory_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ═══ 3. coach_evaluations 중복 방지 UNIQUE ══════════════════════════════
-- 현행: (business_plan_id, coach_directory_id) UNIQUE 없어 같은 코치 평가 중복행 가능
--   → coach-finder 평점 집계 모수 불일치(eval-double-count). coach-finder는 upsert
--   하므로 정상 흐름엔 1행이나, 제약이 없어 드리프트 가능.
-- ⚠️ 선결: 기존 중복행이 있으면 UNIQUE 추가 실패 → 먼저 진단·정리(아래 검증 쿼리).
--   business_plan_id NULL 행(=project 기준 평가)이 있으면 부분 인덱스로 분리.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='coach_evaluations_bp_coach_uniq'
  ) THEN
    -- business_plan_id 가 있는 평가만 대상(NULL은 제외 — project-only 평가 허용)
    CREATE UNIQUE INDEX coach_evaluations_bp_coach_uniq
      ON public.coach_evaluations (business_plan_id, coach_directory_id)
      WHERE business_plan_id IS NOT NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 적용 전 선결 진단 (중복 평가 있으면 UNIQUE 생성 실패):
--   SELECT business_plan_id, coach_directory_id, count(*)
--     FROM coach_evaluations WHERE business_plan_id IS NOT NULL
--    GROUP BY 1,2 HAVING count(*) > 1;
--   -- 결과 있으면 최신 1건만 남기고 정리 후 본 마이그레이션 재실행.
--
-- 적용 후 검증:
--   -- 트리거: 미가입 accepted 코치가 invite로 들어가는지(테스트 BP won)
--   -- FK: SELECT business_plan_id FROM projects LIMIT 1;
--   -- UNIQUE: \d coach_evaluations 에서 coach_evaluations_bp_coach_uniq 확인
-- ─────────────────────────────────────────────────────────────────────
