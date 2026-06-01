# Brief CLEAN-DDL — 위험한 死 DDL 함수 제거 (coaching-log)

> 자급자족 브리프. 본 파일 + CLAUDE.md + AGENTS.md + glossary.md 외 컨텍스트 불필요.

| 메타 | 값 |
|------|----|
| ID | `CLEAN-DDL-getcreatetablesql` · 우선순위 P1 · 브랜치 `feat/cleanup-dead-ddl` |

---

## 🎯 Mission
`public/index.html` 의 死 함수 `getCreateTableSQL()`(약 5159-5197)와 그 유일 호출 `console.log(getCreateTableSQL())`(약 5149)를 제거한다. 이 함수는 실 RLS 와 **정반대인** `CREATE POLICY "Allow all access" USING(true)` DDL 문자열을 반환해, 복붙 시 테이블을 전면 개방시킬 위험이 있다.

## 📋 Context
`docs/AUDIT-2026-06-01-verification.md` §4(P1): 死코드일 뿐 아니라 위험. 유일 호출처가 `console.log` 1줄(메인이 grep 재확인: 정의 1 + 호출 1).

## ✅ Prerequisites (STOP)
- [ ] `grep getCreateTableSQL public/index.html` 결과가 **정확히 2건**(정의 ~5159, 호출 ~5149)인지 직접 재확인. 다른 호출처가 있으면 STOP.

## 📖 Read First
1. CLAUDE.md · AGENTS.md · glossary.md
2. `docs/AUDIT-2026-06-01-verification.md` §4
3. `public/index.html` 의 5140~5200 구간(함수 본문 + 호출부 — 정확한 경계 파악)

## 🎯 Scope
### CAN touch
- `public/index.html` (해당 함수 정의 + 호출 1줄 제거만)
### MUST NOT touch
- 다른 함수/스크립트 · escHtml 등 헬퍼 · 변경 금지 항목 · 마이그레이션

## 🛠 Tasks
1. `getCreateTableSQL` 2건 위치 재확인(정확한 시작/끝 줄).
2. 함수 정의 블록 전체 제거 + 호출 `console.log(getCreateTableSQL());` 1줄 제거. 주변 정상 코드는 보존(앞뒤 함수/문장 깨지지 않게 경계 정확히).
3. 제거 후 `grep getCreateTableSQL public/index.html` → **0건** 확인.
4. (빌드 없음) 브라우저 로드 깨짐 방지를 위해 제거 경계 전후가 유효한 JS 인지 육안 확인(중괄호 짝·세미콜론).

## 🔒 Tech Constraints
- 본 레포는 빌드/tsc 없음 — 검증 = grep 0 + 제거 경계 JS 유효성 육안.
- 단일 `public/index.html` 12k줄 — escHtml 의무 등 다른 규칙 무관(삭제만).

## ✔️ Definition of Done
- [ ] `getCreateTableSQL` grep 0건
- [ ] 호출 1줄도 제거
- [ ] `git diff` 가 해당 함수+호출 제거만(인접 코드 무손상)
- [ ] 변경 금지·다른 코드 미터치

## 📤 Return Format
```
## ✅ 한 일  (제거 줄 범위 + 전후 코드가 유효한 근거)
## ❌ 못한 일 / 보류
## 🤔 결정한 것
## 🔬 검증  (grep 0 결과 + diff 요약)
## ⚠️ 위험 신호 / 다음 (없으면 "없음")
```

## 🚫 Do NOT
- 다른 死코드 추측 제거 · escHtml/렌더 함수 변경 · 파괴적 git · 인접 코드 손상

## 💡 Hint
- 함수가 template literal(백틱) DDL 을 반환하므로 끝 경계(닫는 백틱 + `}`)를 정확히. 제거 후 앞 함수의 `}` 와 다음 코드 사이가 깨지지 않게.

## 🏁 Final Note
부수 발견(예: 死 deps 잔재)은 "위험 신호"에만. 본 브리프는 getCreateTableSQL 만.
