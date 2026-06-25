# Brief CD2 — 코치 팀 모달: 팀 클릭 → 최근 세션 상세로 이동

> 자급자족 브리프. `../../AGENTS.md` 필독.

| ID | `CD2-team-row-to-latest-session` · 2026-06-25 · P2 · 의존: CD 완료 후 |

## 🎯 Mission
`showCoachTeams()` 모달의 **각 팀 행을 클릭하면 그 팀의 "가장 최근 세션" 상세(`showDetail`)로 이동**. 더불어 그 detail에서 "← 뒤로" 시 **코치 디렉토리로** 돌아오게(#3 출처 캡처에 'coaches' 추가).

## 📋 Context
- `showCoachTeams(coachName)` (~L10612~10642): `rows = logs.filter(r=>r.coach===coachName)` (+실프로젝트면 project_id 일치) → `counts[team_name]=세션수` → 모달에 `<div class="coach-team-row">팀명 — N 세션</div>` (현재 **클릭 불가**). `closeCoachTeamsModal()` 존재.
- `showDetail(id)` 진입부 출처 캡처(FIX-detail-back-origin): `if (currentView === 'teams' || currentView === 'list' || currentView === 'dashboard') detailReturnView = currentView;` (~L10884).
- "최근 세션" = 같은 team_name 세션 중 `session_num` 최대(동률 시 `date` 최신).

## 🎯 Scope
### CAN touch
- `public/index.html` — `showCoachTeams()` 내부(집계에 팀별 최근 세션 id 추가 + 행 onclick) + showDetail 출처 캡처 라인에 `'coaches'` 추가 + 관련 CSS(행 hover/cursor).
### MUST NOT touch
- 다른 함수·쿼리·마이그레이션·다른 뷰. 코치 매칭/프로젝트 스코프 로직(그대로).

## 🛠 Tasks
1. `showCoachTeams`: 팀별 집계를 **세션 수 + 최근 세션 id**로 확장:
   - 각 team_name 에 대해 count 와 함께, `session_num`(parseInt) 최대 → 동률 시 `date` 최신인 세션의 `id`를 추적(`latestId`).
2. 모달 행을 **클릭 가능**하게: `<div class="coach-team-row" onclick="closeCoachTeamsModal(); showDetail('${escAttr(String(latestId))}')" style="cursor:pointer" title="최근 세션 보기">…팀명 — N 세션 <span class="coach-team-go">최근 세션 →</span></div>`. hover 강조 CSS.
3. `showDetail` 출처 캡처에 `'coaches'` 추가 → `currentView==='coaches'`도 캡처(코치 디렉토리에서 진입한 detail은 "뒤로" 시 코치 디렉토리로). `goBackFromDetail`/`detailReturnView` 그대로 활용.
4. 0건(`entries.length===0`) 분기는 기존 유지(클릭 없음).

## 🔒 Constraints
- 바닐라 JS · innerHTML. **escape**: 행 onclick id `escAttr(String(latestId))`, 팀명 `escHtml(team)` (기존 유지). 정수 id지만 escAttr 일관 적용.
- 새 전역 금지. 새 쿼리 금지(전역 `logs`만).

## ✔️ DoD
- [ ] 코치 클릭 → 모달 → **팀 행 클릭 → 그 팀 최근(session_num 최대) 세션 상세로 이동**(모달 닫힘).
- [ ] 그 상세에서 "← 뒤로" → **코치 디렉토리(coaches)** 로 복귀.
- [ ] 인라인 `<script>` `node --check` 통과. escHtml/escAttr 적용. 변경 = showCoachTeams + 캡처 1단어 + CSS 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check + escape + 동작)/위험

## 🚫 Do NOT
- 다른 함수/쿼리 터치 · escape 누락 · `--no-verify`.

## 💡 Hints
- 최근 세션 추적: 행 누적 시 `if (!best || (parseInt(r.session_num)||0) > (parseInt(best.session_num)||0) || ((parseInt(r.session_num)||0)===(parseInt(best.session_num)||0) && String(r.date||'') > String(best.date||''))) best=r;` 식.
- `showDetail`은 어떤 뷰에서든 호출되면 해당 세션 상세를 그림 → 모달 닫고 호출이면 충분.
