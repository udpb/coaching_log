# Brief SEC2 — coach_applications anon INSERT 페이로드 하드닝 (추가 마이그레이션)

> **자급자족 브리프.** 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이 작업.

| 메타 | 값 |
|------|----|
| ID | `SEC2-coach-applications-hardening` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-01 |
| 상태 | ✅ 완료 (2026-06-01) |
| 우선순위 | P1 |

> ✅ **결과**: `20260601_phase_r_coach_applications_hardening.sql` 신규 — 10개 길이/cardinality 상한 CHECK(NOT VALID·idempotent). 메인 검증(read). ⚠️ DB 적용은 사용자 `supabase db push`. captcha 는 ADR-004 분리. ADR-003 / Journey 2026-06-01-p0-security-fixes.

---

## 🎯 Mission

`coach_applications`(anon INSERT 공개 등록 테이블)에 **신규 마이그레이션 파일**로 컬럼별 길이·배열 cardinality 상한 CHECK 제약(NOT VALID)을 추가해, 익명 INSERT 의 페이로드 남용(거대 텍스트·과대 배열) 블래스트 반경을 줄인다. **기존 정책·테이블·로직은 변경하지 않는다.**

## 📋 Context

출처: `docs/AUDIT-2026-06-01.md` P1(coaching-log). `coach_applications` 는 anon 이 INSERT 가능한 공개 자가등록 테이블(`20260515_phase_j_coach_applications.sql`). 이미 status/null CHECK·email 정규식·pending 부분 unique 인덱스가 있으나 **텍스트 길이/배열 크기 상한이 없어** 익명이 거대 페이로드로 남용 가능. 본 작업은 그 표면을 줄이는 안전한 추가 제약(결정 불필요)이다.

> ⚠️ **범위 밖(별도 결정 필요)**: 진짜 anti-spam(captcha/Turnstile + 서버 경유 INSERT)은 provider·아키텍처 결정이 필요해 본 브리프에 없음. ADR-003 후보로 분리.

## ✅ Prerequisites (STOP 조건)

- [ ] `supabase/migrations/20260515_phase_j_coach_applications.sql` 존재 — 테이블 컬럼 정의 확인용
- [ ] `supabase/migrations/` 의 최신 파일이 `20260523_phase_q_*` (다음 phase = R) — 확인: 디렉토리 정렬
- [ ] `coach_applications` 컬럼: name·email·phone(NOT NULL) · organization·position·country·intro · expertise·industries·regions(text[])
다르면 STOP.

## 📖 Read These Files First

1. `../../CLAUDE.md`  2. `../../AGENTS.md` (특히 마이그레이션 룰: 적용된 파일 수정 금지·새 파일만)  3. `../../docs/glossary.md`
4. `../../docs/AUDIT-2026-06-01.md` (P1 coach_applications)
5. `supabase/migrations/20260515_phase_j_coach_applications.sql` (컬럼·기존 CHECK·RLS)

## 🎯 Scope

### CAN touch
- 신규: `supabase/migrations/20260601_phase_r_coach_applications_hardening.sql` (이 파일만 생성)

### MUST NOT touch
- 기존 마이그레이션 파일(특히 phase_j) — 수정 절대 금지
- RLS 정책·approve/reject 함수·테이블 구조 변경 금지 (제약 추가만)
- 그 외 모든 파일

## 🛠 Tasks

1. 신규 마이그레이션 파일 작성. 헤더 주석으로 목적·출처(AUDIT P1) 명시.
2. `coach_applications` 에 `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) NOT VALID;` 로 다음 상한 추가(NOT VALID = 기존 행 검증 스킵, **신규 INSERT/UPDATE 에만 적용** → 기존 데이터로 실패하지 않음):
   - `name`: `char_length(name) <= 100`
   - `email`: `char_length(email) <= 320`
   - `phone`: `char_length(phone) <= 40`
   - `organization`: `organization IS NULL OR char_length(organization) <= 200`
   - `position`: `position IS NULL OR char_length(position) <= 200`
   - `country`: `country IS NULL OR char_length(country) <= 100`
   - `intro`: `intro IS NULL OR char_length(intro) <= 4000`
   - `expertise`: `cardinality(expertise) <= 30`
   - `industries`: `cardinality(industries) <= 30`
   - `regions`: `cardinality(regions) <= 30`
   - 제약명은 `coach_applications_<col>_len_chk` / `_card_chk` 식으로 명확히. `IF NOT EXISTS` 패턴 또는 `DROP CONSTRAINT IF EXISTS` 후 ADD 로 idempotent 하게.
3. 파일 끝에 `-- 검증` 주석으로 수동 확인 SQL 예시(거대 payload INSERT 가 거부되는지) 첨부 — phase_j 스타일 따름.

## 🔒 Tech Constraints

- 순수 Postgres SQL. 적용된 마이그레이션 수정 금지 — 새 파일만.
- `NOT VALID` 필수 (기존 행 검증 회피 — 운영 데이터로 ALTER 실패 방지).
- idempotent (재실행 안전: DROP CONSTRAINT IF EXISTS 또는 DO 블록 + 존재 체크).
- 제약 추가만 — 컬럼 추가/삭제·정책·함수 변경 금지.

## ✔️ Definition of Done

- [ ] `20260601_phase_r_coach_applications_hardening.sql` 1개 생성 (다른 파일 변경 0)
- [ ] 10개 상한 제약 모두 `NOT VALID` + idempotent
- [ ] 기존 정책/함수/구조 무변경
- [ ] `git diff --name-only` = 신규 파일 1개만 (`git status` 에서 `??` 로 표시)
- [ ] (가능하면) `node` 로 간단 구문 sanity 는 불가하므로, SQL 을 눈으로 재검토하고 문법(세미콜론·괄호·DO 블록 종료) 확인 보고

## 📤 Return Format

```
## ✅ 한 일
- <파일명 — 추가한 제약 목록>
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증
- git status --porcelain: <목록 — 신규 1파일>
- 마이그레이션 파일 전체 내용 첨부
- (적용은 불가 — Supabase 에 직접 못 돌림. 사용자가 supabase db push 필요 명시)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것
- (captcha 별도 결정 · 마이그레이션 적용은 사용자 액션 등)
```

## 🚫 Do NOT

- 기존 마이그레이션 수정 · RLS 정책/함수 변경 · 컬럼 추가삭제
- captcha/rate-limit 같은 아키텍처 변경(별도 결정) · 새 의존성 · `--no-verify`

## 💡 Hints & Edge Cases

- `cardinality(NULL)` 는 NULL → CHECK 는 NULL 을 통과(허용)시키므로 NULL 배열도 OK. 컬럼 DEFAULT 가 `'{}'` 라 보통 비어있음.
- ADD CONSTRAINT ... NOT VALID 는 즉시 신규 행에 적용됨(VALIDATE 안 해도). 기존 행은 미검증 — 의도된 동작.
- 적용은 메인/사용자가 `supabase db push` 또는 SQL 콘솔에서. 에이전트는 파일 작성까지만.

## 🏁 Final Note

부수 발견은 "위험 신호" 에만. 임의 추가 작업 금지.
