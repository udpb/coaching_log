# ADR-022: 프로젝트별 필수 KPI — 메트릭 기본 카드를 프로젝트 단위로

| 메타 | 값 |
|------|----|
| 상태 | Proposed (사용자 방향 승인 — 2026-06-15, 구현 착수 대기) |
| 일자 | 2026-06-15 |
| 작성자 | 메인 세션 (사용자 요청) |
| 관련 | ADR-020 (field-defs) · Q2 메모 모드 · 보류된 "어드민 템플릿" 방향 |

---

## Context (왜)
"핵심 숫자(metrics)" 섹션의 기본 카드가 **전역 하드코딩**(`DEFAULT_METRICS` = 전체 고객/유료 고객/월 매출)이라 모든 프로젝트·팀에 동일하게 깔린다. 실측 문제(2026-06-15, UCA프로젝트 스크린샷):
1. 프로젝트에 안 맞는 기본 카드가 0 값으로 깔림 → AI 추출 후에도 안 지워지고 잔존.
2. 추출 로직이 **병합**(index.html:7764-7772)이라 빈 기본 카드를 정리하지 않음.
3. AI가 지표 이름을 영어 키(`PAID_CUSTOMERS`)로 반환 → 한글 기본 카드(`유료 고객`)와 이름 매칭 실패 → 같은 개념이 중복 표시.

근본 원인은 "메트릭 기본값이 프로젝트와 무관하게 하나"라는 점. 각 프로젝트는 모든 팀에 공통으로 요구하는 KPI가 다르다.

## Decision (무엇을)
**`projects.required_kpis` 를 도입해 메트릭 기본 카드를 프로젝트 단위로 정의한다.** 사용자 결정(2026-06-15): 재사용 템플릿이 아니라 **프로젝트마다 직접 지정**, 설정 주체는 **어드민 + PM**.

### 데이터 모델
- 새 마이그레이션: `ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS required_kpis jsonb DEFAULT '[]'::jsonb;`
- 형식: 객체 배열 `[{"name":"DAU"},{"name":"유료 전환율"}]` (MVP 는 name 만; 향후 목표값·단위 확장 여지로 객체 배열 선택). projects 테이블명은 변경금지지만 **컬럼 추가는 새 파일로 허용**.
- RLS: projects UPDATE 정책은 기존 그대로 사용 — **어드민 전체 / PM 본인 프로젝트**(phase5a:152). 신규 정책 불필요(봉인은 INSERT만 막음). → 사용자의 "어드민+PM" 충족.

### 동작
- **폼 prefill**: 신규 일지 진입 시 `currentProject.required_kpis` 가 있으면 그것으로 메트릭 카드 생성. 없으면 기존 `DEFAULT_METRICS`(하위호환). 필수 KPI 카드는 값이 0/빈값이어도 **유지**(채우라는 신호).
- **추출 연동**: 추출 요청 context 에 프로젝트 required_kpis 를 실어, 프롬프트가 (a) 지표 이름을 **한국어 자연어**로 내고 (b) required_kpis 와 같은 개념이면 그 이름에 맞춰 반환하도록 유도. → 영어 키 중복 해소. `EXTRACTION_VERSION` 범프.
- **편집 UI**: 기존 "프로젝트 관리" 모달(`openProjectManageModal`, 어드민/PM 전용)에 KPI 설정 탭/필드 추가.

### 입력 지점 — 단계 분리 (봉인 제약)
코칭로그엔 프로젝트 생성 화면이 없다(To-Be 봉인, 트리거로만 생성). 따라서:
- **1단계 (coaching-log, 본 ADR 범위)**: "프로젝트 관리" 모달에서 어드민/PM 이 수주된 프로젝트에 KPI 설정. 폼 prefill + 추출 연동 + 영어라벨 한국어화.
- **2단계 (coach-finder, 별도)**: 사업기획 등록 시 KPI 입력 → bp_on_won 트리거가 projects.required_kpis 로 복사 → 사용자가 원한 "생성 시 입력" 완성. coach-finder 레포 + 트리거 수정 필요(변경금지 트리거 — ADR 별도).

## Consequences
### Positive
- 프로젝트별로 적합한 KPI 기본 카드 → 빈 카드/중복 문제 해소.
- "어드민 템플릿" 방향의 첫 실전 사용처 (재사용 템플릿은 미채택, 추후 KPI 세트 저장으로 진화 가능).
- 추출 한국어화로 라벨 가독성 개선.
### Negative / Trade-off
- 1단계만으론 "생성 시 입력"이 아니라 "생성 후 관리에서 설정" — 진짜 생성 시점 입력은 2단계(coach-finder) 필요.
- required_kpis 미설정 프로젝트는 기존 전역 DEFAULT_METRICS 로 폴백(점진 전환).
### 영향 코드
- 신규 마이그레이션 1 · `public/index.html`(폼 prefill·관리 모달·추출 context) · `api/extract-session.js`(프롬프트·버전).

## Alternatives Considered
| 옵션 | 왜 채택/기각 |
|------|------|
| 재사용 KPI 템플릿(어드민 라이브러리) | 사용자가 "프로젝트마다 직접"을 택함 — 기각. 단 미래 진화 경로로 열어둠 |
| 추출 시 빈 카드 단순 제거 | KPI 필수 카드는 0이어도 남아야 하므로 모순 — 기각 |
| coach-finder 생성 시 입력만 | 봉인 우회 위해 트리거·타 레포 수정 — 2단계로 분리 |

## 검증 (Acceptance)
- [ ] required_kpis 설정한 프로젝트의 신규 일지가 그 KPI 카드로 prefill
- [ ] 미설정 프로젝트는 기존 동작(DEFAULT_METRICS) 회귀 없음
- [ ] 추출이 한국어 이름 반환 + required_kpis 매칭 시 중복 없음
- [ ] 어드민/PM 만 KPI 편집(RLS+UI), 코치는 불가
- [x] 사용자 방향 승인 (프로젝트별 직접 · 어드민+PM)
