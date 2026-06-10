# 브리프 Q3-20260610-extraction-meta — 추출 모델·버전 DB 기록 (Phase AA)

## 배경 (Why)
AUDIT-2026-06-10 §2: `/api/extract-session` 이 `modelUsed`(gemini-2.5-pro|flash)·`usage` 를 반환하지만 DB에 저장하지 않고, 프롬프트 버전 개념도 없다. 곧 메모 모드(Q2)·템플릿화로 프롬프트가 변할 예정 — 지금 버전 기록을 시작해야 과거/미래 일지 품질 비교가 가능하다.

## 산출물
1. 신규 마이그레이션 `supabase/migrations/20260610_phase_aa_extraction_meta.sql`
2. `api/extract-session.js` 수정 (버전 상수 + 응답 포함)
3. `public/index.html` 수정 (저장 시 두 컬럼 기록)

## 스펙
### 1. 마이그레이션 (새 파일만)
- `ALTER TABLE public.coaching_logs ADD COLUMN IF NOT EXISTS extraction_model text;`
- `ALTER TABLE public.coaching_logs ADD COLUMN IF NOT EXISTS extraction_version text;`
- 헤더 주석(한국어, 기존 스타일) + `-- 검증` 섹션(information_schema 조회).
- RLS 무관(기존 행 단위 정책 그대로). 인덱스 불필요.

### 2. API
- 파일 상단에 `const EXTRACTION_VERSION = '2026-06-10.1';` 상수 (주석: 프롬프트/스키마 의미 변경 시마다 갱신 — 날짜.일련번호).
- 비스트림 응답(현재 ~266-270 의 `modelUsed` 옆)과 **SSE `done` 페이로드 양쪽**에 `extraction_version: EXTRACTION_VERSION` 포함. (스트림 경로의 done 이벤트 조립부를 찾아 동일하게.)

### 3. 프론트
- `runSttExtract` 의 final payload 처리부(~6761-6784)에서 `finalPayload.modelUsed`·`finalPayload.extraction_version` 을 전역이 아닌 기존 추출 상태 변수 패턴(예: `lastTranscriptRaw` 와 같은 위치)에 보관.
- `submitRecord` 의 dbRecord 조립부(~5006 부근, `ai_extracted` 세팅 근처)에서 AI 추출 세션일 때 `extraction_model`·`extraction_version` 포함.
- 기존 "스키마 미적용 폴백"(저장 실패 시 미지원 컬럼 제거 후 재시도, ~5032-5044)이 새 컬럼도 자연 커버하는지 확인하고 보고 (마이그레이션 미적용 환경에서도 저장이 깨지면 안 됨).

## CAN touch
- 위 3개 파일만. 기존 마이그레이션 수정 금지.

## MUST NOT
- 22필드 추출 로직·프롬프트 본문 변경 금지 (Q2 가 별도로 다룸). RLS 변경 금지. git 금지.

## 검증
- `node --check` (extract-session.js + index.html 인라인).
- 코드 경로: 추출→저장 시 dbRecord 에 두 필드 포함됨을 라인 인용으로 증명. 수기 작성(AI 미사용) 시엔 두 필드 미포함(null)임도 확인.
- Return Format 5섹션.
