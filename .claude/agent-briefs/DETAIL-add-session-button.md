# Brief — 세션 상세에 "새 세션 추가" 버튼

> 자급자족 브리프. `../../AGENTS.md` 필독.

| ID | `DETAIL-add-session-button` · 2026-06-25 · P1 · 의존: 같은 파일 작업과 순차 |

## 🎯 Mission
세션 상세(`detail`) 화면에 **"+ 새 세션" 버튼**을 추가. 누르면 **현재 보는 세션과 같은 팀(학습자)·프로젝트로 새 세션 작성 폼**으로 이동(프로젝트로 나갔다 들어올 필요 없게).

## 📋 Context (확인됨)
- 상세 뷰 툴바에 "← 뒤로" 버튼 존재: `onclick="goBackFromDetail()"` (detail 뷰 마크업, grep `goBackFromDetail`). 그 옆에 새 버튼 추가.
- 현재 상세 레코드 id = 전역 `currentDetailId`. 레코드 = `logs.find(r => String(r.id) === String(currentDetailId))`.
- **`selectTeam(teamName)`** (L6530): `currentTeam=teamName` → `previousSession`=그 팀 마지막 세션 → `prepareForm(false)` → `switchView('form')`. = "그 팀 새 세션 폼" 진입점.
- **폼 게이트**: `switchView('form')`는 `currentProject`가 없거나 `__virtual`이면 "먼저 프로젝트를 선택" 토스트 후 teams로 튕김. → 새 세션은 레코드의 프로젝트 컨텍스트가 필요.
- `setCurrentProject(p)` (L4868): `currentProject=p` + 저장(뷰 변경 없음). 전역 `myProjects`에서 프로젝트 조회 가능(`enterProject`가 사용).

## 🎯 Scope
### CAN touch
- `public/index.html` — detail 뷰 툴바에 버튼 1개 추가 + 신규 헬퍼 `addSessionFromDetail()` + (필요시) 버튼 CSS.
### MUST NOT touch
- `selectTeam`/`setCurrentProject`/`prepareForm`/`switchView`/`showDetail` 본체 · `downloadXlsx` · 다른 뷰 · 쿼리 · 마이그레이션.

## 🛠 Tasks
1. 헬퍼 추가:
   ```js
   function addSessionFromDetail() {
     const record = logs.find(r => String(r.id) === String(currentDetailId));
     if (!record) return;
     // 폼 게이트 통과 + 새 세션이 올바른 프로젝트에 들어가도록 프로젝트 컨텍스트 맞춤
     if (record.project_id && (!currentProject || currentProject.id !== record.project_id)) {
       const p = (typeof myProjects !== 'undefined' ? myProjects : []).find(x => x.id === record.project_id);
       if (p) setCurrentProject(p);
     }
     selectTeam(record.team_name);  // 같은 팀 새 세션 폼으로
   }
   ```
2. detail 뷰 "← 뒤로" 버튼 옆에 버튼 추가:
   `<button class="btn btn-primary" onclick="addSessionFromDetail()" title="이 팀(학습자)의 새 세션 기록">+ 새 세션</button>`
   - 기존 버튼 컨테이너/정렬에 자연스럽게(우측 또는 뒤로 옆). 라벨 한글 "새 세션" 고정 OK(UI 카피, 가변).

## 🔒 Constraints
- 바닐라 JS. 버튼 라벨은 정적이라 escape 무관. `record.team_name`은 `selectTeam`에 인자로 전달(문자열) — innerHTML 삽입 아님. 새 전역 금지(헬퍼 1개·버튼만).
- `selectTeam`/`setCurrentProject` 재사용(수정 금지).

## ✔️ DoD
- [ ] 상세 화면에 "+ 새 세션" 버튼 보임. 클릭 → 같은 팀 새 세션 작성 폼(이전 세션 자동참조)·게이트 안 튕김.
- [ ] 다른 프로젝트 세션(list/dashboard 경유)에서 진입한 상세에서도 프로젝트 컨텍스트가 레코드 기준으로 맞춰져 폼 진입.
- [ ] 인라인 `<script>` `node --check` 통과. 변경 = 헬퍼 + 버튼(+CSS) 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check + 동작 추론)/위험

## 🚫 Do NOT
- selectTeam/switchView/showDetail 로직 변경 · 다른 함수 터치 · `--no-verify`.

## 💡 Hints
- `myProjects` 미정의/레코드 프로젝트 미발견 시: `setCurrentProject` 호출 스킵 → 기존 `currentProject` 그대로 → 그게 올바른 프로젝트면 정상, 아니면 게이트가 안전하게 처리.
- 버튼은 detail 뷰의 정적 마크업(goBackFromDetail 버튼과 동일 컨테이너)에 둠 — `showDetail`이 매번 #detailContent만 다시 그리므로 정적 툴바 버튼은 유지됨.
