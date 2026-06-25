# ADR-024: coach_contract_info 민감정보(계좌·주소) 필드 암호화

| 메타 | 값 |
|------|----|
| 상태 | Accepted |
| 일자 | 2026-06-25 |
| 작성자 | 메인 세션 (사용자 승인) |
| Supersedes | — |
| Superseded by | — |
| 관련 브리프 | ENC1~ENC6 (`.claude/agent-briefs/`) |
| 관련 Journey | — |

---

## Context (왜)

`coach_contract_info` 테이블에 **계좌번호·예금주·은행·주소·사업자등록번호·상호가 평문(`text`)** 으로 저장돼 있다. (Phase D5 `20260515_*`, Phase L `20260516_*`)

- **법/정책 근거:** UD IMPACT 개인정보처리방침(2026-04-24) §2는 "결제 정보: 청구 주소, … **계좌 정보**"를 수집 항목으로 명시. §9 안전성 확보조치는 현재 **"비밀번호 암호화"만** 명시 → 계좌·주소는 암호화 미적용 = **보호 공백**. §5 위탁(서버 호스팅·인프라 = Supabase/Vercel)·§6 국외이전 관점에서 **저장 전 암호화하면 수탁사도 평문 접근 불가**.
- **안 하면:** DB 덤프·anon키 우회·수탁사 접근 시 금융정보 평문 노출. 전자금융·개인정보 안전성 확보조치 기준 미달.

> 주민등록번호(고유식별정보)는 정책·DB 모두 **미수집**(D5 헤더 "주민번호 저장 X") → 의무 암호화 대상 없음. 계좌·주소는 **자발적 강화**.

## Decision (무엇을)

**`coach_contract_info`의 민감 6필드를 서버사이드 AES-256-GCM으로 암호화하여 필드별 `_enc` 컬럼에 저장한다. 키는 양 앱 공통 Vercel env(`CONTRACT_ENC_KEY`)에만 두고, 브라우저 직접 접근을 서버 엔드포인트 경유로 바꾼다.**

- **대상 6필드:** `address` · `bank_name` · `account_number` · `account_holder` · `business_number` · `business_name`
- **저장:** 필드별 암호문 컬럼 `*_enc text` (NULL은 NULL). 형식 `v<N>:<iv>.<tag>.<ciphertext>`(base64). `v<N>` = **키 버전 태그**(복호 시 어느 키를 쓸지 라우팅).
- **암호:** AES-256-GCM(랜덤 IV·인증태그). 검색 불필요 → 결정적/블라인드 인덱스 불필요.
- **키 (버전 맵 — 로테이션 대비):** env 2개로 관리, **두 Vercel 프로젝트에 동일**(같은 Supabase), Sensitive 등록.
  - `CONTRACT_ENC_KEYS` = JSON 버전→키 맵, 예 `{"1":"<base64 32B>"}`
  - `CONTRACT_ENC_KEY_ACTIVE` = 현재 암호화에 쓸 버전(예 `1`)
  - **암호화**는 ACTIVE 버전 키로(앞에 `v<ACTIVE>:`), **복호화**는 암호문의 `v<N>:`을 보고 맵에서 해당 키 조회.
  - **로테이션 = env에 새 버전 키 추가 + ACTIVE 변경 + 배포. 코드 변경 0.** 옛 데이터는 옛 키(맵에 유지)로 계속 복호.
- **접근:** 브라우저 직접 `.from('coach_contract_info')` (현 `index.html` L8207·L8328, coach-finder `client/`) **중단** → **서버 엔드포인트(`api/`) 경유**. 서버는 **사용자 Supabase JWT를 그대로 사용해 RLS를 보안 경계로 유지**하고 암복호 레이어만 추가. 브라우저는 행을 읽어도 **암호문만** 본다.
- **마스킹:** 평소 UI는 마스킹(`****1234`, 주소 일부). 전체 복호는 **계약서 생성 시점만**.
- **파기:** 보유기간 종료/탈퇴 시 **행 DELETE**(기존 RLS DELETE=admin + CASCADE). crypto-shredding/레코드별 키 안 함(결정).

## Consequences (결과)

### Positive
- 계좌·주소 평문 노출 제거(DB 덤프·anon우회·수탁사·국외저장 모두 방어). 정책 §9를 비밀번호 외로 확장.
- 필드별 컬럼 → 계좌번호만 복호해 마스킹 가능, 부분 업데이트 용이.
- RLS는 그대로 보안 경계(서버가 사용자 JWT 사용) → 권한 모델 불변.

