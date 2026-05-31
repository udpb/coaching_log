# Brief D1 — ud-ops coaches_directory 사본을 공유 계약과 parity 맞춤 (drift 해소)

> **자급자족 브리프.** 대상 레포는 **ud-ops-workspace** (`C:\Users\USER\projects\ud-ops-workspace`). 계약 원본은 coaching-log.

| 메타 | 값 |
|------|----|
| ID | `D1-coaches-contract-parity` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-01 |
| 상태 | ✅ 완료 (2026-06-01) |
| 우선순위 | P1 |

> ✅ **결과**: ud-ops `src/lib/coaches/supabase-source.ts` Row+SELECT 에 4컬럼(`string[]|null`, coach-finder 미러) + 계약 포인터 주석. `npm run typecheck` 통과 · 1파일 · `rowToCoach`/`MappedCoach` 무변경 · 메인 검증(diff read). Prisma 매핑·CI 일치검사는 후속.

---

## 🎯 Mission

ud-ops-workspace `src/lib/coaches/supabase-source.ts` 의 `CoachDirectoryRow` 타입과 `COACH_SELECT_COLUMNS` 에 누락된 4개 공유 컬럼(`inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs`)을 추가해 공유 `coaches_directory` 계약과 parity 를 맞추고, 정식 계약 문서로의 포인터 주석을 단다. **Prisma 매핑(`rowToCoach`/`MappedCoach`)은 변경하지 않는다** (그건 별도 제품 결정).

## 📋 Context

출처: `AUDIT-2026-06-01.md` 공유 데이터레이어 S2. `coaches_directory` 컬럼 계약이 3개 앱에 손복사돼 있고 ud-ops 사본이 4컬럼 누락(stale). coach-finder 사본(`api/_lib/supabaseAdmin.ts`)이 가장 완전하며 그 4컬럼을 포함한다. ud-ops 는 명시적 SELECT 목록을 쓰므로 **추가 컬럼 select 는 무해**(전방호환). 단 `MappedCoach`(Prisma 형태)에는 이 4필드를 받을 곳이 없어, 이번엔 **select+type parity + 포인터 주석까지만** 하고 실제 Prisma 매핑은 보류(제품 결정).

계약 원본(권위): `C:\Users\USER\underdogs-coaching-log\docs\contracts\coaches-directory.md`

## ✅ Prerequisites (STOP 조건)

- [ ] `src/lib/coaches/supabase-source.ts` 에 `CoachDirectoryRow` interface + `COACH_SELECT_COLUMNS` 배열 존재 (현재 4컬럼 누락 상태)
- [ ] 참고용: `C:\Users\USER\underdogs-coach-finder\api\_lib\supabaseAdmin.ts` 의 `CoachDirectoryRow` 가 4컬럼(`inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs`)을 어떻게 타이핑하는지 확인 가능
- [ ] `npm run typecheck` 스크립트 존재 (`tsc --noEmit`)
다르면 STOP.

## 📖 Read These Files First

1. `C:\Users\USER\underdogs-coaching-log\docs\contracts\coaches-directory.md` (§1 컬럼 계약 — 권위)
2. `C:\Users\USER\underdogs-coach-finder\api\_lib\supabaseAdmin.ts` (`CoachDirectoryRow` + `COACH_SELECT_COLUMNS` — 4컬럼 타입 미러용)
3. `src/lib/coaches/supabase-source.ts` (수정 대상 — 64~131행 Row/SELECT)

## 🎯 Scope

### CAN touch
- `src/lib/coaches/supabase-source.ts` (오직 `CoachDirectoryRow` interface + `COACH_SELECT_COLUMNS` 배열 + 상단/해당 위치 주석)

### MUST NOT touch
- `rowToCoach` 함수 본문 · `MappedCoach` interface (Prisma 매핑 변경 금지 — 별도 결정)
- `fetchCoachesFromSupabase` · 캐시 로직 · 그 외 모든 파일
- Prisma schema · DB

## 🛠 Tasks

1. coach-finder `supabaseAdmin.ts` 의 `CoachDirectoryRow` 에서 `inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs` 의 타입을 확인하고, ud-ops `CoachDirectoryRow` 에 **동일 타입으로** 4필드 추가 (status 필드 뒤). coach-finder 가 `string[] | null` 등으로 했다면 그대로 미러. (불명확하면 계약 문서 §1 의 "jsonb/array" 기준으로 `unknown[] | null` 보다는 coach-finder 실제 타입 우선.)
2. `COACH_SELECT_COLUMNS` 배열에 4개 컬럼명 문자열 추가 (`'status'` 뒤).
3. 파일 상단 주석(또는 Row 타입 위)에 포인터 추가:
   - `// 컬럼 계약 권위 원본: underdogs-coaching-log/docs/contracts/coaches-directory.md`
   - `// ⚠️ 이 4컬럼(inferred_skills·roles_capable·roles_active_2026·ud_programs)은 select/parity 만 맞춤 — rowToCoach→MappedCoach(Prisma) 매핑은 미정(향후 결정).`
4. `npm run typecheck` 로 타입 확인.

## 🔒 Tech Constraints

- TypeScript strict (`npm run typecheck` = `tsc --noEmit`).
- 추가 컬럼은 select 만 — `rowToCoach` 가 안 써도 됨(타입상 optional 아님 nullable 로). 미사용 필드 lint 경고 없게.
- 새 의존성·Prisma 변경 금지.

## ✔️ Definition of Done

- [ ] `CoachDirectoryRow` 에 4필드 추가 (coach-finder 타입과 동일)
- [ ] `COACH_SELECT_COLUMNS` 에 4컬럼명 추가
- [ ] 계약 포인터 + 매핑 보류 주석 추가
- [ ] `rowToCoach`/`MappedCoach` 무변경 (diff 로 확인)
- [ ] `npm run typecheck` 통과
- [ ] `git diff --name-only` = `src/lib/coaches/supabase-source.ts` 한 개만

## 📤 Return Format

```
## ✅ 한 일
- <supabase-source.ts:라인 — Row 4필드 · SELECT 4컬럼 · 주석. coach-finder 미러한 타입 명시>
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증
- npm run typecheck: <결과 + 출력 일부>
- git diff --name-only: <목록 — 1파일>
- 추가된 4필드/4컬럼 + 주석 스니펫
- rowToCoach/MappedCoach 무변경 확인(해당 diff 없음)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것
- (Prisma 매핑 미정 · CI 일치검사 후속 등)
```

## 🚫 Do NOT

- `rowToCoach`/`MappedCoach`/Prisma 변경 · 다른 파일 · 새 의존성 · `--no-verify`
- 4컬럼을 추측으로 매핑하지 말 것 (제품 결정 전)

## 💡 Hints & Edge Cases

- coach-finder `COACH_SELECT_COLUMNS` 끝부분에 `inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs` 가 이미 있음 — 컬럼명 그대로.
- jsonb 컬럼이라 타입이 `string[] | null` 이 아닐 수 있음 → **coach-finder 의 실제 선언을 그대로 복사**가 가장 안전.
- 미사용 nullable 필드는 tsc 에러 안 남 (인터페이스 멤버일 뿐).

## 🏁 Final Note

부수 발견(CI 일치검사 부재 · Prisma 매핑 필요성)은 "위험 신호" 에만. 임의 추가 금지.
