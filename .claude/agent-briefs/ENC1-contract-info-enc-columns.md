# Brief ENC1 — coach_contract_info 암호문 컬럼 6개 추가 (마이그레이션)

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `ENC1-contract-info-enc-columns` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | 없음 (최초) |
| 우선순위 | P0 |

---

## 🎯 Mission
`coach_contract_info` 에 민감 6필드의 **암호문 저장용 `*_enc text` 컬럼 6개**를 새 마이그레이션으로 추가한다. (평문 컬럼은 이 단계에서 **유지** — dual-read 전환기)

## 📋 Context
ADR-024 결정: 계좌·주소 등 민감정보를 서버사이드 AES-256-GCM으로 암호화해 **필드별 `_enc` 컬럼**에 저장. 본 브리프는 그 **저장 공간(컬럼)** 만 만든다. 암호화 로직·백필은 후속(ENC2·ENC4). 안 하면 이후 단계가 저장할 곳이 없음.

## ✅ Prerequisites (STOP 조건)
- [ ] `supabase/migrations/20260516_phase_l_coach_business_info.sql` 적용됨 = `coach_contract_info`에 `business_number`/`business_name` 존재 (확인: `\d coach_contract_info` 또는 마이그레이션 목록)
- [ ] `coach_contract_info` 에 평문 컬럼 `address·bank_name·account_number·account_holder·business_number·business_name` 존재

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`  3. `../../docs/glossary.md`
4. `../../docs/decisions/024-contract-info-encryption.md` (ADR — 결정·6필드·형식)
5. `../../supabase/migrations/20260515_phase_d5_coach_contract_info.sql` (테이블 정의·RLS)
6. `../../supabase/migrations/20260516_phase_l_coach_business_info.sql` (사업자 컬럼)

## 🎯 Scope
### CAN touch
- **신규 파일만**: `supabase/migrations/20260625_phase_enc1_contract_info_enc_columns.sql`
### MUST NOT touch
- 적용된 `supabase/migrations/*.sql` (D5·L 등) 수정 금지 · `coaches_directory` · RLS 정책 · 평문 컬럼 · 코드(`index.html`/`api/`)

## 🛠 Tasks (번호)
1. 새 마이그레이션 파일 `20260625_phase_enc1_contract_info_enc_columns.sql` 생성.
2. `ALTER TABLE public.coach_contract_info ADD COLUMN IF NOT EXISTS ...` 로 **nullable `text` 컬럼 6개** 추가:
   `address_enc · bank_name_enc · account_number_enc · account_holder_enc · business_number_enc · business_name_enc`
3. 각 컬럼에 `COMMENT` — "ADR-024: <원필드> AES-256-GCM 암호문 (v1:iv.tag.ct base64). 평문 컬럼은 ENC5에서 제거 예정."
4. 파일 하단에 `-- 검증` SQL 스니펫 포함(아래 DoD 참고).
5. **RLS·CHECK 제약 추가 금지** — 새 컬럼은 기존 행 단위 RLS 정책(`cci_*`)에 자동 포함됨(설명 주석만).

## 🔒 Tech Constraints
- 새 마이그레이션 파일만 (`YYYYMMDD_phase_*.sql`). 기존 적용 파일 수정 금지.
- 컬럼 전부 **nullable**, 기본값 없음 (평문 NULL → 암호문도 NULL).
- 암호화 로직·데이터 이동 **없음** (본 브리프는 DDL만). 백필은 ENC4.
- service-role 클라 노출 무관(마이그레이션이라 해당 없음).

## ✔️ Definition of Done
- [ ] Mission: 6개 `_enc` 컬럼 추가됨.
- [ ] 검증 SQL 실행 결과 첨부:
  - `SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_name='coach_contract_info' AND column_name LIKE '%\_enc' ORDER BY 1;` → 6행, 전부 `text`/`YES`
  - 기존 행 영향 0: `SELECT count(*) FROM coach_contract_info WHERE address_enc IS NOT NULL;` → 0
  - RLS 여전히 작동(새 컬럼 포함): 비인가 SELECT 차단 확인(또는 정책이 행 단위라 자동 포함임을 SQL 주석으로 명시)
- [ ] 신규 용어 없음 (컬럼명 `*_enc` 만 — 글로서리에 "암호문 컬럼 규약" 한 줄 추가 검토)
- [ ] 변경 금지 미터치 · `git diff --name-only` = 신규 마이그레이션 1파일뿐

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (SQL 실행 결과 — 구체적으로)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- 적용된 마이그레이션 수정 · 평문 컬럼 변경/삭제(그건 ENC5) · RLS/CHECK 추가
- 암호화 코드·백필 작성(그건 ENC2/ENC4) · 다른 테이블 터치 · `--no-verify`

## 💡 Hints & Edge Cases
- 컬럼명은 ADR-024 매핑 그대로(`<field>_enc`). 오탈자 주의(이후 브리프가 이 이름에 의존).
- `ADD COLUMN IF NOT EXISTS` 로 멱등성 확보(재적용 안전).
- 이 마이그레이션은 **데이터 무변경 · 가산적**이라 운영 DB 적용 위험 낮음(그래도 적용은 검증 SQL과 함께).

## 🏁 Final Note
부수 발견(예: 평문 컬럼의 다른 제약, coach-finder 영향)은 "위험 신호"로만 보고. 임의 추가 금지.