### Negative / Trade-off
- **브라우저 직접접근 → 서버 경유 리팩터** 필요(양 앱 읽기/쓰기 경로). `contractGen.ts`도 서버값 사용으로 변경.
- 암호화 필드는 **DB에서 검색/정렬 불가**(이 데이터는 불필요 → 허용).
- 키 분실 시 복호 불가 → 키는 Vercel env(Sensitive) + 별도 안전 보관 필수.
- `business_number` 평문 컬럼의 형식 CHECK 제약은 제거되고 **형식검증이 서버로 이동**.

### 영향 받는 코드 · 문서 · DB / 공유 계약
- **DB(SoT=본 레포):** 새 마이그레이션 2개(컬럼 추가 / 평문·CHECK 제거). `coach_contract_info` 스키마.
- **coaching_log:** `public/index.html`(L8207·L8328 인근 contract-info 읽기/쓰기) · `api/`(신규 엔드포인트+암호유틸).
- **coach-finder(별도 레포):** `client/src/hooks/useCoachContractInfo.ts` · `lib/contractGen.ts` · `components/CoachContractInfoModal.tsx` · `api/`(신규 엔드포인트). → coach-finder 자체 브리프 필요.
- **공유 계약:** `coaches_directory`는 미변경. `coach_contract_info`만 변경.

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| 브라우저 클라이언트 암호화 | 클라에서 암복호 | 키가 클라 JS 노출 → 무의미(둘 다 anon키 직접접근) |
| JSON 한 덩어리 `_enc` 컬럼 1개 | 6필드 묶어 암호화 | 부분 복호/마스킹·부분 업데이트 불리 → 필드별 채택 |
| pgcrypto + Supabase Vault | DB 내 암복호, 키 Vault | 더 복잡, pgsodium TCE deprecated, RPC 복호 노출 위험. env 단순키로 충분(파기=행삭제 결정) |
| 키를 Supabase Vault | crypto-shredding 유리 | 파기=행삭제로 결정 → env 단일키로 단순화 |

## Migration / Rollout
**마이그레이션은 새 파일만.** 단계 = 브리프 분해:

| 브리프 | 내용 | Phase |
|------|------|------|
| **ENC1** | 마이그레이션: `_enc` 6컬럼 추가(nullable, 평문 유지) | 1 |
| **ENC2** | 서버 암호 유틸 + contract-info 엔드포인트 (coaching_log `api/`, 사용자 JWT로 RLS 유지) | 2 |
| **ENC3** | coaching_log `index.html` 읽기/쓰기 → 서버 엔드포인트 경유 + 마스킹 | 3·4 |
| **ENC4** | 백필 스크립트(평문→암호화) + 검증 | 5 |
| **ENC5** | 마이그레이션: 평문 6컬럼 + `business_number` CHECK 제거 | 6 |
| **(coach-finder 측)** | coach-finder 자체 레포에 동일 패턴 브리프(엔드포인트·client 전환) | 병행 |

> 백필(ENC4) 완료·검증 전까지 평문 컬럼 유지(dual-read). ENC5는 백필 검증 후에만.

## 검증 (Acceptance)
- [x] 사용자 명시 승인 (대상 6필드 · env키 · 정책§9 미수정 · 파기=행삭제)
- [ ] 글로서리: 신규 용어 없음(`*_enc` 컬럼명만 추가 — 글로서리 영향 확인)
- [ ] 영향 코드 식별 + 브리프 ENC1~ENC5 (+ coach-finder)
- [ ] CLAUDE.md "변경 금지 DB 테이블명"에 `coach_contract_info` 영향 — 컬럼 추가는 ADR로 허용

## 후속 작업
- coach-finder 레포 브리프(엔드포인트·client 전환·contractGen) 작성.
- (선택·나중) 정책 §9에 "결제·계좌 정보 암호화 저장" 반영 — 법무/대표이사 검토.

### 키 로테이션 절차 (무중단·무코드)
1. 새 키 생성 → `CONTRACT_ENC_KEYS`에 다음 버전 추가(예 `{"1":"...","2":"..."}`). **옛 키는 유지**(옛 데이터 복호용).
2. `CONTRACT_ENC_KEY_ACTIVE`를 새 버전으로 변경 → 양 앱 재배포. 이후 새 쓰기는 `v2:`.
3. (선택·완전 로테이션) ENC4 백필을 **재암호화 모드**로 돌려 `v1` 데이터를 `v2`로 갱신 → 끝나면 맵에서 `v1` 키 제거.
- 권장 주기: 정책/보안 기준에 맞춰(예: 연 1회 또는 유출 의심 시 즉시).
