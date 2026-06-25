# Brief FIX — 세션 상세 "뒤로" 버튼을 출처(origin) 뷰로

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` 필독.

| ID | `FIX-detail-back-origin` · 2026-06-25 · P1 |

## 🎯 Mission
세션 상세(`detail`)의 **"← 뒤로" 버튼이 항상 `목록(list)`으로** 가는 버그 수정. **들어온 출처 뷰**(프로젝트=teams / 목록=list / 대시보드=dashboard)로 돌아가게.

## 📋 Context (Explore 매핑 — 신뢰)
- detail 뷰 "뒤로" 버튼: **L3604** `<button ... onclick="switchView('list')" data-i18n="back">`. **하드코딩 `list`** 가 원인.
- `showDetail(id)` (~L10870): 끝에서 `switchView('detail')` 호출. 진입 직전 `currentView`는 출처(teams/list/dashboard). 하지만 어디에도 출처를 저장 안 함(`previousView` 변수 없음).
- `showDetail` 호출처: 세션 행(teams) L6246 · list L8269 · dashboard L9204/L9394 · 히스토리 표 L11014.
- `switchView()` L5483~ : 진입 시 `currentView = name` 으로 덮어씀(L5505 부근).

## 🎯 Scope
### CAN touch
- `public/index.html` — ① 전역 변수 1개(`detailReturnView`) 추가 ② `showDetail()` 진입부에서 출처 캡처 ③ detail "뒤로" 버튼(L3604) onclick 을 동적 라우팅으로 + 작은 헬퍼 `goBackFromDetail()` 1개.
### MUST NOT touch
- `switchView` 본체 로직 · 다른 뷰 · `renderTeams`/`renderList`/`showDetail`의 렌더 내용(진입부 캡처 1줄 외) · CSV/엑셀 · 쿼리 · 마이그레이션.

## 🛠 Tasks
1. 전역 `let detailReturnView = 'teams';` 추가(다른 전역 선언부 근처).
2. `showDetail(id)` **진입부**(switchView('detail') 호출 전, currentView 가 아직 출처인 시점)에서: `if (currentView && currentView !== 'detail') detailReturnView = currentView;` (teams/list/dashboard 중 출처 저장). 단 `VALID_VIEWS`(또는 teams/list/dashboard)만 허용, 그 외엔 'teams' 폴백.
3. 헬퍼 `function goBackFromDetail(){ switchView(detailReturnView || 'teams'); }`.
4. L3604 버튼 onclick `switchView('list')` → `goBackFromDetail()`.
5. (엣지) 새로고침으로 `#detail/<id>` 직접 진입 시 출처 모름 → 기본값 'teams'.

## 🔒 Constraints
- 바닐라 JS. escape 무관(정적 버튼/뷰명). 새 전역 1개만. `switchView` 시그니처/해시 라우팅 변경 금지.

## ✔️ DoD
- [ ] 프로젝트(teams) 세션 행 클릭 → 상세 → "뒤로" → **프로젝트로** 복귀. 목록(list)에서 진입 시 → "뒤로" → 목록. 대시보드 진입 시 → 대시보드.
- [ ] 인라인 `<script>` `node --check` 통과.
- [ ] 변경 = 전역 1 + showDetail 진입부 1~2줄 + 헬퍼 + 버튼 onclick 으로 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check)/위험

## 🚫 Do NOT
- switchView 로직·해시 라우팅·다른 뷰 변경 · `--no-verify`.

## 💡 Hints
- 브라우저 네이티브 back 은 이미 teams 로 감(해시 push 덕). 본 수정은 **화면 안 "← 뒤로" 버튼**이 출처를 따르게 하는 것.
- 히스토리 표(UI-B)에서 다른 세션으로 이동 시에도 출처는 최초 진입 뷰 유지가 자연스러움(현재 detail→detail 재진입은 currentView==='detail' 이라 캡처 스킵되어 자동 보존됨).
