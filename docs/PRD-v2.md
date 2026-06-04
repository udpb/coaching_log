# coaching-log — Product Requirements (PRD) v2.0

> **버전**: 2.0 — 2026-06-04 (현행 코드 기준 작성)
> **상태**: Living document. 코드/마이그레이션이 진실원본(SoT). 본 PRD 는 코드 정독(file:line 근거)으로 작성됨.
> **자매 PRD**: coach-finder `docs/PRD-v2.md`.
> **참고**: 본 레포가 **공유 Supabase 스키마의 SoT**(`supabase/migrations/`).

---

## 0. 한 줄 정의

> **언더독스 코치가 창업팀 코칭 세션을 기록하고(STT→AI 구조화), 그 성과를 팀별 타임라인으로 추적하는 도구.**

- **소유**: 언더독스 / UD IMPACT
- **북극성**: 코치가 말(또는 녹음)로 5분만 입력하면 → AI 가 구조화 일지로 정리 → 회차가 쌓이며 "이 팀이 나아지고 있나"가 한눈에.
- **페르소나**: 코치(주 사용자) · PM/admin(사업·평가·코치 관리).

---

## 1. 제품 경계 (무엇을 하고 / 안 하는가)

언더독스는 **4개 앱 + 1개 공유 Supabase**(`coaches_directory` 마스터 공유) 구조다.

| 앱 | 페르소나 | 책임 |
|----|---------|------|
| **coaching-log** (본 제품) | 코치 | 코칭 일지(STT→AI)·성과 추적·코치 본인 정보·BP/평가/코치배정(admin·pm) |
| **coach-finder** | PM·admin | 코치 검색·AI 매칭·사업 기획·계약·예산 |
| **underdogs-hub** | 전체 | 4앱 진입 |
| **ud-ops** | admin | DB·embedding·인프라·제안서 |

**coaching-log 가 하는 것**: 코칭 세션 기록(STT/음성→Gemini 구조화), 팀별 성과 대시보드, 코치 본인 프로필·계약정보 자가관리, 사업기획(business_plans)·코치배정·평가(admin·pm), **수주(won) 트리거 발동 지점**.

**안 하는 것**: 코치 검색/RAG 추천(→coach-finder) · 코치 자가등록 신청 폼(→coach-finder `/register`) · RFP 분석/커리큘럼/제안서(→ud-ops).

> ⚠️ **평가 작성은 coach-finder 와 중복**(같은 `coach_evaluations`, INTEGRATED_ARCHITECTURE Gap 3).

---

## 2. 역할 모델 & 접근

`profiles.role` = **`admin` / `pm` / `coach`**. 가입 시 **DB 트리거 `handle_new_user()`** 가 도메인별 자동 부여: 특정 계정→admin, `@udimpact.ai`·`@underdogs.co.kr`→pm, 그 외→coach.

| 역할 | 보이는 화면 |
|------|------------|
| **coach** | teams(홈)·form(세션기록)·list·dashboard·myinfo. 본인 세션 + 멤버 프로젝트만 |
| **pm** | + coaches(디렉터리 read)·plans(사업기획)·평가 작성 |
| **admin** | 전부 + users(역할변경)·코치 편집·평가 삭제 |

> 화면 = `switchView()` 단일 라우터 + URL 해시(딥링크/뒤로가기 지원). 역할 미확정 시 admin/pm 탭 숨김 + coach 폴백(보수적).

---

## 3. 사용자 플로우 (메인 시나리오)

### 3.1 코치 핵심 여정 — "세션 기록 → 성과 추적"

```
로그인 (코치)
  │
  ▼  [신규 코치면 강제 온보딩] → 계약정보 입력해야 진입 (myinfo)
  │
  ▼
[teams 홈] ── 현재 프로젝트의 팀 카드(단계·세션수·최근날짜)
  │
  ▼
[form 세션 기록] ── 코칭 후, 말한 내용을 입력
  │
  ├─ 모드 A: STT transcript 붙여넣기
  └─ 모드 B: 🎙 음성 녹음 (MediaRecorder)
  │
  ▼  POST /api/extract-session (SSE 스트리밍)
[Gemini 3-pass 추출]
  PASS 0: (음성) verbatim 전사
  PASS 1: 8~15문장 narrative (코치의 기억)
  PASS 2: 구조화 22필드 {값, 근거evidence, 신뢰도}
  │
  ▼  (실시간으로 폼이 채워짐, 낮은신뢰 필드 하이라이트)
  │
  ▼
검토·수정 → 저장 (coaching_logs)
  │
  ▼
[dashboard 성과 추적] ── 팀별 타임라인
  · 평균 이행률(last_done_rate) · 에너지 추이 · 반복 blocker 경고
  · 약속↔이행 히스토리 · 근본이슈 변화 · metrics 시계열 차트
  │
  ▼
회차가 쌓이며 "이 팀이 나아지고 있나" 가시화 → 리포트 생성
```

