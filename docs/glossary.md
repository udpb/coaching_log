# 글로서리 — 단일 진실 용어집 (coaching-log)

> 코드 · 문서 · 브리프 · 사용자 가시 라벨 모두 본 파일을 따른다.
> 새 자료 흡수 시: 신규 용어 → 충돌 검사 → 충돌 시 STOP → ADR → 글로서리 → 코드 일괄.
> 작성: 2026-06-01 · 메인 세션 유지.

---

## 작성 / 변경 룰
1. 추가 — 출처 · 사용처 · 한국어 라벨.  2. 변경 — ADR + ~~취소선~~ + "Supersedes".  3. 삭제 — silent 금지.  4. alias 명시, 코드는 표준만.

---

## 1. 제품 · 역할

| 표준 | 한국어 | 비고 |
|------|--------|------|
| **coaching-log** | 코칭 로그 | 코치 세션 기록·성과 추적. **Supabase 스키마 SoT** |
| **coach-finder** | 코치 파인더 | 자매 제품 (PM 섭외 결정). Supabase 공유 |
| **ud-ops** | UD-Ops | 제안서 자동화. `coaches_directory` 소비자 (별도 Neon) |

### 역할 모델 (⚠️ 앱마다 다름)
| 표준 | 범위 | 비고 |
|------|------|------|
| **`admin` / `pm` / `coach`** | 본 제품 + coach-finder (Supabase `profiles.role`) | `handle_new_user()` 가 이메일 도메인으로 자동 부여. admin = `udpb@udimpact.ai`/`udpb@underdogs.co.kr` |
| ~~PM/DIRECTOR/CM/FM/COACH/ADMIN~~ | ud-ops (NextAuth) 전용 | **공유 안 됨** |

---

## 2. 세션 · 로그 (핵심)

| 용어 | 의미 | 비고 |
|------|------|------|
| **coaching_log** | 1회 코칭 세션 기록 행 (`coaching_logs`) | bigint PK. 24필드 (UCA 18 + ACTBot 5 Wave 6) |
| **transcript** | STT 원문 (또는 녹음) | extract 입력 |
| **extract-session** | Gemini 구조화 추출 | 3-pass: 전사 → 내러티브 → 22 구조화 필드 (각 `{value, evidence, confidence}`) |
| **narrative / evidence / confidence** | 내러티브 + 근거 + 신뢰도 | `20260421_phase15` |
| **stage (I/M/P/A/C/T)** | IMPACT 단계 | extract 가 분류 |
| **commitment / next_action / next_checkin** | 커밋먼트·다음 액션·체크인 | 대시보드 추적 |

---

## 3. 사업 · 프로젝트 (⚠️ 함정)

| 용어 | 의미 | 비고 |
|------|------|------|
| **business_plan** | 사업 기획 (coach-finder 가 주 생성·관리) | status 단일 라이프사이클 (ADR-023) |
| **status (business_plans)** | `planning`(기획) → `active`(진행중) → `completed`(종료) / `cancelled`(취소·무산) | **coach-finder 가 진실원천**, coaching-log 추종. 구 draft/proposed/won/lost 폐지 |
| **수주** | 기획→`active` 전환 = 수주 = 코칭 시작 | `bp_lifecycle_sync_*` 트리거 → `projects`(active) + `project_members` 자동 생성. (구 `won` 어휘·`bp_on_won` 폐지) |
| **project (`projects`)** | 수주 후 코칭 진행 단위 | 본 제품 대시보드의 팀. status `active`→`closed`(종료)/`archived`(보관), business_plans 종료/취소 시 `bp_status_propagate_upd` 가 동기화 |
| **project_members** | 프로젝트 배정 (코치/PM) | `is_project_member()` RLS 기준 |

> status 라이프사이클: **coach-finder(business_plans)가 SoT** — PM 이 기획→진행중→종료 전체를 관리하고, coaching-log 는 그 상태를 추종(트리거가 active 진입 시 projects 생성, 종료/취소 시 동기화). 상세 ADR-023.

