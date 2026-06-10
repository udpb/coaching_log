# 브리프 B-20260610-routing-history — 브라우저 뒤로가기/탭별 URL 라우팅 수정

## 배경 (Why)
사용자 보고: "각 탭마다 URL 이 지정이 안 되어 있어서 뒤로가기를 누르면 사이트 자체가 나가버린다."

코드 실태 (public/index.html, 현재 9,330줄):
- `switchView(name, opts)` (라인 ~5178) 끝부분에서 해시를 동기화하는데, `opts.pushHistory === true` 일 때만 `pushState`, 아니면 `replaceState` (라인 ~5231-5239).
- **`pushHistory: true` 를 넘기는 호출자가 0곳** → 모든 네비게이션이 replaceState → 히스토리 엔트리가 안 쌓임 → 뒤로가기 = 사이트 이탈.
- `hashchange` 리스너 (라인 ~5279) 와 `restoreViewFromHash()` (라인 ~5258) 는 이미 존재하고 `suppressHashUpdate` 로 루프 방지도 돼 있음.
- `#detail` 뷰는 record id 를 해시에 안 넣어서 복원을 포기 (라인 ~5273 `if (target === 'detail') return false;`).

## 목표
1. **탭 전환이 히스토리에 쌓여서** 브라우저 뒤로/앞으로가 앱 내 뷰 이동으로 동작.
2. **세션 상세도 URL 로 표현** (`#detail/<id>`) — 새로고침/뒤로가기 시 해당 상세로 복원.

## 스펙
### 1. pushState 를 기본으로
- `switchView` 의 해시 동기화에서 기본을 `pushState` 로 변경. 단:
  - `opts.suppressHashUpdate` (hashchange 가 발원) → 현행대로 동기화 스킵.
  - `opts.replaceHistory === true` → `replaceState` (명시적 옵션으로 반전).
  - 앱 부트 시 첫 뷰 설정(checkAuth 후 초기 switchView, `restoreViewFromHash`)은 `replaceHistory: true` 로 — 초기 진입이 이중 엔트리를 만들지 않게.
  - 해시가 같으면 아무것도 안 함 (현행 가드 유지).
- switchView 도입부의 **강제 리다이렉트** (온보딩 게이트 → myinfo, 프로젝트 미선택 → teams)는 사용자가 의도한 네비게이션이 아니므로 `replaceState` 가 되도록 처리 (리다이렉트 분기에서 opts 에 replaceHistory 플래그를 세팅하는 방식 권장).

### 2. detail 뷰 URL 화
- `showDetail(...)` (라인 ~9851 부근에서 `switchView('detail')` 호출)이 현재 보고 있는 record id 를 알고 있을 것 — 해시를 `#detail/<record id>` 로 push.
- `viewFromLocationHash()` 확장: `detail/<id>` 패턴 파싱 → `{ view: 'detail', id }` 형태 반환하도록 리팩토링 (기존 호출자 2곳 시그니처 정합 유지 주의).
- `hashchange` 핸들러: `#detail/<id>` 면 해당 id 의 로그를 `logs` 배열(또는 동등 소스)에서 찾아 상세 렌더 후 진입. 못 찾으면 teams 로 폴백 (replaceState).
- `restoreViewFromHash()`: 부트 시 `#detail/<id>` 면 로그 로딩 완료 후 상세 복원 (로딩 타이밍 주의 — loadLogs 이후에 호출되는 위치인지 확인하고, 아니면 복원을 로딩 완료 콜백으로 지연).
- 뒤로가기로 detail → 직전 탭 복귀가 자연스럽게 동작해야 함.

### 3. 건드리면 안 되는 기존 동작
- Supabase **recovery 해시** (`#...type=recovery...`, 라인 ~4390) 흐름 — 뷰 해시로 오인하면 안 됨 (VALID_VIEWS 검사로 이미 걸러지지만 detail 파싱 추가 시 재확인).
- 비밀번호 변경 후 해시 제거 (라인 ~4323) 동작 유지.
- 역할/프로젝트 게이트 (hashchange 와 restore 의 admin/pm·project 검사) 그대로 유지 — detail 도 본인 접근 가능 로그만 (logs 배열엔 RLS 통과분만 있으므로 배열 조회 실패 = 접근 불가 = 폴백).
- 로그인 전 화면에서는 해시 네비게이션이 동작하지 않아야 함 (현행 부트 순서 유지).

## CAN touch
- `public/index.html` 만. 그 안에서도 라우팅 관련 함수(switchView / viewFromLocationHash / restoreViewFromHash / hashchange 리스너 / showDetail / goHome / 부트 시퀀스의 switchView 호출부)로 한정.

## MUST NOT
- 다른 파일 수정 금지. RLS·DB 접근 코드 변경 금지.
- innerHTML 에 사용자 입력 삽입 시 escHtml()/escAttr() 필수 (record id 를 DOM 에 넣을 일이 있으면 이스케이프).
- 전역 변수 남발 금지 — 추가가 필요하면 1개 이하로.

## 검증 (빌드 없음 — 직접 증거)
- 로컬 정적 서빙(`npx serve public` 등) 후 브라우저로: 로그인 불가 환경이면 최소한 콘솔 문법 에러 0 확인 + 코드 경로 정독 추적.
- 시나리오 표로 보고: (a) 탭 A→B→C 후 뒤로가기 2번 = A 복귀, (b) 상세 진입 후 뒤로가기 = 목록 복귀, (c) 새로고침 시 현재 탭 유지, (d) #detail/<id> 새로고침 복원, (e) 첫 진입 후 뒤로가기 1번 = 사이트 이탈(정상), (f) recovery 해시 미간섭.
- Return Format 5섹션 필수 (AGENTS.md).
