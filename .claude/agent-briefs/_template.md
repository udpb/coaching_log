# Brief <ID> — <한 줄 제목>

> **자급자족 브리프.** 서브 에이전트는 본 파일 + `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 외 컨텍스트 없이도 작업 가능해야 함.

| 메타 | 값 |
|------|----|
| ID | `<ID>` (예: `SEC1-extract-session-auth`) |
| Owner | 메인 세션 |
| 작성일 | YYYY-MM-DD |
| 상태 | 🟡 / ✅ / 🔴 / 📦 |
| 의존 브리프 | |
| 우선순위 | P0 / P1 / P2 |

---

## 🎯 Mission
한 문장 · 측정 가능.

## 📋 Context
왜 (출처: AUDIT § / ADR-N / INTEGRATED_ARCHITECTURE Gap-N). 안 하면 무슨 일.

## ✅ Prerequisites (STOP 조건)
- [ ] 선행 브리프 `<id>` 완료 (확인: `<방법>`)
- [ ] 마이그레이션 `<file>` 적용됨 (확인: `<방법>`)
- [ ] 파일 `<path>` 존재

## 📖 Read These Files First (순서)
1. `../../CLAUDE.md`  2. `../../AGENTS.md`  3. `../../docs/glossary.md`
4. (도메인) `../../docs/AUDIT-2026-06-01.md` § · `<INTEGRATED_ARCHITECTURE / ADR>`
5. (코드) `<수정 대상 — index.html 이면 함수/라인 범위>`

## 🎯 Scope
### CAN touch
- `<구체 파일 · index.html 이면 어느 함수/뷰/라인>`
### MUST NOT touch
- 적용된 `supabase/migrations/*.sql` · `coaches_directory` 계약 · 다른 뷰

## 🛠 Tasks (번호)
1. `<...>`  2. `<...>`

## 🔒 Tech Constraints
- 바닐라 JS · `escHtml`/`escAttr` 의무 · 새 마이그레이션 파일만 · service-role 클라 금지
- `<브리프별>`

## ✔️ Definition of Done
- [ ] Mission 달성
- [ ] 검증: 엔드포인트 호출 / SQL `-- 검증` / 브라우저 동작 + 콘솔 0 / RLS 매트릭스 (해당 것)
- [ ] 신규 용어 없음 (또는 글로서리 갱신)
- [ ] 변경 금지 미터치 · `git diff --name-only` ⊆ `CAN touch`

## 📤 Return Format
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (엔드포인트/SQL/브라우저 — 구체 결과)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- 적용된 마이그레이션 수정 · 변경 금지 항목 변경 · service-role 클라 노출
- `escHtml` 없이 사용자 입력 `innerHTML` · 새 외부 의존성 임의 설치 · `--no-verify`

## 💡 Hints & Edge Cases
- (비슷한 함수 위치 · 전역 변수 주의 · 특수 데이터 상태)

## 🏁 Final Note
(부수 발견은 "위험 신호" 로만. 임의 추가 금지.)
