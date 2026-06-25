# Brief ENC2 — 서버 암호 유틸 + contract-info 엔드포인트 (coaching_log api/)

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `ENC2-server-crypto-endpoint` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | ENC1 (컬럼 존재) |
| 우선순위 | P0 |

---

## 🎯 Mission
coaching_log `api/`에 **AES-256-GCM 필드 암호 유틸** + **contract-info 읽기/쓰기 서버리스 엔드포인트**를 만든다. 엔드포인트는 **사용자 Supabase JWT로 RLS를 유지**하고 암복호만 추가한다. (브라우저는 평문을 서버 통해서만 받음)

## 📋 Context
ADR-024: 키는 클라에 두면 무의미 → 서버에서만 암복호. 브라우저 직접 `.from('coach_contract_info')` 접근을 서버 경유로 바꾸기 위한 **서버 측 토대**. 안 하면 ENC3(클라 전환)가 호출할 엔드포인트가 없음.

## ✅ Prerequisites (STOP 조건)
- [ ] ENC1 완료 — `coach_contract_info`에 `*_enc` 6컬럼 존재 (확인: information_schema)
- [ ] env 설정됨 — `CONTRACT_ENC_KEYS`(JSON 버전→base64키 맵, 예 `{"1":"<32B base64>"}`) + `CONTRACT_ENC_KEY_ACTIVE`(예 `1`). 로컬 `.env` + Vercel(Sensitive). 없으면 STOP.
- [ ] 기존 `api/extract-session.js` 의 인증/Supabase 클라 생성 패턴 파악

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`  3. `../../docs/glossary.md`
4. `../../docs/decisions/024-contract-info-encryption.md` (형식 `v1:iv.tag.ct`, 6필드, RLS 유지 원칙)
5. `../../api/extract-session.js` (서버리스 shape · Supabase JWT 인증 패턴 — **그대로 따름**)
6. `../../supabase/migrations/20260515_phase_d5_coach_contract_info.sql` (RLS `cci_*`, `can_access_coach_contract_info`)

## 🎯 Scope
### CAN touch
- 신규: `api/_lib/contractCrypto.js` (암호 유틸) · `api/contract-info.js` (엔드포인트 핸들러)
### MUST NOT touch
- `index.html`(클라 전환은 ENC3) · 적용된 마이그레이션 · 평문 컬럼 · RLS 정책 · `extract-session.js`

## 🛠 Tasks (번호)
1. **`api/_lib/contractCrypto.js`** (버전 키 맵 — 로테이션 무코드 지원):
   - 키 로드: `CONTRACT_ENC_KEYS`(JSON `{ver:base64key}`) 파싱 → 각 키 32B 검증. `CONTRACT_ENC_KEY_ACTIVE` = 현재 암호화 버전.
   - `encryptField(plain: string|null): string|null` — null→null. AES-256-GCM, **랜덤 12B IV**, **ACTIVE 버전 키** 사용. 반환 `"v" + ACTIVE + ":" + b64(iv) + "." + b64(tag) + "." + b64(ct)`.
   - `decryptField(enc: string|null): string|null` — null→null. 앞의 `v<N>:` **버전 파싱 → 맵에서 N번 키 조회 → 복호**. 버전이 맵에 없으면/변조/형식오류 시 throw.
   - `maskAccount(s)` / `maskGeneric(s)` 헬퍼(예: 계좌 뒤 4자리만, 나머지 일부 마스킹).
   - 키 미설정/길이≠32/ACTIVE 키 부재 → 명확한 에러.
2. **`api/contract-info.js`** (핸들러):
   - **인증:** `Authorization: Bearer <supabase access token>` 필수. `extract-session.js` 방식으로 **사용자 JWT로 Supabase 클라 생성**(anon 키 + 사용자 토큰) → **RLS가 보안 경계**. service-role 사용 금지.
   - **GET** `?coachId=<uuid>&reveal=0|1`:
     - 사용자 JWT 클라로 `coach_contract_info` 1행 조회(RLS가 인가 결정). 없으면 빈 객체.
     - 6 `_enc`필드 `decryptField` → `reveal!=1`이면 **마스킹**해서 반환, `reveal=1`이면 평문(계약서 생성용).
     - 비민감(`is_business`,`tax_type`,`updated_at`)은 그대로.
   - **POST** body=평문 객체:
     - `business_number` **형식검증**(`^[0-9\-]{10,15}$`, null 허용) — 평문 CHECK가 ENC5에서 사라지므로 **여기서 검증**.
     - 6필드 `encryptField` → `coach_contract_info`에 `*_enc` 컬럼으로 **UPSERT**(사용자 JWT → RLS WITH CHECK). 비민감 필드도 함께 저장.
   - 메서드 외/미인증/RLS거부 → 적절한 4xx.
3. CORS/메서드 처리는 `extract-session.js` 관례 따름. 무인증+`CORS *` 금지.

## 🔒 Tech Constraints
- `api/*.js` = Vercel Node, `export default`/`module.exports` 핸들러 (기존 shape).
- **service-role 키 클라이언트 노출 절대 금지** — 본 엔드포인트는 **사용자 JWT**만 사용(RLS 유지). service-role 미사용.
- 새 외부 의존성 금지 — Node 내장 `crypto` 사용. Supabase 클라는 기존 사용 패턴 재사용.
- 평문 컬럼 읽기/쓰기 금지 — **`_enc` 컬럼만**.

## ✔️ Definition of Done
- [ ] `encryptField`/`decryptField` 라운드트립 검증: 임의 문자열·한글·null → 암호화→복호화 = 원본. 형식 `v1:` 확인.
- [ ] 같은 입력 2회 암호화 시 **다른 암호문**(랜덤 IV) 확인.
- [ ] 엔드포인트 실호출(배포 or 로컬 mock): 유효 JWT로 POST→GET 라운드트립; **다른 코치 JWT로 GET = RLS 차단(빈/거부)**; 미인증 = 401.
- [ ] `reveal=0` 마스킹 / `reveal=1` 평문 동작.
- [ ] 변경 금지 미터치 · `git diff --name-only` ⊆ {`api/_lib/contractCrypto.js`,`api/contract-info.js`}

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (라운드트립/엔드포인트 호출/RLS 매트릭스 — 구체 결과)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- service-role 키로 RLS 우회 · 클라에 키 노출 · 평문 컬럼 사용
- `index.html` 수정(ENC3) · 백필(ENC4) · 마이그레이션 · `--no-verify`

## 💡 Hints & Edge Cases
- GCM 태그는 16B. IV 12B 권장. base64 분리자는 `.` (값엔 `.` 안 들어감 — base64는 `+/=`).
- 빈 문자열 `""` vs `null` 구분 정책 정하기(권장: `""`→`null` 처리해 일관).
- 마스킹은 복호 후 서버에서. 계좌 마스킹 예: 앞2·뒤4 노출, 중간 `*`.
- Supabase 클라를 사용자 토큰으로 만드는 정확한 방법은 `extract-session.js` 참고(`global.headers.Authorization` 또는 `setSession`).

## 🏁 Final Note
부수 발견은 "위험 신호"로만. 마스킹 규칙·빈값 정책은 결정사항으로 보고(ADR 후보).
