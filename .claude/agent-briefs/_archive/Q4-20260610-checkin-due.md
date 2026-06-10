# 브리프 Q4-20260610-checkin-due — "오늘 체크인할 팀" 뷰 (next_checkin_date 활용)

## 배경 (Why)
AUDIT-2026-06-10 §2: `next_checkin_date`(date)·`next_checkin_channel` 을 추출·저장까지 하면서 소비처가 0. 이 데이터만으로 "약속→이행" 루프를 닫는 리마인더 뷰를 만들 수 있다 — 추가 데이터 수집 없이 제품 핵심 가설을 완성하는 가장 싼 기능.

## 목표
대시보드 상단에 "📌 체크인 예정" 카드 — 오늘이 체크인 날짜이거나 지난 팀 목록을 보여주고, 클릭 시 해당 세션 상세로 이동.

## 스펙
### 1. 판정 로직 (새 함수, 예: `computeDueCheckins()`)
- 대상: 현재 프로젝트 범위의 logs (`filterLogsByCurrentProject()` 재사용, ~5781).
- 팀별 **최신 세션 1건**만 본다 (date 기준 최신, 동일 date 면 session_num/id 큰 쪽).
- 그 세션의 `next_checkin_date` 가 존재하고 `<= 오늘` 이면 due.
  - 단, 그 날짜 **이후에 새 세션이 이미 기록**돼 있으면(=체크인이 사실상 이행됨) 제외 — "팀별 최신 세션" 기준이므로 자동 충족되지만, 최신 세션의 date 가 next_checkin_date 이후인 경우도 제외 조건에 포함해라.
- 반환: `[{ teamName, logId, checkinDate, channel, nextAction, daysOverdue }]`, checkinDate 오름차순.

### 2. UI
- 위치: `renderDashboard()`(~8035+) — 팀 선택 UI **위**, 프로젝트 선택된 상태에서만.
- 카드 리스트: 팀명 · 체크인 날짜(오늘이면 "오늘", 지났으면 "D+N") · 채널 아이콘/라벨(message/call/video/email/inperson/other → 한국어) · next_action 요약(60자 절단).
- 지난 항목은 경고색(기존 CSS 변수 활용), 오늘은 강조색.
- 클릭 → `showDetail(logId)` (라우팅이 #detail/<id> 처리 — 2026-06-10 수정 반영됨).
- due 0건이면 섹션 자체를 렌더하지 않는다 (빈 카드 금지).
- **모든 동적 텍스트(팀명·next_action·채널)는 `escHtml()`/`escAttr()` 필수.**

### 3. 데이터 주의
- `next_checkin_date` 는 date 컬럼이지만 과거 행은 null 이 많다 — null 안전.
- 날짜 비교는 로컬 타임존 기준 `YYYY-MM-DD` 문자열 비교로 단순하게 (기존 코드의 날짜 처리 패턴 따름).

## CAN touch
- `public/index.html` 만 (renderDashboard 주변 + 새 함수 + CSS 약간).

## MUST NOT
- DB·API 변경 금지. 다른 뷰 변경 금지. git 금지.

## 검증
- `node --check`.
- 코드 경로 보고: due 판정 경계 3케이스(오늘 / D+3 / 다음 세션이 이미 기록됨→제외)를 가상 데이터로 추적.
- Return Format 5섹션.
