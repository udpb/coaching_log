# Brief CD — 코치 디렉토리: 프로젝트 코치만 + 코치 클릭 시 담당 팀

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 필독.

| ID | `CD-project-coaches-and-teams` · 2026-06-25 · P1 |

## 🎯 Mission
① 코치 디렉토리 뷰에서 **현재 선택된 프로젝트에 배정된 코치만** 보이게(미선택/미지정 프로젝트면 전체). ② 코치 카드 **클릭 시 그 코치가 담당한 팀(학습자) 목록**을 모달로 표시.

## 📋 Context (Explore 매핑 — 신뢰)
- `renderCoachDirectory()` L10356~10370 (admin/pm 게이트) → `loadCoachDirectory()` → `renderCoachDirBody(host)`.
- `loadCoachDirectory()` L10320~10334: `coaches_directory` **전체** 로드 → 전역 `coachDirectory`. 프로젝트 필터 없음.
- `_coachDirFiltered()` L10373~10388: status/availability/tier/expertise/region/검색어만 필터(프로젝트 X).
- `renderCoachDirBody` L10426~10497 + `_coachDirGridHtml` L10410~10418: 카드 `class="cd-card cd-card-readonly" style="cursor:default;"` **onclick 없음**(읽기전용).
- 전역 `currentProject` (L4397): `projects` 행 `{id,name,...}` 또는 `ORPHAN_PROJECT{__virtual:true}`(L4398) 또는 null. `setCurrentProject`/`enterProject`(L6425).
- **코치→프로젝트 데이터모델**: `business_plans(project_id)` ↔ `business_plan_coaches(business_plan_id, coach_directory_id, status)`. 배정 = status `'accepted'`. (마이그레이션 20260428_phase5b_business_plans.sql)
- **"팀"은 테이블 없음** = `coaching_logs.team_name` 문자열. 코치는 로그의 **이름 문자열 `r.coach`** 로 매칭(로그에 coach_directory_id 없음). 프로젝트 스코프 = `r.project_id === currentProject.id` (참고 `filterLogsByCurrentProject` L6209).

## 🎯 Scope
### CAN touch
- `public/index.html` — 코치 디렉토리 관련: `renderCoachDirectory`/`renderCoachDirBody`/`_coachDirFiltered`/`_coachDirGridHtml` + 신규 함수(배정 코치 id 로드, 코치 카드 클릭 핸들러, 팀 모달) + 신규 모달 마크업/CSS.
### MUST NOT touch
- `loadCoachDirectory` 의 기본 전체 로드(전역 `coachDirectory`는 그대로 — 필터는 표시단에서) · `renderTeams`/`showDetail`/`downloadXlsx`/쿼리(coaching_logs)·마이그레이션·api·다른 뷰. 코치 쓰기(등록/수정) 도입 금지(읽기 전용 유지).

## 🛠 Tasks
### #1 프로젝트 코치만
1. 신규 `async function loadProjectCoachIds()`: 현재 프로젝트의 배정 코치 id Set 반환.
   - `currentProject` 없음/`__virtual` → `null` 반환(=필터 안 함, 전체).
   - 아니면: `business_plans` where `project_id=currentProject.id` → id들 → `business_plan_coaches` where `business_plan_id in (...)` and `status='accepted'` → `coach_directory_id` Set.
   - 결과를 모듈 변수(예: `projectCoachIds`)에 캐시. (RLS상 admin/pm 읽기 가능 — 디렉토리가 admin/pm 전용)
2. `renderCoachDirectory()`에서 body 렌더 전에 `await loadProjectCoachIds()` 호출(프로젝트 바뀌었을 때 갱신).
3. `_coachDirFiltered()`(또는 렌더): `projectCoachIds`가 non-null이면 **`coach.id ∈ projectCoachIds`** 인 코치만. 헤더 카피도 "이 프로젝트 코치 N명"으로(전체일 땐 기존 "코치풀 N명").
4. 프로젝트는 선택했는데 배정 코치 0명 → "이 프로젝트에 배정된 코치가 없습니다" 안내.

### #2 코치 클릭 → 담당 팀 모달
5. 코치 카드를 **클릭 가능**하게: `cd-card-readonly`/cursor 제거 또는 클릭용 클래스 추가 + `onclick="showCoachTeams('${escAttr(coach.name)}')"` (이름 문자열로 매칭). hover/cursor pointer.
6. `function showCoachTeams(coachName)`: `logs`에서 `r.coach === coachName` (+ 프로젝트 선택 시 `r.project_id === currentProject.id`) 필터 → distinct `team_name` 별 세션 수 집계 → **모달**로 목록 표시(`팀명 — N 세션`). 0건이면 "담당 팀 기록이 없습니다". (기존 모달 패턴/스타일 재사용, 신규면 간단히.)
7. 모달 닫기 동작 포함.

## 🔒 Constraints (중요)
- 바닐라 JS · innerHTML. **모든 동적 값 escape**: 텍스트 `escHtml()` · 속성 `escAttr()`. `showCoachTeams('${escAttr(coach.name)}')`, 모달의 team_name/coachName 전부 escHtml. (coach.name·team_name 자유입력 → XSS 위험.)
- 새 전역 최소화(`projectCoachIds` 정도). service-role/anon 규칙 불변. RLS 경계 신뢰.
- coaching_logs 쿼리 신규 추가 금지 — 이미 로드된 전역 `logs` 사용(#2는 클라 필터).

## ✔️ DoD
- [ ] 프로젝트 선택 상태로 코치 디렉토리 → 그 프로젝트 배정 코치만(0명이면 안내). 프로젝트 미선택/미지정 → 전체.
- [ ] 코치 카드 클릭 → 모달에 그 코치 담당 팀 목록(세션 수). 0건 안내.
- [ ] 인라인 `<script>` `node --check` 통과. 동적 값 escHtml/escAttr 적용(목록 제시). 변경 = 코치 디렉토리 영역+모달로 한정.

## 📤 Report (5섹션): 한 일(파일:라인)/못한 일/결정/검증(node --check + escape + 동작)/위험

## 🚫 Do NOT
- 코치 쓰기 도입 · renderTeams/showDetail/xlsx 터치 · coaching_logs 신규 쿼리 · escape 누락 · `--no-verify`.

## 💡 Hints & Edge
- 코치 이름 매칭은 자유입력이라 정확 일치만 잡힘(표기 다르면 누락) — 정상. 보고에 한 줄 명시.
- `business_plan_coaches` 조회는 `.in('business_plan_id', bpIds)` 사용(bpIds 빈 배열이면 빈 Set, 빈배열 `.in()` 주의 — 빈 배열이면 쿼리 스킵하고 빈 Set).
- 모달이 처음이면 기존 모달(예: projManageModal) 마크업 구조/오버레이 CSS 참고.
