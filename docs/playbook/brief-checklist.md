# 브리프 작성 체크리스트 (12항목) — coaching-log

> 메인 세션이 서브 에이전트용 브리프를 작성할 때의 체크리스트.
> 템플릿: [`../../.claude/agent-briefs/_template.md`](../../.claude/agent-briefs/_template.md).

---

## 왜 12항목인가

자급자족 브리프 = 에이전트가 메인 컨텍스트 없이도 정확히 작업 가능해야 함. 빠지면 over/under-delivery · 헛수고 · revert · "어쨌든 됐어요".

---

## 12항목

1. **🎯 Mission** — 한 문장 · 능동형 · 측정 가능.
2. **📋 Context** — 왜 (출처: AUDIT § / ADR-N / INTEGRATED_ARCHITECTURE Gap-N) · 안 하면 무슨 일.
3. **✅ Prerequisites (STOP 조건)** — 선행 브리프 / 마이그레이션 적용 여부 / 파일 존재 + **확인 방법**.
4. **📖 Read These Files First** — 순서. CLAUDE/AGENTS/glossary default + 도메인 + 수정 대상.
5. **🎯 Scope** — CAN touch (구체 파일 · 특히 `public/index.html` 의 어느 함수/뷰인지 라인 범위 명시) / MUST NOT touch (적용된 마이그레이션 · 다른 뷰).
6. **🛠 Tasks** — 번호 · 각 step 후 상태 · 중간 검증.
7. **🔒 Tech Constraints** — 바닐라 JS · `escHtml`/`escAttr` 의무 · 새 마이그레이션 파일만 · service-role 클라 금지.
8. **✔️ Definition of Done** — Mission 1:1 · 검증 방식(엔드포인트/SQL/브라우저) · 글로서리 정합 · yes/no.
9. **📤 Return Format** — 5섹션 + 특화. 코드 변경 "파일:라인". 검증은 구체 결과.
10. **🚫 Do NOT** — 함정 사전 차단.
11. **💡 Hints & Edge Cases** — 비슷한 함수 위치(모방용) · 전역 변수 주의.
12. **🏁 Final Note** — 부수 발견은 "위험 신호" 로만. 임의 추가 금지.

---

## 자가 검증 (호출 직전 5분)

- [ ] 모르는 에이전트가 이 파일 + CLAUDE + AGENTS + glossary 로 작업 가능?
- [ ] Mission 한 문장 측정 가능?
- [ ] `index.html` 작업이면 **어느 함수/뷰/라인 범위** 콕 집었나?
- [ ] DoD 가 yes/no?
- [ ] Return Format 으로 메인이 5분 내 검증 가능?

통과 못하면 보류 후 보강.

---

## 자주 하는 실수

1. Mission 너무 큼 (특히 "index.html 개선" — 함수 단위로 쪼개라).
2. Context 너무 짧음.
3. Prerequisites 추상 (어떤 마이그레이션이 적용돼야 하는지 정확히).
4. CAN touch 가 "public/index.html" 전체 → 함수/라인 범위로 좁혀라.
5. DoD = Tasks 복붙.
6. 글로서리에 없는 용어 슬쩍.
