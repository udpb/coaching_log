-- ─────────────────────────────────────────────────────────────────────
-- Phase M (2026-05-20): business_plans 에 계약서 과업 옵션 컬럼 추가
--
-- 배경:
--   계약서 제4조(과업 내용)·제5조(결과물 제출) 의 "옵션 선택" / "총 N회" /
--   "팀/개인" / "매주" 등이 사업마다 다른데 템플릿에 하드코딩돼 있어 PM 이
--   docx 다운 후 워드에서 직접 수정 필요. 이를 사업 모달에서 한 번 설정하면
--   그 사업의 모든 코치 계약서에 자동 반영되도록.
--
-- 추가 컬럼 (모두 nullable, 기본값 지정):
--   kickoff_count               int   default 1   -- 제4조 1) 킥오프 미팅 (N회)
--   task_program_learning       text  default '선택' -- 제4조 2) 프로그램 학습 (필수/선택)
--   task_review_participation   text  default '선택' -- 제4조 3) 창업팀 심사 (필수/선택/해당없음)
--   task_program_attendance     text  default '선택' -- 제4조 5) 온/오프 프로그램 참여 (필수/선택/온라인/오프라인)
--   task_participant_type       text  default '팀'   -- 제5조 1) 참가자 (팀/개인)
--   task_report_frequency       text  default '매주' -- 제5조 1) 보고서 작성 주기 (매주/격주/매월)
--
-- 코치별로 다른 항목 (예: 코칭 일지 횟수) 은 business_plan_coaches.payment_info.sessions
-- 에서 자동 파싱 — 별도 컬럼 추가 안 함.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.business_plans
  ADD COLUMN IF NOT EXISTS kickoff_count             int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS task_program_learning     text NOT NULL DEFAULT '선택',
  ADD COLUMN IF NOT EXISTS task_review_participation text NOT NULL DEFAULT '선택',
  ADD COLUMN IF NOT EXISTS task_program_attendance   text NOT NULL DEFAULT '선택',
  ADD COLUMN IF NOT EXISTS task_participant_type     text NOT NULL DEFAULT '팀',
  ADD COLUMN IF NOT EXISTS task_report_frequency     text NOT NULL DEFAULT '매주';

-- 가벼운 값 검증 (자유 텍스트 허용하되 비정상값만 차단)
ALTER TABLE public.business_plans
  DROP CONSTRAINT IF EXISTS bp_kickoff_count_range;
ALTER TABLE public.business_plans
  ADD CONSTRAINT bp_kickoff_count_range
    CHECK (kickoff_count >= 0 AND kickoff_count <= 50);

COMMENT ON COLUMN public.business_plans.kickoff_count IS
  '계약서 제4조 1) 킥오프 미팅 참석 횟수. 기본 1.';
COMMENT ON COLUMN public.business_plans.task_program_learning IS
  '계약서 제4조 2) 전체 프로그램 학습 옵션. 예: 필수/선택.';
COMMENT ON COLUMN public.business_plans.task_review_participation IS
  '계약서 제4조 3) 창업팀 서면·대면 심사 참여 옵션. 예: 필수/선택/해당없음.';
COMMENT ON COLUMN public.business_plans.task_program_attendance IS
  '계약서 제4조 5) 온/오프라인 프로그램 참여 옵션. 예: 필수/선택/온라인/오프라인.';
COMMENT ON COLUMN public.business_plans.task_participant_type IS
  '계약서 제5조 1) 담당 창업교육 참가자 단위. 예: 팀/개인.';
COMMENT ON COLUMN public.business_plans.task_report_frequency IS
  '계약서 제5조 1) 결과 보고서 작성·제출 주기. 예: 매주/격주/매월.';

-- 검증:
--   ALTER OK 면 다음 가능:
--     UPDATE business_plans SET kickoff_count=2, task_program_learning='필수',
--            task_participant_type='개인', task_report_frequency='격주' WHERE id='...';
--   잘못된 kickoff_count 거부:
--     UPDATE business_plans SET kickoff_count=999 WHERE ...;
--     → CHECK violation
