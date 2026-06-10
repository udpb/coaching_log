# 브리프 Q1-20260610-draft-autosave — 작성 중 일지 초안 자동저장 (localStorage)

## 배경 (Why)
AUDIT-2026-06-10 §2 P0: draft 자동저장이 없어 transcript 붙여넣기 → AI 추출 → 검토 중 새로고침/탭 닫힘이 나면 **전부 유실**된다. localStorage 캐시(`ud-coaching-logs`, ~5064)는 *저장된* 기록만 담는다. 코치 신뢰를 한 번에 깎는 유형의 결함.

## 목표
폼 작성 중 상태(폼 필드 + STT transcript + 선택형 버튼 상태 + 메트릭)를 localStorage 에 자동 저장하고, 폼 재진입 시 **배너로 복원 제안** (자동 복원 아님).

## 스펙
### 1. 저장
- 키: `ud-coaching-draft-v1`. 값: `{ savedAt(ISO), editingId(수정 모드면 record id, 신규면 null), projectId, teamName, fields(gatherFormData() 결과 전체), sttTranscript, metrics(currentMetrics 스냅샷) }`.
- 트리거: 폼 뷰의 input/textarea `input` 이벤트 + 선택형 버튼 클릭 + STT textarea 입력 → **debounce 1초** 단일 타이머. `applyExtractedFields` 완료 후에도 1회 저장 (AI 초안이 가장 비싼 데이터).
- 직렬화는 `gatherFormData()`(~6415) 재사용 — 필드 목록을 새로 하드코딩하지 말 것.
- 용량 방어: JSON 200KB 초과 시 transcript 를 잘라서 저장하고 플래그 기록.

### 2. 복원
- `prepareForm()`(~6102) 진입 시 draft 존재 + (editingId 일치 또는 둘 다 신규) + 24시간 이내면 폼 상단에 배너 표시: "작성 중이던 초안이 있습니다 (HH:MM 저장) [복원] [삭제]".
- **자동 복원 금지** — 코치가 [복원] 클릭 시에만 적용.
- 복원 적용: 기존에 수정 모드(editRecord)가 record → 폼을 채우는 경로가 있을 것 — **그 채움 로직을 찾아 재사용**해라 (선택형 버튼 그룹: session_type/stage/doneSelector/blockerSelector/energy 는 전역 상태 + active 클래스 동기화가 필요하므로 직접 DOM 조작을 새로 짜지 말 것). 메트릭 그리드·STT textarea 도 복원.
- 배너 텍스트는 정적 — 시간 외 사용자 데이터 표시 시 `escHtml()`.

### 3. 정리
- `submitRecord()`(~4930) 저장 성공 시(온라인·오프라인 폴백 포함) draft 삭제.
- [삭제] 클릭 시 draft 삭제 + 배너 제거.
- 다른 팀/프로젝트 컨텍스트의 draft 면: 배너에 "(다른 팀: X)" 표기하되 복원은 허용 (코치 판단).

## CAN touch
- `public/index.html` 만.

## MUST NOT
- DB 스키마·API 변경 금지. 전역 변수 추가 최소화(draft 타이머 1개 수준). innerHTML 삽입 시 escHtml/escAttr.
- git 명령 금지 — 메인이 처리.

## 검증
- `node --check` (인라인 스크립트 추출) 통과.
- 코드 경로 추적 보고: (a) 입력→1초 후 localStorage 기록 (b) 새로고침→폼 재진입→배너→복원 시 필드·버튼·메트릭·transcript 전부 회복 (c) 저장 성공→draft 소멸 (d) AI 추출 직후 draft 에 추출 결과 포함.
- Return Format 5섹션 (AGENTS.md).

## 주의
- 라우팅 수정(2026-06-10)으로 라인 번호가 기존 문서 대비 ~+80 어긋날 수 있음 — 실제 코드 기준으로 작업.
