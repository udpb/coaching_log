# Brief UI-B — 세션 상세에 "학습자 이전 세션 히스토리" (클릭 이동)

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 필독.

| 메타 | 값 |
|---|---|
| ID | `UI-B-session-history-in-detail` |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 우선순위 | P1 |
| 의존 | **UI-A 적용·검증 후 실행**(같은 파일 `index.html`). |

## 🎯 Mission
세션 상세(`showDetail`)에서, 그 **학습자(팀)의 이전 세션들을 히스토리로 보고 클릭해 이동**할 수 있게 한다. 지금은 상세 안에 그 팀의 전체 세션 "추세 표"가 있으나 **행이 클릭되지 않고** 히스토리로 느껴지지 않는다.

## 📋 Context (Explore 매핑 — 신뢰)
- **`showDetail(id)` (L10709~10883)** — 읽기전용 상세. 내부 끝부분에 **팀 추세 표**(L10810~10863): `teamLogs = logs.filter(r=>r.team_name===record.team_name).sort(session_num)` (L10811), 행 렌더 L10841~10856(#·날짜·stage·done·next_action·metrics·energy), 현재 보는 세션 행 강조(L10848). **행에 onclick 없음** → 형제 세션으로 이동 불가.
- 학습자 식별 = **`team_name`**. 세션 = `id`. `showDetail`은 id로 조회(L10710).
- UI-A가 이미 `renderTeams`를 세션 행 보드로 바꿔둠(별개 영역). 본 브리프는 **`showDetail`만** 손댄다.

## 🎯 Scope
### CAN touch
- `public/index.html` — **`showDetail()` 내 팀 추세 표 영역(L10810~10863)** + 그 표에 붙는 신규 CSS 클래스.
### MUST NOT touch
- `showDetail` 의 다른 부분(헤더·메타·내러티브·4카드) 동작 변경 금지(필요 최소 외) · `renderTeams`(UI-A 영역) · `selectTeam` · 쿼리/`loadLogs` · `downloadCsv` · api · 마이그레이션.

## 🛠 Tasks
1. 추세 표를 **"이전 세션 히스토리"** 로 명확히 라벨(제목/헤딩 추가). 같은 학습자의 세션 목록임을 드러냄(예: `📜 {team_name} 세션 히스토리 (N개)`).
2. **각 행을 클릭 가능**하게: 현재 보는 세션(record.id)이 아닌 행은 `onclick="showDetail('<sibling.id>')"` + hover 강조 + `cursor:pointer`. 현재 세션 행은 강조 유지 + "현재" 표시(클릭 비활성 또는 자기 자신 no-op).
3. 정렬은 **최신(session_num desc) 먼저** 권장(히스토리는 위에서 최신→과거). 기존이 asc면 desc로 바꿔도 됨(표 한정).
4. (선택, 간단하면) 각 행에 한 줄 요약감 추가: `main_topic` 또는 `last_commitment` 짧게. 표가 너무 넓어지면 생략.

## 🔒 Tech Constraints
- 바닐라 JS · innerHTML. **모든 동적 값 escape**: 텍스트 `escHtml()` · 속성 `escAttr()`. `onclick="showDetail('<id>')"` 의 id도 `escAttr()`. main_topic 등 텍스트는 escHtml.
- 신규 전역 변수 지양. CSS는 신규 클래스만.
- escape 누락 = stored XSS. 점검 필수.

## ✔️ Definition of Done
- [ ] 세션 상세 하단에 "이전 세션 히스토리" 표가 보이고, **다른 세션 행 클릭 → 그 세션 상세로 이동**(showDetail). 현재 세션은 강조 + 클릭 비활성/자기.
- [ ] 인라인 `<script>` `node --check` 통과. 동적 값 escHtml/escAttr 적용(목록 제시).
- [ ] 변경 = `showDetail` 추세 표 영역(+CSS)로 한정.

## 📤 Return Format (5섹션 — 한 일/못한 일/결정/검증/위험)

## 🚫 Do NOT
- `showDetail` 다른 영역·`renderTeams`·CSV·쿼리 터치 · 새 라이브러리 · escape 누락 · `--no-verify`.

## 💡 Hints
- 데이터(`teamLogs`)는 L10811에 이미 있으니 새 쿼리 불필요 — 렌더에 onclick만 추가 + 라벨/정렬.
- `showDetail`은 재진입 가능(다른 id로 호출하면 그 세션을 다시 그림) → 행 클릭에 `showDetail('<id>')`면 충분.
