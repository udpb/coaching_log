# 브리프 S1-20260610-security-hygiene — 보안 소소 4건 (1.5단계)

## 배경 (Why)
AUDIT-2026-06-10 §2 / HANDOFF 1.5단계. 모두 `public/index.html` 단일 파일.

## 작업 4건

### 1. `error.message` unescaped innerHTML 3곳
- 현재 위치: :7962, :8105, :8149 — `조회 실패: ${error.message}` 를 escHtml 없이 innerHTML 에 삽입.
- 수정: `${escHtml(error.message)}` 로. (Supabase 에러 메시지는 서버 데이터를 에코할 수 있어 sink 로 취급.)
- 같은 패턴이 더 있는지 `\${e(rror)?\.message}` 전수 grep 해서 innerHTML 경로면 모두 처리, textContent 경로는 그대로 두고 보고만.

### 2. `editRecord()`(:4981) / `deleteRecord()`(:5264) 진입 가드
- 현재 버튼만 `_canEditLog`(:10352) 로 가려져 있고 함수 진입점엔 권한 체크 없음. RLS 가 DB는 막지만 `deleteRecord` 가 로컬 `logs` 배열을 먼저 변형해 화면-DB 불일치 가능.
- 수정: 두 함수 도입부에 동일 판정 추가 —
  `const rec = logs.find(r => String(r.id) === String(id)); if (!rec) return;`
  `const own = currentUser && String(rec.coach_id) === String(currentUser.id);`
  `if (!own && currentUserRole !== 'admin') { showToast('본인 기록 또는 관리자만 가능합니다.'); return; }`
- 기존 :10348-10350 주석의 정책(본인 또는 admin)과 정확히 일치해야 함. deleteRecord 의 로컬 배열 변형은 가드 통과 후에만.

### 3. escape 함수 단일화 (동작 변경 없이)
- 현재 4중 정의: `escapeHtml`(:7995), `escapeHtml` 재정의(:8371, shadowing), `_esc`(:8893), `escHtml`/`escAttr`(:10370/:10375).
- **호출부 일괄 치환은 하지 말 것** (회귀 위험). 대신:
  a. 세 구현(escapeHtml×2, _esc)의 동작이 escHtml 과 다른 점이 있는지 비교(이스케이프 대상 문자 집합·null 처리)해 표로 보고.
  b. 동작이 동일·부분집합이면: 중복 정의 본문을 `return escHtml(str)` 위임으로 교체하고, 각 정의 위에 "DEPRECATED — 신규 코드는 escHtml/escAttr 사용 (2026-06-10 단일화)" 주석. shadowing 되는 첫 escapeHtml(:7995) 은 삭제 가능하면 삭제 (둘 다 전역 function 선언이라 뒤가 이김 — 삭제해도 동작 불변임을 확인 후).
  c. 차이가 있으면(예: _esc 가 작은따옴표도 이스케이프) 위임하되 차이를 보존하는 방식으로 (escAttr 위임 등), 판단 근거 보고.
- AGENTS.md 에 "신규 escape 는 escHtml/escAttr" 한 줄 추가는 메인이 함 — 코드만.

### 4. i18n 사전 부재 키 전수 점검
- HTML 의 모든 `data-i18n`·`data-i18n-ph` 키를 추출해 i18n 사전(ko/en/ja)과 대조하는 node 스크립트를 직접 작성·실행.
- 누락 키 전부에 대해: ko = 해당 요소의 기존 한국어 텍스트, en/ja = 자연 번역으로 사전에 추가 (이전 12키 보강과 동일 방식·동일 위치 클러스터).
- 추출 결과(전체 키 수 / 누락 키 목록)를 보고에 첨부.

## CAN touch
- `public/index.html` 만.

## MUST NOT
- 동작 변경 금지(가드 추가 제외) · DB/API 금지 · git 금지 · innerHTML 신규 삽입 시 escHtml.

## 검증
- 인라인 스크립트 node --check.
- 항목 1: 수정 후 `error.message` 전수 grep 결과 첨부 (unescaped innerHTML 0건 증명).
- 항목 2: 가드 코드 경로 — coach 가 타인 기록 id 로 호출 시 토스트+조기 리턴, admin·본인은 통과.
- 항목 3: 위임 후에도 기존 호출부가 받는 출력이 문자 단위 동일함을 대표 입력(`<>&"'` 포함)으로 node 실행 비교.
- 항목 4: 점검 스크립트 재실행 시 누락 0건.
- Return Format 5섹션.
