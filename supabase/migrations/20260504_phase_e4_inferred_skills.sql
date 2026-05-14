-- Phase E4 — coaches_directory.inferred_skills (자동 추론 스킬)
-- 2026-05-04
--
-- 의도: coaching_logs 의 main_topic / real_issue / next_action / blocker_type
--   에서 코치가 실제로 다룬 주제를 키워드로 추출 → 매뉴얼 expertise 와 별도로
--   inferred_skills text[] 에 저장. Gloat (LinkedIn 의 내부 마켓플레이스)
--   "스킬 추론" 패턴 — 입력한 스킬이 아니라 한 일에서 추출.
--
-- 데이터 범위: 전체 코치 공유 — coaches_directory 의 다른 컬럼과 동일 RLS
--   (cd_read_authenticated — 모든 authenticated 사용자 read).
--   별도 격리 불필요 (코치의 실력 자체는 PM 들 공유 자산).
--
-- 갱신 방식: tools/infer-coach-skills.mjs 가 SUPABASE_SERVICE_ROLE 로 실행
--   (admin 책임). coaching_logs.coach_id (auth.users.id) → coaches_directory
--   .linked_user_id 매칭 → inferred_skills upsert.
--
-- 멱등성: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.coaches_directory
  ADD COLUMN IF NOT EXISTS inferred_skills text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inferred_skills_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS inferred_skills_source text;
  -- inferred_skills_source: 'gemini' | 'frequency' (어떤 추출 방식인지 audit)

-- 검색용 GIN 인덱스 — manual expertise/industries 와 같은 패턴.
CREATE INDEX IF NOT EXISTS coaches_inferred_skills_gin
  ON public.coaches_directory USING GIN (inferred_skills);

-- 갱신 trigger 도 invalidation 대상에 포함 — embed_source_hash 와는 별개
-- (inferred_skills 변경은 임베딩 재계산 트리거하지 않음. 이름·소개 등이
-- 임베딩 source 이고, inferred_skills 는 검색·표시 용도 보조).