---

## 4. RLS

| 헬퍼 (SECURITY DEFINER · 변경 금지) | 의미 |
|------|------|
| `is_admin()` / `is_pm()` / `is_admin_or_pm()` | 역할 판정 |
| `is_project_member()` / `is_pm_of_project()` | 프로젝트 멤버십 (PM 격리 phase_d3 — PM 은 본인/멤버 프로젝트만) |

---

## 5. 공유 계약
- `coaches_directory` 계약 = [docs/contracts/coaches-directory.md](contracts/coaches-directory.md) (**본 레포가 원본**). 변경은 세 앱 동시 + ADR. 임베딩 1536 (Gemini · 주석은 OpenAI 오기 — 정정 대상).

---

## 6. 리포트 템플릿 (AI 자동채움 · 2026-07-06 신규)

> 발주처(팀/프로젝트)마다 다른 보고서 양식을 코치가 손으로 재입력하는 "두 번 일함"을 없애는 기능.
> **AI 는 양식의 슬롯을 식별·값 배정(의미 매핑)만** 하고, **최종 파일은 결정론적 렌더러(코드)가 서식 보존 주입**한다 (AI 는 파일을 생성하지 않음 — 발주처 표·병합셀 손상 방지).
> 출처: [[코칭로그 템플릿 기반 리포트]] (LLM-Wiki) · 브리프 B1~B7. 사용처: `report_templates` 테이블 · `api/template-ai.js`(예정) · `index.html` 렌더러. 한국어 라벨은 아래 표.

| 표준 | 한국어 | 의미 · 비고 |
|------|--------|------|
| **report template** | 리포트 템플릿 | admin/PM 이 업로드한 발주처 보고서 양식 행 (`report_templates`). `docx`/`xlsx` (향후 `hwp`). ⚠️ **contract template 과 구분**(아래) |
| **contract template** | 계약서 템플릿 | 기존 `public/templates/coach-contract*.docx` — **정적 파일**, `downloadMyContract()` 가 fetch·치환. report template 과 **별개**(혼동 금지) |
| **slot** | 슬롯 | 템플릿에서 값이 들어갈 한 칸 (라벨 + 위치 앵커: docx=문단/셀, xlsx=셀좌표). 구 "placeholder" 를 대체하는 상위 개념 |
| **slot schema** | 슬롯 스키마 | ① ingest 가 추출한 슬롯 목록 + 반복그룹 (`report_templates.slot_schema` jsonb) |
| **template ingest** | 템플릿 인제스트 | 업로드 시 AI 가 슬롯을 식별하는 **1회** 분석 단계 (①, 결과 캐시) |
| **slot fill** (mapping) | 슬롯 값 배정 | ② AI 가 세션 데이터를 슬롯에 `{value, evidence, confidence}` 로 배정 (extract-session 철학 동일) |
| **repeat group** | 반복 그룹 | 회차별로 반복되는 슬롯 묶음 (docx `{#sessions}` 루프 / xlsx 열그룹) |
| **templatized template** | 태그 삽입본 | docx ingest 후처리로 `{{slot}}`·`{#sessions}` 토큰이 baked 된 렌더용 바이트 (`report_templates.templatized_base64`) |
| **renderer** | 렌더러 | 포맷별 **결정론적** 주입 엔진 (docx=docxtemplater / xlsx=좌표주입 / hwp=추후). AI 아님 |

> ⚠️ **report template ↔ contract template 구분**: 기존 코드/문서의 "template" 은 **계약서 정적 파일**(`coach-contract*.docx`, `downloadMyContract`) 맥락뿐이었다. 신규 "리포트 템플릿" 은 DB 저장·AI 자동채움 대상으로 **완전히 별개**다. 코드·문서에서 혼용 금지.