### 3.2 코치 본인 정보 관리 (myinfo)

```
[myinfo] 4탭
  ├─ contract: 계약정보(주소·계좌·원천세·사업자) → coach_contract_info
  │              └─ 첫 저장 = 온보딩 완료 마킹
  ├─ projects: 내가 참여한 사업
  ├─ logs: 내 세션 기록
  └─ profile: 프로필 자가편집(소속·직위·전화·소개·전문분야)
                └─ 이름·유형(tier)·상태는 admin 전용(잠금)
```

### 3.3 PM/admin 여정 — 사업기획 → 수주 → 평가

```
[plans 사업기획] ── business_plans 생성 (admin/pm)
  │
  ├─ 코치 핀: business_plan_coaches 후보 등록 (candidate→accepted)
  │
  ▼
수주 처리 (status='won')
  │
  ▼  [DB 트리거 bp_on_won]
projects 자동 생성 + accepted 코치를 project_members 로 등록
  │  (= 코치가 teams 홈에서 이 팀을 보게 됨 → 세션 기록 시작)
  │
  ▼
[평가] BP 상세에서 5축 평가 작성 (admin/pm)
  └─ 코치 본인은 자기 평가 조회 불가 (RLS, 솔직성 보장)
```

---

## 4. 핵심 기능 명세

### 4.1 코칭 세션 기록 (★ 핵심 기능)

**입력 2모드**: 텍스트 STT 붙여넣기(≥50자) · 음성 녹음(webm/opus·mp4/aac, ~7분/4MB).

**서버 추출** (`api/extract-session.js`):
- **3-pass 프롬프트**: PASS0 verbatim 전사(음성) → PASS1 narrative 요약 → PASS2 구조화 22필드(각 `{value, evidence, confidence}`)
- **모델**: `gemini-2.5-pro`(주) → `gemini-2.5-flash`(폴백). 429/5xx 재시도 후 자동 폴백
- **복원력**: 잘린 JSON 자동 복구(괄호/따옴표 닫기), SSE delta 재조립
- **자동 계산**: 이전 세션 `next_action` → 이번 `last_commitment` 승계 · `last_done_rate` = 이행/약속 자동 산출

**클라 적용**: delta 마다 폼 실시간 채움 + 진행바, 낮은 신뢰도 필드 하이라이트.

**저장**: `coaching_logs` — 22필드 + narrative + evidence(jsonb) + (옵트인) 원본 transcript + metrics + coach_id + project_id.

### 4.2 성과 추적 (dashboard)

팀별 타임라인 + KPI:
- **평균 이행률** = avg(last_done_rate) · 현재/시작 단계 · 에너지 추이(+delta)
- **반복 blocker 감지** (최근 3회 동일 시 경고)
- 시각화: 타임라인 스트립 · metrics 시계열 차트 · 약속↔이행 히스토리 · 근본이슈 변화 · narrative arc
- 리포트 생성(세션별/번들 HTML)

> 성과 지표 핵심 = `last_done_rate`(이행률) · `evidence`(필드별 근거) · `energy`(1-5) · `metrics`(자유 지표).

### 4.3 사업/프로젝트 관리 (admin·pm)

- **business_plans**: 사업기획 단위. 상태 draft→proposed→won/lost/cancelled
- **수주(won)**: BP "수주 처리" → 트리거 `bp_on_won` → ① projects 생성 ② BP에 project_id 역기입 ③ accepted+연결된 코치를 project_members 등록
- **projects/project_members**: 코칭 engagement 단위. `coaching_logs.project_id` 로 세션 귀속. 미귀속 과거 로그는 가상 "orphan" 프로젝트로 표시

### 4.4 코치 디렉터리 (coaches_directory)

