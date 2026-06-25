# Brief ENC5 — 평문 컬럼 + business_number CHECK 제거 (마이그레이션)

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `ENC5-drop-plaintext-columns` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | ENC1·ENC2·ENC3·ENC4 + coach-finder 전환 **전부 완료·검증** |
| 우선순위 | P0 (⚠️ 파괴적 — 마지막) |

---

## 🎯 Mission
백필·전환 완료 후, `coach_contract_info`의 **평문 6컬럼**과 `business_number` 형식 CHECK 제약을 **새 마이그레이션으로 DROP**한다.

## 📋 Context
ADR-024 최종 단계. 평문 컬럼이 남아있으면 암호화 의미가 반감. 단, **모든 읽기/쓰기가 `_enc`로 전환되고 백필이 끝난 뒤에만** 제거해야 데이터·앱 무손상. 형식검증은 ENC2 서버로 이동했으므로 CHECK 제약도 제거.

## ✅ Prerequisites (STOP 조건 — 하나라도 미충족 시 STOP)
- [ ] ENC4 백필 완료·검증: 모든 행 `*_enc` 채워짐(`<field> NOT NULL AND <field>_enc NULL` = 0, 6필드)
- [ ] ENC3 완료: `index.html`에 `coach_contract_info` 평문 직접접근 **잔존 0**(grep)
- [ ] **coach-finder** 전환 완료: `client/` 에서 평문 6컬럼 직접 SELECT/UPSERT **잔존 0** (cross-repo 확인 — 미완이면 STOP)
- [ ] ENC2 POST에 `business_number` 형식검증 존재(CHECK 대체)
- [ ] **DB 백업/스냅샷** 확보(운영 공유 DB · 되돌리기 대비)

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`
2. `../../docs/decisions/024-contract-info-encryption.md`
3. `../../supabase/migrations/20260516_phase_l_coach_business_info.sql` (CHECK 제약명 `coach_contract_info_business_number_format`)

## 🎯 Scope
### CAN touch
- 신규: `supabase/migrations/20260625_phase_enc5_drop_plaintext_contract_cols.sql`
### MUST NOT touch
- 적용된 마이그레이션 · `_enc` 컬럼 · RLS · 코드

## 🛠 Tasks (번호)
1. 새 마이그레이션:
   - `ALTER TABLE public.coach_contract_info DROP CONSTRAINT IF EXISTS coach_contract_info_business_number_format;`
   - `ALTER TABLE public.coach_contract_info DROP COLUMN IF EXISTS address, ... ` 평문 6컬럼 DROP (`address·bank_name·account_number·account_holder·business_number·business_name`).
2. 파일 상단 주석: ADR-024, **선행조건(백필·전환 완료) 필수**, 적용 전 백업 명시.
3. 하단 `-- 검증` SQL.

## 🔒 Tech Constraints
- 새 마이그레이션 파일만. 기존 수정 금지.
- **파괴적** — 적용은 선행조건 전부 충족·백업 후. 적용 자체는 운영자 판단(브리프는 파일 작성).
- `IF EXISTS`로 멱등.

## ✔️ Definition of Done
- [ ] 마이그레이션 파일 작성 + 선행조건 주석.
- [ ] (적용 시) 검증 SQL:
  - `SELECT column_name FROM information_schema.columns WHERE table_name='coach_contract_info' AND column_name IN ('address','bank_name','account_number','account_holder','business_number','business_name');` → **0행**
  - `*_enc` 6컬럼 + `is_business·tax_type` 등 잔존 확인
  - 앱(coaching_log·coach-finder) 계약정보 뷰·저장·계약서 생성 정상(회귀)
- [ ] `git diff --name-only` = 신규 마이그레이션 1파일.

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (선행조건 확인 + 적용 시 SQL/앱 회귀 — 구체)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- 선행조건 미확인 상태로 적용 권고 · 백업 없이 적용 · `_enc` 컬럼 건드리기
- 적용된 마이그레이션 수정 · `--no-verify`

## 💡 Hints & Edge Cases
- **coach-finder cross-repo 전환 미완이면 절대 적용 금지** — coach-finder가 평문 컬럼 읽다가 깨짐.
- DROP COLUMN은 의존 객체(뷰·함수) 있으면 실패 — `can_access_coach_contract_info`는 컬럼 무관이라 안전하나 확인.

## 🏁 Final Note
이 브리프는 **가장 마지막**. 파일 작성 후 적용은 사용자가 선행조건·백업 확인하고 결정. 부수 발견은 "위험 신호"로.
