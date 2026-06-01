-- ─────────────────────────────────────────────────────────────────────
-- Phase T (2026-06-01): search_coaches_by_embedding — tier 타입 드리프트 핫픽스
--
-- 문제 (라이브 진단 확정):
--   프로덕션 coaches_directory.tier 컬럼이 integer 인데, RPC 본문은
--   `c.tier = ANY(filter_tier)` 로 text[] 와 비교 → PostgreSQL 이 plan 단계에서
--   `operator does not exist: integer = text` (42883) 로 실패.
--   filter_tier 가 NULL 이어도 (단축평가 이전) plan-time 타입체크에서 죽으므로
--   /api/recommend · /api/recommend/stream(AI 맞춤추천=메인 기능) · /api/similar-coaches
--   가 모두 비동작. = P0.
--
-- 결정 (coach-finder ADR-008, 옵션 B):
--   컬럼 타입·write 경로는 건드리지 않고 RPC 함수에서만 `c.tier::text` 로 캐스트.
--   세 앱(coach-finder·coaching-log·ud-ops)이 tier 를 text 로 읽는 계약과 정합.
--
-- 범위/철학:
--   · 함수 본문(비교)과 RETURNS 매핑만 ::text 캐스트 추가. 시그니처(파라미터 타입)
--     불변 → 호출부(coach-finder recommend.ts) 무변경. 기존 GRANT 유지.
--   · CREATE OR REPLACE 라 재실행 안전. 컬럼/인덱스/트리거/RLS 무변경.
--   · 20260424_phase4e_pgvector_rag.sql 의 정의를 베이스로, tier 비교/매핑만 캐스트.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_coaches_by_embedding(
  query_embedding   vector(1536),
  match_count       int     DEFAULT 10,
  only_status       text    DEFAULT 'active',
  only_availability text    DEFAULT 'available',
  filter_tier       text[]  DEFAULT NULL,
  filter_expertise  text[]  DEFAULT NULL,
  filter_regions    text[]  DEFAULT NULL,
  filter_industries text[]  DEFAULT NULL
)
RETURNS TABLE (
  id                  uuid,
  external_id         text,
  name                text,
  email               text,
  organization        text,
  "position"          text,
  tier                text,
  expertise           text[],
  regions             text[],
  industries          text[],
  roles               text[],
  photo_url           text,
  intro               text,
  career_years        numeric,
  availability_status text,
  similarity          float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id, c.external_id, c.name, c.email, c.organization,
    c."position",
    c.tier::text,                              -- 핫픽스: integer 컬럼 → text 반환
    c.expertise, c.regions, c.industries, c.roles,
    c.photo_url, c.intro, c.career_years, c.availability_status,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.coaches_directory c
  WHERE c.embedding IS NOT NULL
    AND (only_status IS NULL OR c.status = only_status)
    AND (only_availability IS NULL OR c.availability_status = only_availability)
    AND (filter_tier IS NULL OR c.tier::text = ANY(filter_tier))   -- 핫픽스: ::text 캐스트
    AND (filter_expertise IS NULL OR c.expertise && filter_expertise)
    AND (filter_regions IS NULL OR c.regions && filter_regions)
    AND (filter_industries IS NULL OR c.industries && filter_industries)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_coaches_by_embedding TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 임베딩 있는 코치 1명 기준, filter_tier=NULL 로 호출 → 더 이상 42883 안 남
--   SELECT id, name, tier, similarity
--     FROM public.search_coaches_by_embedding(
--       (SELECT embedding FROM public.coaches_directory
--         WHERE embedding IS NOT NULL LIMIT 1),
--       5, 'active', NULL, NULL, NULL, NULL, NULL);
--   -- filter_tier := ARRAY['1'] 로도 호출 → 정상 (tier 1 만 반환)
-- ─────────────────────────────────────────────────────────────────────
