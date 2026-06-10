-- ─────────────────────────────────────────────────────────────────────
-- Phase AA (2026-06-10): coaching_logs 추출 메타 — extraction_model · extraction_version
--
-- 경위: AUDIT-2026-06-10 §2 — /api/extract-session 이 modelUsed
--   (gemini-2.5-pro | gemini-2.5-flash)·usage 를 응답에 포함하지만 DB 에
--   저장하지 않고, 프롬프트 버전 개념도 없었다. 곧 메모 모드(Q2)·템플릿화로
--   프롬프트가 변할 예정 — 지금부터 어떤 모델/프롬프트 버전이 일지를
--   생성했는지 기록해야 과거/미래 일지 품질 비교가 가능하다.
--
-- 컬럼:
--   · extraction_model   text — 실제 추출에 사용된 Gemini 모델 ID
--                               (예: 'gemini-2.5-pro'). 수기 작성 세션은 NULL.
--   · extraction_version text — api/extract-session.js 의 EXTRACTION_VERSION
--                               상수 (형식: 'YYYY-MM-DD.일련번호', 예: '2026-06-10.1').
--                               프롬프트/스키마 의미 변경 시마다 갱신. 수기 작성은 NULL.
--
-- RLS: 변경 없음 — coaching_logs 의 기존 행 단위 정책이 그대로 적용된다.
-- 인덱스: 불필요 (분석용 메타 컬럼 — 필터 빈도 낮음).
-- 멱등: ADD COLUMN IF NOT EXISTS. 두 번 실행해도 안전.
-- ─────────────────────────────────────────────────────────────────────

-- ═══ 1. 컬럼 추가 ═══════════════════════════════════════════════════════
ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS extraction_model text;

ALTER TABLE public.coaching_logs
  ADD COLUMN IF NOT EXISTS extraction_version text;

-- ═══ 2. 백필 — 하지 않음 ═════════════════════════════════════════════════
-- 기존 행은 어떤 모델/버전으로 추출됐는지 알 수 없으므로 NULL 로 둔다.
-- (ai_extracted = true 인 과거 행도 모델 불명 — 추정 백필은 데이터 오염.)

-- ─────────────────────────────────────────────────────────────────────
-- 검증:
--   -- 컬럼 존재 + 타입 확인 → 2 rows (extraction_model | text | YES,
--   --                                  extraction_version | text | YES)
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'coaching_logs'
--      AND column_name  IN ('extraction_model', 'extraction_version')
--    ORDER BY column_name;
--
--   -- (참고) 적용 후 신규 AI 추출 저장 시 값이 채워지는지 확인
--   SELECT id, date, team_name, ai_extracted, extraction_model, extraction_version
--     FROM public.coaching_logs
--    ORDER BY created_at DESC
--    LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────
