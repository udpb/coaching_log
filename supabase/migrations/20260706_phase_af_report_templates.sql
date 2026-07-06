-- ─────────────────────────────────────────────────────────────────────
-- Phase AF (2026-07-06): report_templates — 리포트 템플릿 (AI 자동채움)
--
-- 경위: [[코칭로그 템플릿 기반 리포트]] (LLM-Wiki) · 브리프 B1.
--   발주처(팀/프로젝트)마다 다른 보고서 양식을 코치가 손으로 재입력하는
--   "두 번 일함"을 없애는 기능. admin/PM 이 양식(.docx/.xlsx)을 업로드하면
--   ① AI(template ingest)가 양식의 슬롯을 식별해 slot_schema 로 저장하고,
--   ② 리포트 생성 시 AI(slot fill)가 세션 데이터를 슬롯에 배정,
--   ③ 코드(렌더러)가 원본 서식 보존한 채 값만 주입해 다운로드.
--   AI 는 최종 파일을 만들지 않는다 — 매핑만. 용어는 docs/glossary.md §6.
--
-- 스키마 SoT: 본 레포. coach-finder 는 이 테이블을 사용하지 않음(coaching-log 전용).
--   coaches_directory 공유 계약과 무관 — 신규 독립 테이블.
--
-- 컬럼:
--   · format             docx | xlsx | hwp (CHECK). 렌더러 디스패치 키.
--   · scope_type         global | project | team (CHECK). 노출 범위 구분.
--   · project_id         scope=project/team 시 소속 프로젝트(→projects, CASCADE).
--   · team_name          coaching_logs.team_name 문자열 매칭(팀 테이블 없음).
--   · file_base64        원본 업로드 바이트(base64 text). xlsx 렌더가 이걸 로드.
--   · templatized_base64 docx 전용: ingest 후처리로 {{slot}}·{#sessions} 토큰이
--                        baked 된 렌더용 바이트. xlsx 는 NULL(좌표 주입이라 불필요).
--   · slot_schema        ① ingest AI 슬롯 스키마(slots/repeat_groups). jsonb.
--   · ingest_model       감사용(예: gemini-2.5-pro).
--   · ingest_version     INGEST_VERSION 기록(프롬프트 버전 추적).
--
-- RLS(기본 deny + 기존 헬퍼만 재사용 — 신규 헬퍼 없음):
--   · SELECT  = is_admin_or_pm()  OR  (is_active AND (
--                 (project_id 존재 AND is_project_member(project_id))
--                 OR scope_type = 'global' ))
--               ← 코치: 본인 프로젝트 배정 활성 템플릿 + 공용(global) 활성
--               템플릿 조회 가능(둘 다 리포트 생성용). 비활성·타 프로젝트 전용은
--               코치 미노출. (2026-07-06 사용자 결정: global 은 코치도 노출)
--   · INSERT/UPDATE/DELETE = is_admin_or_pm() 만.
--   헬퍼 시그니처: is_admin_or_pm()  (20260427_phase5a_pm_role.sql:91)
--                  is_project_member(uuid) (20260423_phase4b_projects.sql:52)
--
-- 인덱스: (scope_type, project_id, is_active) — 스코프/프로젝트/활성 필터 조회.
-- updated_at: projects_touch_updated_at 패턴 재사용(테이블별 트리거 함수).
-- 멱등: CREATE TABLE IF NOT EXISTS / DROP POLICY IF EXISTS / DROP TRIGGER IF
--   EXISTS / CREATE OR REPLACE. 두 번 실행해도 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. 테이블 ═════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.report_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  format              text NOT NULL DEFAULT 'docx'
                        CHECK (format IN ('docx', 'xlsx', 'hwp')),
  scope_type          text NOT NULL DEFAULT 'global'
                        CHECK (scope_type IN ('global', 'project', 'team')),
  project_id          uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  team_name           text,
  file_base64         text NOT NULL,                 -- 원본 업로드 바이트
  templatized_base64  text,                          -- docx 태그 baked(xlsx=NULL)
  slot_schema         jsonb NOT NULL DEFAULT '{}'::jsonb, -- ① ingest AI 슬롯 스키마
  ingest_model        text,                          -- 감사용
  ingest_version      text,                          -- INGEST_VERSION
  file_name           text,
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ═══ 2. 인덱스 ═════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_report_templates_scope
  ON public.report_templates (scope_type, project_id, is_active);

-- ═══ 3. updated_at 트리거 (projects_touch_updated_at 패턴 재사용) ═══════
CREATE OR REPLACE FUNCTION public.report_templates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_templates_touch_updated_at ON public.report_templates;
CREATE TRIGGER report_templates_touch_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.report_templates_touch_updated_at();

-- ═══ 4. RLS — 기본 deny + 기존 헬퍼만 ═════════════════════════════════
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: admin/pm 전체 · 코치는 본인 프로젝트 배정 활성 템플릿 + 공용(global) 활성 템플릿
DROP POLICY IF EXISTS "report_templates_select" ON public.report_templates;
CREATE POLICY "report_templates_select"
  ON public.report_templates FOR SELECT
  TO authenticated
  USING (
    public.is_admin_or_pm()
    OR (
      is_active = true
      AND (
        (project_id IS NOT NULL AND public.is_project_member(project_id))
        OR scope_type = 'global'
      )
    )
  );

-- INSERT: admin/pm 만
DROP POLICY IF EXISTS "report_templates_insert" ON public.report_templates;
CREATE POLICY "report_templates_insert"
  ON public.report_templates FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_pm());

-- UPDATE: admin/pm 만
DROP POLICY IF EXISTS "report_templates_update" ON public.report_templates;
CREATE POLICY "report_templates_update"
  ON public.report_templates FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_pm())
  WITH CHECK (public.is_admin_or_pm());

-- DELETE: admin/pm 만
DROP POLICY IF EXISTS "report_templates_delete" ON public.report_templates;
CREATE POLICY "report_templates_delete"
  ON public.report_templates FOR DELETE
  TO authenticated
  USING (public.is_admin_or_pm());

-- ═══ 5. GRANT (RLS 가 실제 경계 — GRANT 는 문법적 접근 허용) ═══════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_templates TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- (1) 테이블 + 컬럼 17개 존재 확인
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'report_templates'
--    ORDER BY ordinal_position;
--
--   -- (2) CHECK 제약 2개(format 3값 · scope_type 3값)
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.report_templates'::regclass AND contype = 'c';
--
--   -- (3) RLS 활성 + 정책 4개(select/insert/update/delete)
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.report_templates'::regclass;                 -- t
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'report_templates'
--    ORDER BY policyname;                                             -- 4 rows
--
--   -- (4) 인덱스 존재
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND tablename = 'report_templates';  -- pkey + idx_...scope
--
--   -- (5) updated_at 트리거 존재
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.report_templates'::regclass
--      AND NOT tgisinternal;                                          -- report_templates_touch_updated_at
--
--   -- (6) 역할별 RLS 스팟체크 — 애플리케이션/psql 세션으로 확인:
--   --     · admin/pm : 전체 노출
--   --     · coach    : 활성 global 템플릿 노출(O) + 본인 프로젝트 배정 활성
--   --                  템플릿 노출(O) + 타 프로젝트 전용/비활성 미노출(0행)
--   --     · anon     : 0행(TO authenticated)
-- ─────────────────────────────────────────────────────────────────────
