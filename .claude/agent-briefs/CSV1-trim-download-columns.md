# Brief CSV1 — 헤더 CSV 다운로드 컬럼 정리 (내부/메타/원본 제외)

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `CSV1-trim-download-columns` |
| Owner | 메인 세션 |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 의존 브리프 | 없음 |
| 우선순위 | P2 |

---

## 🎯 Mission
헤더 CSV 다운로드(`downloadCsv()`)가 **내부/메타/원본/저사용 컬럼을 제외**하고 사람이 읽을 코칭 내용 컬럼만 내보내도록 한다. (동작·escape·파일명 그대로, **제외 목록만 추가**)

## 📋 Context
현재 `downloadCsv()`(public/index.html L5322)는 `logs`의 모든 키를 덤프(`excludeKeys`=`['metrics']`만 제외). `logs`는 `loadLogs()`의 `coaching_logs` `SELECT *`(39컬럼)+`metric_*` 펼침. 그래서 원본 STT 전문(`transcript_raw` 1.8만자)·AI 추출 메타·내부 ID가 다 섞여 CSV가 지저분·거대함. 사용자 결정: 아래 13개 컬럼 제외.

## ✅ Prerequisites (STOP 조건)
- [ ] `public/index.html`에 `function downloadCsv()` 존재(현재 ~L5322), 내부에 `const excludeKeys = new Set(['metrics']);` 라인 존재

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`  3. `../../docs/glossary.md`
4. `../../public/index.html` — `downloadCsv` 검색(현재 L5322~5356), `loadLogs`(L4885~)도 참고(데이터 출처)

## 🎯 Scope
### CAN touch
- `public/index.html` — **`downloadCsv()` 함수의 `excludeKeys` 정의만**
### MUST NOT touch
- `loadLogs()`/쿼리(데이터 적재는 그대로) · 다른 함수 · CSV escape/BOM/파일명 로직 · 마이그레이션 · api

## 🛠 Tasks (번호)
1. `downloadCsv()`의 `const excludeKeys = new Set(['metrics']);` 를 **아래 14개로 확장**:
   ```
   'metrics',
   'id', 'created_at', 'coach_id', 'project_id', 'ai_extracted',
   'transcript_raw', 'extraction_evidence', 'extraction_model', 'extraction_version',
   'last_number', 'last_done_numerator', 'last_done_denominator', 'last_done_rate'
   ```
2. 나머지 로직(allKeys 수집·csvEscape·BOM·`coaching_logs.csv` 파일명·blob 다운로드)은 **그대로**. (excludeKeys가 자동으로 헤더·행에서 제외함)
3. 짧은 주석으로 "내부/메타/원본·저사용 지표 제외 (CSV1, 2026-06-25)" 표기.

## 🔒 Tech Constraints
- 바닐라 JS · 빌드 없음. 새 전역/의존성 금지. `escHtml`/`escAttr`는 본 변경과 무관(CSV는 innerHTML sink 아님).
- 제외는 **`excludeKeys` Set 한 곳**에서만. 다른 곳 하드코딩 금지.

## ✔️ Definition of Done
- [ ] `excludeKeys`에 위 14개 포함(grep 확인).
- [ ] 인라인 `<script>` 추출 → `node --check` 통과(문법 0).
- [ ] (설명) 제외 13개가 헤더/행에서 빠지고, 코칭 내용 컬럼 + `metric_*`만 남음을 코드로 확인.
- [ ] `git diff --name-only` = `public/index.html` 뿐. 변경은 downloadCsv 내부로 한정.

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (excludeKeys grep + node --check)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- 쿼리/`loadLogs` 변경 · 코칭 내용 컬럼 제외 · 파일명/escape/BOM 변경 · 다른 함수 터치 · `--no-verify`

## 💡 Hints & Edge Cases
- `metrics`는 이미 펼쳐져 `metric_*`로 남으므로 제외 유지(원본 jsonb는 빼고 펼친 것만 남김).
- `last_commitment`·`last_done`·`last_result`는 **남김**(사람이 읽는 커밋먼트 내용). 빼는 건 숫자 분해 지표 4개만.

## 🏁 Final Note
부수 발견(한글 헤더·컬럼 순서 등 추가 개선 여지)은 "위험 신호"로만 보고. 본 브리프는 제외 목록만.
