# Brief AI1 — `ai_usage` 테이블 마이그레이션 (coaching-log = 스키마 SoT)

> 자급자족 브리프. 본 파일 + CLAUDE.md + AGENTS.md + glossary.md 외 컨텍스트 불필요.

| 메타 | 값 |
|------|----|
| ID | `AI1-ai-usage-migration` · 우선순위 P0(후속) · 브랜치 `feat/ai-usage-table` · 관련 coach-finder ADR-007 |

---

## 🎯 Mission
Supabase 에 `ai_usage` 테이블을 추가하는 **새 마이그레이션 파일**을 작성한다. coach-finder 의 per-user AI 일일 캡(ADR-007)이 이 테이블을 service-role 로 count/insert 한다. idempotent + RLS enable + 인덱스 포함.

## 📋 Context
coach-finder 감사 P0-C Part2: 인증 사용자가 Gemini 엔드포인트를 무제한 호출 가능. 영속 카운터로 `ai_usage` 테이블 사용. 본 레포가 **스키마 SoT** — 마이그레이션은 여기 새 파일로만.

## ✅ Prerequisites (STOP)
- [ ] `supabase/migrations/` 의 최신 파일·명명(phase 문자, 날짜 prefix) 패턴 확인. 최신은 `20260601_phase_r_coach_applications_hardening.sql`. 다음 phase 문자 = `s`.
- [ ] `is_admin()` SECURITY DEFINER 헬퍼가 기존 마이그레이션에 정의돼 있음(예: `20260421_phase4a_roles_rls.sql`). RLS SELECT 정책에 재사용. 확인.

## 📖 Read First
1. CLAUDE.md · AGENTS.md · glossary.md
2. `supabase/migrations/20260520_phase_n_api_consumers.sql` (가장 비슷한 패턴: usage 테이블 + 인덱스 + RLS — **모방**)
3. `supabase/migrations/20260421_phase4a_roles_rls.sql` (`is_admin()` 헬퍼 정의 위치)
4. `supabase/migrations/20260601_phase_r_coach_applications_hardening.sql` (최신 파일·헤더 주석 스타일)

## 🎯 Scope
### CAN touch
- `supabase/migrations/20260601_phase_s_ai_usage.sql` (신규 · 명명은 레포 패턴 따름)
### MUST NOT touch
- 기존 마이그레이션 파일(적용됨 — 수정 금지, 새 파일만) · 다른 테이블 · coaches_directory 계약

## 🛠 Tasks
1. 새 마이그레이션 파일 작성(헤더 주석에 Why + ADR-007 출처):
```sql
create table if not exists public.ai_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null,
  endpoint    text        not null,
  created_at  timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
-- 카운트/INSERT 는 coach-finder 서버의 service-role 이 RLS 우회. 사용자/anon 직접 접근 없음.
drop policy if exists ai_usage_admin_select on public.ai_usage;
create policy ai_usage_admin_select on public.ai_usage
  for select using (public.is_admin());
```
2. 헤더 주석: 목적(인증 사용자 Gemini 캡), coach-finder ADR-007 참조, "INSERT/count 는 service-role" 명시.
3. (선택) `endpoint` CHECK 제약은 두지 말 것(라벨 추가 유연성 — 'recommend'·'recommend_stream'·'parse_pdf' 등). 주석으로만 값 예시.

## 🔒 Tech Constraints
- idempotent(`if not exists`·`drop policy if exists`). 적용된 마이그레이션 수정 금지.
- `is_admin()` 가 실제 존재하는 시그니처인지 확인 후 사용(없으면 STOP).
- 본 레포는 빌드/tsc 없음 — 검증은 SQL 문법 자체 점검 + 기존 패턴 정합.

## ✔️ Definition of Done
- [ ] 새 마이그레이션 파일 1개(기존 수정 0)
- [ ] `ai_usage` 테이블 + 인덱스 + RLS enable + admin SELECT 정책
- [ ] `is_admin()` 재사용(존재 확인)
- [ ] `git diff --name-only` = 새 파일 1개뿐
- [ ] coaches_directory·변경 금지 미터치

## 📤 Return Format
```
## ✅ 한 일  (파일명 + SQL 핵심)
## ❌ 못한 일 / 보류
## 🤔 결정한 것  (phase 문자·정책 범위 등)
## 🔬 검증  (is_admin() 존재 근거 file:line · 기존 패턴 정합)
## ⚠️ 위험 신호 / 다음 (DB 적용은 수동 운영 단계임을 명시)
```

## 🚫 Do NOT
- 기존 마이그레이션 수정 · coaches_directory 변경 · DB 직접 적용(파일만 작성) · 다른 테이블

## 💡 Hints
- `20260520_phase_n_api_consumers.sql` 의 `api_consumer_usage` 가 거의 같은 모양(usage + 인덱스 + admin RLS). 그대로 모방하면 안전.
- phase 문자: r 다음 s.

## 🏁 Final Note
DB 적용(`supabase db push` 또는 대시보드)은 **운영자 수동 단계** — 본 브리프는 파일 작성까지. "위험 신호"에 적용 필요 명시.
