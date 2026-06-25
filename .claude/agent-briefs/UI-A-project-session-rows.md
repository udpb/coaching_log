# Brief UI-A — 프로젝트 진입 시 "팀별 그룹 + 세션 행" 뷰

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 필독.

| 메타 | 값 |
|---|---|
| ID | `UI-A-project-session-rows` |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 우선순위 | P1 |
| 의존 | 없음 (단, UI-B·XLSX와 같은 파일 → 순차 실행. 본 브리프 먼저) |

## 🎯 Mission
프로젝트에 들어가면 지금은 **팀 카드 그리드**(`renderTeams`)가 뜬다. 이를 **"학습자(팀)별 그룹 + 그 아래 세션 행 목록"** 게시판 형태로 바꾼다. 세션 행 클릭 → 기존 `showDetail(id)` 상세로 이동.

## 📋 Context (Explore 매핑 결과 — 신뢰)
- 진입: `enterProject(id)` (~L6264) → **`renderTeams()` (L6107~6169)** 호출.
- `renderTeams`: 프로젝트 배너(L6120~6126) + **팀 카드 그리드**(L6134~6143, 카드당 `selectTeam('<team_name>')` onclick) + "+ 새 팀" 카드(L6148~6152).
- 데이터: `getTeamSummaries` (L6286~6313) = 팀별 요약(team_name·stage·session_count·last_session_date·coach). 팀 세션 목록은 `logs.filter(r=>r.team_name===teamName).sort(session_num)` 로 만든다 (참고: `selectTeam` L6320 동일 패턴).
- 클릭 후 상세: **`showDetail(id)` (L10709)** — 이미 존재, 그대로 재사용.
- 새 세션 작성 플로우(보존 필수): 팀 선택 → `selectTeam(teamName)` (L6318) → 폼. "+ 새 팀" → `selectNewTeam()` (L6330).
- 학습자 식별 = **`team_name`** (founder_name은 표시용).

## 🎯 Scope
### CAN touch
- `public/index.html` — **`renderTeams()` 함수 본문** (L6107~6169). 필요 시 그 안에서 호출할 **작은 헬퍼 1개**(예: 팀 그룹 HTML 빌더)를 `renderTeams` 바로 위/아래에 추가 가능.
- 관련 **CSS** (`<style>` 내 `.team-group`·`.session-row` 등 신규 클래스). 기존 클래스 변경 금지, 신규만.
### MUST NOT touch
- `getTeamSummaries`(읽기 재사용)·`selectTeam`·`selectNewTeam`·`showDetail`·`enterProject` 시그니처/동작 · `downloadCsv` · 쿼리/`loadLogs` · 마이그레이션 · api · 다른 함수.

## 🛠 Tasks
1. `renderTeams()`가 프로젝트 배너(유지) 아래에, **팀(학습자)별 그룹**을 렌더:
   - **그룹 헤더**(팀당 1개): `▼/▶ 토글` + `team_name` + stage 배지 + `(N 세션)` + 최근일 + (admin이면 coach 태그) + 우측 **`[+ 새 세션]` 버튼**(onclick=`selectTeam('<team_name>')`). 헤더 클릭 = 그룹 접기/펼치기(기본 펼침).
   - **세션 행**(그룹 내, 그 팀 세션을 `session_num` **내림차순**=최신 먼저): 각 행 = `날짜 · #세션번호 · stage · main_topic(말줄임) · next_action(말줄임)`. 행 전체 `onclick="showDetail('<id>')"` + hover 강조 + `cursor:pointer`.
   - 세션 0개인 팀: 헤더만 + "아직 세션 없음" 한 줄.
2. 그룹들 아래에 **"+ 새 팀"** 버튼 유지(onclick=`selectNewTeam()`).
3. 정렬: 그룹(팀)은 기존 `getTeamSummaries` 순서 유지. 행은 최신(session_num desc) 먼저.
4. 신규 CSS 클래스로 게시판 느낌(행 구분선·hover·헤더 강조). 디자인 톤은 기존 변수(`--gray*`·`--orange`·`--dark`) 사용.

## 🔒 Tech Constraints (중요)
- 바닐라 JS · 빌드 없음 · `innerHTML` 템플릿.
- **모든 사용자/코치 입력**(team_name·main_topic·next_action·coach·founder 등)은 **텍스트=`escHtml()` · 속성=`escAttr()`** 로 이스케이프. `onclick="showDetail('<id>')"`·`selectTeam('<team_name>')` 처럼 **속성 안 문자열은 `escAttr()`** (team_name에 따옴표 가능 → 반드시). id는 숫자지만 문자열화 시에도 escAttr.
- 새 전역 변수 최소화. 접기 상태는 지역 처리(예: 토글 시 DOM에서 class 토글)로 — 전역 상태 추가는 피하기.
- escape 한 곳이라도 빠지면 stored XSS (AGENTS.md). 점검 필수.

## ✔️ Definition of Done
- [ ] 프로젝트 진입 → 팀별 그룹 + 세션 행이 보인다(팀 카드 그리드 대체). 행 클릭 → 해당 세션 `showDetail`로 이동.
- [ ] `[+ 새 세션]`(팀별) → `selectTeam` 폼, `[+ 새 팀]` → `selectNewTeam` 폼 — **기존 작성 플로우 유지**.
- [ ] 그룹 접기/펼치기 동작.
- [ ] 인라인 `<script>` 추출 → `node --check` 통과. 모든 동적 값 escHtml/escAttr 적용(grep으로 team_name·main_topic 등 raw 삽입 0 확인).
- [ ] 변경 = `renderTeams`(+그 근처 헬퍼/CSS)로 한정. 다른 함수 미터치.

## 📤 Return Format (5섹션)
```
## ✅ 한 일 (파일:라인)
## ❌ 못한 일 / 보류
## 🤔 결정한 것 (ADR 후보)
## 🔬 검증 (node --check + escape 점검 + 동작 설명)
## ⚠️ 위험 신호 / 다음 세션이 알아야 할 것 (없으면 "없음")
```

## 🚫 Do NOT
- `showDetail`/`selectTeam` 동작 변경 · CSV/쿼리 터치 · 새 라이브러리 · escape 누락 · `--no-verify` · 적용된 마이그레이션 수정.

## 💡 Hints
- `showDetail`은 이미 클릭 후 상세를 그려주므로 행 onclick은 `showDetail('<id>')`만 호출하면 됨. (히스토리 보강은 별도 브리프 UI-B에서 `showDetail` 안에 추가 예정 — 본 브리프는 `showDetail` 미터치.)
- 팀 세션 목록 = `logs.filter(r => r.team_name === t.team_name).sort((a,b)=> (parseInt(b.session_num)||0)-(parseInt(a.session_num)||0))`.
- 기존 팀 카드 마크업(L6134~)을 참고해 배지/태그 스타일 재활용.