- **읽기**: admin/pm 만(필터·검색·300장 캡). `linked_user_id` 있으면 "로그인 연결됨" 배지
- **admin 쓰기**: 새 코치·CSV import·편집. 사진 = Supabase Storage `coach-photos` 버킷
- **코치 자가편집**(myinfo): 소속·직위·전화·소개·전문분야 등(RLS `linked_user_id=auth.uid()`). 이름·tier·status 는 admin 잠금
- **자동 연결**: 트리거 `autolink_coach_on_profile()` — 가입 이메일과 같은 코치 row 자동 linked

### 4.5 코치 평가 (coach_evaluations) — 5축

BP 상세에서 admin/pm 작성. 종합+소통+전문성+성실함(각 1-5) + 재계약의향(3-state) + 코멘트. 편집=admin전체/pm본인것, 삭제=admin. **코치 본인 SELECT 불가**.

### 4.6 코치 자가등록 신청 (coach_applications)

신청 **폼은 coach-finder `/register`**. DB 측: anon INSERT(pending 강제) → admin 승인 RPC `approve_coach_application`(→coaches_directory 등록) / 거절 RPC. (coaching-log 에 승인 UI 없음 — coach-finder 담당)

---

## 5. 데이터 모델 (제품 관점)

| 테이블 | 역할 |
|--------|------|
| `coaching_logs` | **세션 기록 원본**. 22 구조화 필드 + narrative + evidence + transcript + metrics + coach_id + project_id |
| `profiles` | 사용자 + role + onboarded_at(가입 트리거 자동) |
| `projects` / `project_members` | 코칭 engagement + 멤버(가시성 키) |
| `business_plans` / `business_plan_coaches` | PM 사업기획 + 후보 코치 |
| `coaches_directory` | **공유 코치 마스터**(~800명, embedding 1536, linked_user_id) |
| `coach_evaluations` | 5축 평가 |
| `coach_contract_info` | 계약 민감정보(주소·계좌·원천세) — 별도 테이블로 RLS 세분화 |
| `coach_applications` | 자가등록 신청(anon INSERT → admin 승인 RPC) |

**RLS 가시성** (SECURITY DEFINER 헬퍼 `is_admin()`·`is_pm()`·`is_admin_or_pm()`·`is_project_member()` 등으로 재귀 회피):
- **admin**: 전부
- **pm**: 본인 created_by BP/projects UPDATE, coaching_logs 읽기, 코치 read-only, 평가 작성
- **coach**: 본인 로그 + 멤버 프로젝트 로그, 본인 코치 row UPDATE, **자기 평가 조회 불가**

---

## 6. 기술 스택 / 보안

- **프론트**: 빌드 없는 단일 `public/index.html`(~12K줄 바닐라 JS). `switchView`+해시 라우팅. XSS 방어 = `escHtml`/`escAttr` 전역. i18n ko/en/ja.
- **백엔드**: Vercel serverless `api/extract-session.js` 1개(maxDuration 60s).
- **AI**: Gemini `gemini-2.5-pro`(추출, Native Audio) → flash 폴백. 임베딩 `gemini-embedding-001`(1536)은 `coaches_directory.embedding` 저장(추천 RPC 는 coach-finder 사용).
- **보안**: extract-session **JWT 인증 게이트**(Gemini 호출 전 401 차단) + **CORS allowlist**(와일드카드 없음) + 입력 크기 검증. service-role 서버 전용.

---

## 7. 변경 금지 / 운영 룰

- 적용된 마이그레이션 수정 금지 — **새 파일만** 추가
- `coaches_directory` 컬럼 변경 = ADR + 3앱(coach-finder·coaching-log·ud-ops) 동시 반영
- 역할 모델 admin/pm/coach · 임베딩 1536 · `escHtml` 의무

---

## 8. 알려진 한계 / 백로그

- **단일 index.html 12K줄** — 모듈화 미착수(대형, ADR 게이트)
- 평가 UI 가 coach-finder 와 **중복**(Gap 3) · 평가→tier 자동 트리거 부재(Gap 4)
- 코치 사진 = Supabase Storage(이전 Firebase 의존 제거됨)
- anon `coach_applications` rate-limit/captcha 미적용(ADR-004 후보)
- 인증 메일 발송 = Supabase SMTP 설정 의존(운영 항목)

> 상세 백로그: [docs/AUDIT-2026-06-01-verification.md](AUDIT-2026-06-01-verification.md).
