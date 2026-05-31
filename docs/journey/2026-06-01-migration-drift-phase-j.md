# 2026-06-01 · 마이그레이션 드리프트 발견 — Phase J(coach_applications) 실DB 미적용

| 메타 | 값 |
|------|----|
| 메인 세션 | Opus 4.8 (1M) |
| 관련 | SEC2(phase_r) 적용 시도 중 발견 |
| 다음 진입점 | [HANDOFF.md](../../HANDOFF.md) "남은 사용자 액션" |

## 한 일 / 발견

- 사용자가 SEC2 마이그레이션(`20260601_phase_r_coach_applications_hardening.sql`)을 Supabase SQL Editor(프로젝트 `zwvrtxxgctyyctirntzj`, 정상)에서 실행 → `ERROR 42P01: relation "public.coach_applications" does not exist`.
- service-role 로 실DB 전수 점검(읽기 전용, `.from().select().limit(1)` 로 PGRST205 404 확인):
  - **`coach_applications` (Phase J · 20260515) = 실DB에 없음** (PGRST205). → `supabase/migrations/` 폴더와 실DB 드리프트.
  - 나머지 테이블(coaching_logs·profiles·projects·project_members·coaches_directory(+history)·business_plans·business_plan_coaches·coach_evaluations·coach_bookmarks·rfp_history·api_consumers·api_consumer_usage)은 **모두 존재**.
  - **Phase L (20260516)** 은 "coach_business_info 테이블 생성"이 아니라 **`coach_contract_info` 에 컬럼(is_business·business_number·business_name) 추가** — 실DB에 **이미 적용됨**(컬럼 3개 확인). (파일명이 오해 소지.)

## 뭘 틀렸나 / 의외 발견

- 메인이 1차 점검에서 `head:true, count:'exact'` 방식이 404 를 에러로 surface 안 해 `coach_applications`·`coach_business_info` 를 "존재"로 **오판**. `.select().limit(1)` 로 재확인해 정정. **교훈: 존재 확인은 head-count 말고 실제 select 로.**
- "coach_business_info" 는 실재 테이블 아님(Phase L 은 컬럼 추가) — 인벤토리 시 파일명 ≠ 효과 주의.

## 의미

- **coach-finder `/register`(코치 자가등록)·`/applications`(검수) 기능은 프로덕션에서 비동작** (coach_applications 없음). coach_applications 에 INSERT/SELECT 하는 코드는 런타임 404.
- 역설적으로 감사 P1(anon INSERT 위험)은 **현재 존재 안 함**(테이블 없음). SEC2(phase_r) 는 테이블 생성 후에만 의미.

## 결정한 것 / 다음

- 사용자 결정 = **A: 기능 살린다** → Phase J 적용 후 phase_r(SEC2) 적용.
- 적용 순서: ① `20260515_phase_j_coach_applications.sql` → ② `20260601_phase_r_coach_applications_hardening.sql`. (둘 다 SQL Editor, 프로젝트 zwvrtxxgctyyctirntzj.)
- 적용 후 PostgREST 스키마 캐시 자동 reload(필요 시 `NOTIFY pgrst, 'reload schema';`) → 앱에서 coach_applications 인식.

## 적용 결과 (2026-06-01)

- ✅ 사용자가 SQL Editor 에서 `20260515_phase_j_*.sql` 실행 → "Success". 메인이 service-role 로 `coach_applications` 테이블+핵심 컬럼 생성 검증(0행, PostgREST 인식). → /register·/applications 동작.
- ⏳ `20260601_phase_r_*.sql`(SEC2 페이로드 상한)은 후속 1건(테이블 생겼으니 이제 적용 가능).

## 변경된 파일

- 신규: 본 Journey. (마이그레이션 SQL 변경 없음 — 적용은 사용자 SQL Editor.)
- 후속: 전체 migration↔실DB 정합 점검은 별도 권장(이번엔 J 1건만 드리프트로 확인).
