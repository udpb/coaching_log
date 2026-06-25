# Brief ENC3 — coaching_log 계약정보 읽기/쓰기 서버 경유 전환 + 마스킹

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `ENC3-index-html-route-via-server` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | ENC1, ENC2 |
| 우선순위 | P0 |

---

## 🎯 Mission
coaching_log `public/index.html`의 **`coach_contract_info` 브라우저 직접 접근(L8207·L8328 인근)** 을 **ENC2 서버 엔드포인트 호출로 교체**한다. 화면엔 **마스킹**, 계약서 생성 시에만 전체값.

## 📋 Context
ADR-024: 브라우저가 anon키로 평문 컬럼을 직접 읽으면 키 없이도 평문 노출. ENC2 엔드포인트가 암복호+RLS를 담당하므로, 클라는 **더 이상 평문 컬럼을 직접 읽지 않고** 서버를 호출해야 한다. 안 하면 평문 경로가 남아 암호화가 무력화.

## ✅ Prerequisites (STOP 조건)
- [ ] ENC1·ENC2 완료 — `/api/contract-info` GET/POST 동작(확인: 실호출)
- [ ] `index.html`에서 `coach_contract_info` 사용 위치 식별 (현재 L8207·L8328 — `.from('coach_contract_info')`. 실제 라인은 변동 가능, **검색으로 재확인**)

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`  3. `../../docs/glossary.md`
4. `../../docs/decisions/024-contract-info-encryption.md`
5. `../.claude/agent-briefs/ENC2-server-crypto-endpoint.md` (엔드포인트 계약: GET `?coachId&reveal`, POST body)
6. `../../public/index.html` — `coach_contract_info` 검색해 읽기/쓰기/계약서생성 함수 전부 식별

## 🎯 Scope
### CAN touch
- `public/index.html` — `coach_contract_info` 직접접근 함수(읽기·UPSERT)와 그 호출부, 계약 정보 모달/뷰 렌더
### MUST NOT touch
- `api/*` (ENC2에서 완료) · 마이그레이션 · 다른 뷰/전역 무관 코드 · RLS

## 🛠 Tasks (번호)
1. `index.html`에서 `coach_contract_info` **직접 SELECT** → `GET /api/contract-info?coachId=...`(Authorization: 현재 세션 access token) 호출로 교체. 응답은 **마스킹된 값**.
2. **UPSERT(쓰기)** → `POST /api/contract-info`(평문 body + Authorization)로 교체. 직접 `.from(...).upsert()` 제거.
3. **계약서 생성** 경로에서 전체값 필요 시 → `GET ...&reveal=1` 호출(인가는 RLS가 처리).
4. 화면 렌더: 계좌/주소/사업자번호 등 값 출력은 **`escHtml()`(텍스트)·`escAttr()`(속성)** 의무. 마스킹된 문자열도 동일.
5. 로딩/에러 처리: 401/403/네트워크 에러 사용자 메시지(에러도 sink 취급, escape).

## 🔒 Tech Constraints
- 바닐라 JS · 빌드 없음. `escHtml`/`escAttr` 의무(~87 innerHTML sink 중 하나라도 빠지면 stored XSS).
- service-role 키 클라 금지(여전히 anon키 + 세션토큰만). 키(CONTRACT_ENC_KEY) 클라 절대 금지.
- 새 전역변수 신중. CDN/외부 의존성 추가 금지.
- 평문 컬럼 직접 읽기/쓰기 **완전 제거**(검색으로 잔존 없음 확인).

## ✔️ Definition of Done
- [ ] `index.html`에 `.from('coach_contract_info')` **잔존 0** (grep 확인).
- [ ] 브라우저 동작: 계약정보 뷰 로드=마스킹 표시, 저장=POST 반영, 계약서 생성=전체값으로 정상 생성. 콘솔 에러 0.
- [ ] 권한: 비인가 코치 계정에서 타 코치 정보 접근 차단(서버 RLS) — UI에서 확인.
- [ ] escHtml/escAttr 적용(렌더 값 전부).
- [ ] `git diff --name-only` = `public/index.html` 뿐.

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (브라우저 동작 + 콘솔 + 권한 — 구체)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- 평문 컬럼 직접 접근 남기기 · `escHtml` 없이 값 innerHTML · service-role/키 클라 노출
- `api/`·마이그레이션 수정 · 백필(ENC4) · 새 외부 스크립트 · `--no-verify`

## 💡 Hints & Edge Cases
- 현재 access token 얻는 법은 기존 supabase 클라 사용처(세션) 참고.
- 계약서 생성 시 `reveal=1`은 **최소 범위**로(생성 직전에만 호출, 메모리에 오래 두지 않기).
- 마스킹 값은 편집 폼 초기값으로 부적합 — 편집 모드 진입 시 정책 결정(빈칸 재입력 vs reveal). **결정사항으로 보고.**

## 🏁 Final Note
편집 폼의 마스킹/reveal UX는 결정 필요 사항 → "결정한 것/위험 신호"로 보고. 임의 확정 금지.
