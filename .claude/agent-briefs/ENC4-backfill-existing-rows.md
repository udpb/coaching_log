# Brief ENC4 — 기존 평문 행 암호화 백필 스크립트

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `ENC4-backfill-existing-rows` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | ENC1, ENC2 (암호유틸) |
| 우선순위 | P0 |

---

## 🎯 Mission
`coach_contract_info`의 **기존 평문 6필드를 일회성으로 암호화**해 대응 `*_enc` 컬럼에 채운다. **오프라인 스크립트**(운영자가 실행), 멱등·검증 포함.

## 📋 Context
ENC1로 컬럼만 생겼고 ENC2/ENC3로 신규 쓰기는 암호화된다. 그러나 **기존 행은 여전히 평문만** 있음. ENC5(평문 컬럼 제거) 전에 **모든 기존 행을 암호문으로 옮겨야** 데이터 손실 없음. 안 하면 ENC5에서 기존 계약정보가 사라짐.

## ✅ Prerequisites (STOP 조건)
- [ ] ENC1 완료(`*_enc` 컬럼 존재), ENC2 완료(`api/_lib/contractCrypto.js` 재사용 가능)
- [ ] `CONTRACT_ENC_KEYS` + `CONTRACT_ENC_KEY_ACTIVE` = ENC2/ENC3에 쓰는 **동일 값** (불일치 시 복호 불가 → STOP)
- [ ] Supabase **service-role 키**(오프라인 1회용) 확보 — 전체 행 읽기 위해 RLS 우회 필요

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`
2. `../../docs/decisions/024-contract-info-encryption.md`
3. `../.claude/agent-briefs/ENC2-server-crypto-endpoint.md` + `../../api/_lib/contractCrypto.js`(암호 형식 동일 사용)

## 🎯 Scope
### CAN touch
- 신규: `scripts/backfill-contract-enc.mjs` (일회용 오프라인 스크립트)
### MUST NOT touch
- `api/`(읽기전용 재사용만) · `index.html` · 마이그레이션 · 평문 컬럼 **삭제 금지**(ENC5)

## 🛠 Tasks (번호)
1. `scripts/backfill-contract-enc.mjs`:
   - env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(1회용·오프라인), `CONTRACT_ENC_KEY`.
   - `contractCrypto.js`의 `encryptField` **재사용**(동일 형식 보장).
   - service-role 클라로 **모든** `coach_contract_info` 행 조회.
   - 각 행: 6필드 중 `<field>`가 non-null인데 `<field>_enc`가 null인 것만 암호화→`_enc` UPDATE. (**멱등** — 이미 채워진 건 skip)
   - 진행 로그(처리/스킵/실패 수). 실패 시 해당 행 id 출력 후 계속.
   - `--dry-run` 옵션(쓰기 없이 카운트만).
   - `--reencrypt` 옵션(**로테이션 모드**): `_enc`가 이미 있어도, 버전이 ACTIVE보다 낮으면 복호→ACTIVE 키로 재암호화. (키 로테이션 시 옛 버전 데이터 갱신용. 평시 백필은 미지정.)
2. **롤백 안전:** 평문은 **그대로 둠**(이 단계에서 삭제 X). 잘못되면 `_enc`만 비우고 재실행 가능.

## 🔒 Tech Constraints
- **오프라인 일회용** — 배포 안 함, 클라 노출 0. service-role은 **이 스크립트에서만**(절대 브라우저/배포 코드로 유출 금지).
- Node ESM(`.mjs`). 외부 의존성은 `@supabase/supabase-js`(이미 사용 중) 외 추가 금지.
- 평문 컬럼 **읽기만** — 변경/삭제 금지.

## ✔️ Definition of Done
- [ ] `--dry-run` 결과: 암호화 대상 행 수 보고.
- [ ] 실행 후 검증 SQL:
  - `SELECT count(*) FROM coach_contract_info WHERE account_number IS NOT NULL AND account_number_enc IS NULL;` → **0** (6필드 각각)
  - 임의 2~3행 **라운드트립**: `decryptField(account_number_enc) == account_number` (스크립트 검증 모드 또는 수동)
- [ ] 멱등성: 재실행 시 전부 skip(추가 변경 0).
- [ ] 평문 컬럼 무손상(개수·값 동일).
- [ ] `git diff --name-only` = `scripts/backfill-contract-enc.mjs` 뿐.

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (dry-run/실행 카운트/라운드트립 SQL — 구체)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- service-role 키 배포/커밋/클라 노출 · 평문 컬럼 삭제(ENC5) · 비멱등(중복 암호화) 작성
- `--no-verify` · 새 의존성

## 💡 Hints & Edge Cases
- `""` vs `null`: ENC2 정책과 **동일하게** 처리(불일치 시 신규/기존 데이터 불일치).
- 행 수가 적을 것(코치 수준) — 배치/페이지네이션 불필요할 가능성. 그래도 안전하게.
- 키 불일치로 암호화하면 ENC2가 복호 못 함 → **반드시 동일 CONTRACT_ENC_KEY** 확인 후 실행.

## 🏁 Final Note
실행 시점·키 일치는 운영자(사용자)가 최종 확인. 부수 발견은 "위험 신호"로.
