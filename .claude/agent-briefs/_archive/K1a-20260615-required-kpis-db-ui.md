# 브리프 K1a-20260615-required-kpis — 프로젝트별 필수 KPI (DB + 관리 UI + 폼 prefill)

## 배경 (Why)
ADR-022 (docs/decisions/022-project-required-kpis.md 필독) 1단계. 메트릭 기본 카드가 전역 하드코딩(DEFAULT_METRICS)이라 프로젝트에 안 맞는 카드가 깔리고 빈 채로 잔존. → 프로젝트별 `required_kpis` 로 전환. 본 브리프는 **DB 컬럼 + 프로젝트 관리 모달 편집 UI + 폼 prefill** 까지 (추출 연동은 K1b 별도).

## 산출물
1. 신규 마이그레이션 `supabase/migrations/20260615_phase_ab_project_required_kpis.sql`
2. `public/index.html` — 프로젝트 관리 모달 KPI 편집 + 폼 prefill

## 스펙

### 1. 마이그레이션 (새 파일만)
- `ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS required_kpis jsonb DEFAULT '[]'::jsonb;`
- 한국어 헤더 주석(기존 phase_z/aa 스타일) — ADR-022 근거, 형식 `[{"name":"DAU"},{"name":"유료 전환율"}]`, MVP 는 name 만.
- RLS: **신규 정책 없음** — projects UPDATE 기존 정책(admin 전체 / pm 본인, phase5a:152)으로 충분. 주석에 명시.
- `-- 검증` 섹션(information_schema 조회).

### 2. 프로젝트 관리 모달 KPI 편집 (public/index.html)
- 기존 `openProjectManageModal(id)` (~5520, admin/pm 게이트 이미 있음) 가 여는 모달(`projModalTitle` ~3726)에 **"필수 KPI" 섹션** 추가.
- UI: 현재 프로젝트의 `required_kpis` 를 이름 입력칸 목록으로 표시 + "추가"/각 항목 "삭제" + "저장". 저장 시 `supabaseClient.from('projects').update({ required_kpis: [...] }).eq('id', projectId)`.
- required_kpis 는 `[{name}]` 객체배열로 저장. 빈 이름 제외. 저장 성공 토스트, 실패 시 escHtml(error.message).
- 프로젝트 데이터 로드: 모달이 프로젝트 정보를 이미 들고 있으면 재사용, 없으면 projects 조회(.select 에 required_kpis 포함). projects select 가 `*` 면 자동 포함.
- 동적 텍스트(KPI 이름)는 input value 라 escAttr, 표시 시 escHtml.

### 3. 폼 prefill (public/index.html)
- 신규 일지 작성 진입 시 메트릭 기본 카드 생성 로직(`prepareForm` ~6395, `currentMetrics = DEFAULT_METRICS...`)을 수정:
  - `currentProject?.required_kpis` 가 비어있지 않으면 → `currentMetrics = required_kpis.map(k => ({ name: k.name, value: '' }))`.
  - 없거나 빈 배열이면 → 기존 `DEFAULT_METRICS` 폴백 (하위호환 — 미설정 프로젝트 회귀 0).
- previousSession 메트릭 carry-over 로직(~6427)이 있으면 그 우선순위를 깨지 말 것: 기존 동작은 "이전 세션 메트릭 > DEFAULT". 새 규칙은 "이전 세션 메트릭 > required_kpis > DEFAULT" 정도가 자연스러움 — 단 이전 세션 carry 시에도 required_kpis 에 있는데 빠진 항목은 빈 카드로 보강하면 좋음(필수니까). 판단해서 구현하고 보고.
- 필수 KPI 카드는 값 0/빈값이어도 유지(채우라는 신호) — deleteMetric 으로 코치가 지우는 건 허용(현행 유지).

## CAN touch
- 위 신규 마이그레이션 + `public/index.html` 만.

## MUST NOT
- 추출(api/extract-session.js)·프롬프트 변경 금지 (K1b 가 담당). 기존 마이그레이션 수정 금지. RLS 정책 신규 생성 금지(기존으로 충분). git 금지. escHtml/escAttr 규칙.
- DEFAULT_METRICS 자체 삭제 금지 (폴백으로 유지).

## 검증
- 마이그레이션 SQL 문법·멱등 점검.
- 인라인 스크립트 node --check.
- 코드 경로 보고: (a) required_kpis 설정된 프로젝트 → 신규 폼이 그 KPI 카드로 prefill (b) 미설정 프로젝트 → DEFAULT_METRICS 그대로 (c) 모달 저장 → projects.update 호출. 가능하면 prefill 분기를 가상 currentProject 로 node 시뮬레이션.
- ⚠️ 마이그레이션 라이브 적용은 메인이 함 — 적용 전엔 required_kpis 가 undefined 라 폴백 경로만 타는지 확인(배포 안전성).
- Return Format 5섹션.
