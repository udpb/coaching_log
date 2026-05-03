# underdogs. 운영 시스템 인수인계서

> **작성 시점**: 2026-04-30 (2026-05-03 갱신: ud-ops 4번째 앱 발견 후 보강)
> **대상 독자**: 본 시스템을 인수받아 고도화할 다음 개발자
> **현재 상태**: production ready (3개 앱 중 2개 배포, 1개 배포 대기). 추가로 별도 시스템인 ud-ops 가 4번째 앱으로 운영 중 (Neon Postgres 별도 DB).
> **백엔드**: Supabase (3-앱 공유) + Neon Postgres (ud-ops 단독). 4-앱 통합 SSoT는 [INTEGRATED_ARCHITECTURE.md](INTEGRATED_ARCHITECTURE.md) 참조.

이 문서는 (1) 제품 구조, (2) 데이터 모델, (3) 사용자 흐름, (4) 운영/배포 정보를 담습니다. 끝에 **검증 매트릭스**가 있어 모든 주장이 실제 코드와 일치하는지 한눈에 확인할 수 있습니다.

> **🔔 ud-ops 포함 4-앱 시스템 전체 그림은 [INTEGRATED_ARCHITECTURE.md](INTEGRATED_ARCHITECTURE.md)** 를 참조하세요. 본 문서는 Supabase 3-앱(coaching-log/coach-finder/hub) 중심 인수인계입니다.

---

## 1. Executive Summary

**제품**: 언더독스(UDImpact) 사내용 스타트업 코칭 운영 시스템.

**4개의 앱** (Vercel 배포):

| 앱 | URL | 사용자 | 역할 | DB |
|---|---|---|---|---|
| **ud-ops** | https://ud-planner.vercel.app | PM (UDI 직원) | 사업 기획·RFP 분석·커리큘럼·예산·제안서 PDF | Neon Postgres (별도) |
| **underdogs-hub** | (배포 대기) | 모든 직원 | 로그인 후 진입할 서비스 선택 | Supabase (Auth만) |
| **coaching-log** | https://coaching-log-lemon.vercel.app/ | Coach + PM + Admin | 코칭 세션 기록·STT 자동 추출·BP/평가 관리 | Supabase |
| **coach-finder** | (Vercel URL — 사용자가 envvar 추가 후 redeploy 필요) | PM + Admin | 코치 디렉토리 검색·프로젝트 코치 배정·평가 조회 | Supabase |

본 인수인계서는 **Supabase 3개 앱**(coaching-log/coach-finder/hub) 중심입니다. ud-ops 단독 인수인계는 `ud-ops-workspace/HANDOVER.md` (별도 PRD-v7.1) 참조.

**3-tier 권한** (`public.profiles.role`):

| Role | 가입 자격 | 권한 |
|---|---|---|
| `admin` | `udpb@udimpact.ai`, `udpb@underdogs.co.kr` (handle_new_user 트리거에 박혀 있음) | 모든 데이터 read/write, 사용자 관리, 코치 디렉토리 CRUD |
| `pm` | `*@udimpact.ai`, `*@underdogs.co.kr` (admin 제외) | 모든 BP·코칭로그 read, 자신이 만든 BP·평가 write |
| `coach` | 그 외 모든 이메일 (외부 코치) | 자신의 코칭로그만 read/write, 자신이 멤버인 프로젝트만 노출 |

**Phase 진행 상태** (코드/배포 기준, 자세한 내역은 §7):
- ✅ Phase 1.5 (STT) / 4-A (RBAC) / 4-B (projects) / 4-D (coach directory) / 4-E (pgvector) / 5-A (PM role) / 5-B (BP+평가)
- ✅ Phase C1 (coach-finder Supabase data) / C3 (BP 평가 CRUD UI) / C4 (coach-finder Supabase Auth) / F (Firebase 0%)
- ✅ Phase H1+H2 (hub 앱 + 양쪽 헤더 링크) — 코드 완료, 배포 대기
- 🟡 Phase C2 (RAG 검색 UI) / C5 (코치 평가 집계 view) / H3 (진짜 SSO) / D (ud-ops) / Z (AWS) — 미착수

---

## 2. 제품 구조 (3개 앱의 책임 + 경계)

```
                   ┌──────────────── 공유 Supabase ────────────────┐
                   │  auth.users + public.profiles (single Auth)    │
                   │  coaches_directory (코치 단일 진실 원천)          │
                   │  business_plans / business_plan_coaches /       │
                   │      coach_evaluations (사업·코치배정·평가)       │
                   │  projects / project_members (수주 후 자동 생성)    │
                   │  coaching_logs (세션 기록)                       │
                   │  coaches_directory_history (변경 audit)          │
                   └──────────────────────────────────────────────┘
                                ▲              ▲              ▲
                ┌───────────────┘              │              └────────────────┐
                │                              │                               │
       ┌────────┴────────┐           ┌─────────┴─────────┐           ┌────────┴────────┐
       │ underdogs-hub   │           │ coaching-log      │           │ coach-finder    │
       │ (vanilla HTML)  │           │ (vanilla HTML)    │           │ (React+Vite+TS) │
       │                 │           │                   │           │                 │
       │ - 통합 로그인     │           │ - STT 추출        │           │ - 코치 검색/필터  │
       │ - 권한별 카드 2개  │           │ - 코칭로그 CRUD    │           │ - 프로젝트 페이지  │
       │ - 각 앱으로 이동  │           │ - 팀 대시보드      │           │ - 코치 배정/단가  │
       │                 │           │ - 사업기획(BP)     │           │ - 평가 작성     │
       │                 │           │ - 코치 평가        │           │ - 코치 디렉토리   │
       │                 │           │ - 사용자 관리(admin)│           │   admin 편집    │
       │                 │           │ - 코치 디렉토리     │           │                 │
       └─────────────────┘           └───────────────────┘           └─────────────────┘
        public/index.html             public/index.html              client/src/...
        (~764 lines)                   (~10638 lines)                 (Vite app)
```

### 2.1 underdogs-hub
- **목적**: 단일 진입점. 로그인 후 사용자 권한에 맞는 서비스 카드를 보여주고 클릭 시 해당 앱으로 라우팅.
- **저장소**: `C:\Users\USER\underdogs-hub` (로컬 git, 아직 GitHub push 안 됨)
- **메인 파일**: `public/index.html` (단일 파일 vanilla HTML+CSS+JS)
- **Supabase 사용**: Auth (`profiles` 테이블에서 role 조회) — 데이터 read/write 없음
- **카드 권한 매트릭스**:
  - Coaching Log: admin / pm / coach 모두 활성
  - Coach Finder: admin / pm 만 활성, coach는 비활성+안내
- **주의**: 진짜 SSO는 미구현. 카드 클릭 시 도착한 앱에서 다시 로그인 필요할 수 있음 (도메인이 다르면 쿠키 분리). 향후 Phase H3에서 해결 예정.

### 2.2 coaching-log
- **목적**: 코치/PM/admin이 코칭 세션을 기록·관리·리포트.
- **저장소**: `C:\Users\USER\underdogs-coaching-log` (GitHub: `udpb/coaching_log`)
- **메인 파일**: `public/index.html` (단일 파일 vanilla, 10638줄)
- **API**: `api/extract-session.js` (Vercel serverless, Gemini 3.1 Pro로 STT 전사본을 18개 구조화 필드로 추출)
- **Supabase 사용**: 모든 테이블 (RLS로 권한 격리)
- **주요 화면 (탭)**:
  1. **프로젝트** (Teams) — 프로젝트별 팀/세션 카드 그리드
  2. **기록** (Record) — STT 입력 → 자동 추출 → 검토/저장
  3. **목록** (List) — 모든 세션 행 보기 + 검색
  4. **대시보드** — 팀별 메트릭 트렌드 차트
  5. **코치 디렉토리** (admin/pm) — 800+명 코치 풀
  6. **사업기획** (admin/pm) — BP CRUD + 코치 핀 + 평가 + 수주 처리
  7. **사용자 관리** (admin only) — PM 등록·역할 변경

### 2.3 coach-finder
- **목적**: PM이 사업 기획 단계에서 적합한 코치를 검색·배정·평가 (1차 단가 산출 포함).
- **저장소**: `C:\Users\USER\underdogs-coach-finder` (GitHub: `udpb/coach-finder`)
- **메인 폴더**: `client/src/` (Vite + React 19 + TypeScript)
- **주요 컨텍스트**:
  - `AuthContext.tsx` — Supabase Auth (Phase C4)
  - `CoachDataContext.tsx` — coach pool from `/api/coaches` + 직접 mutation to coaches_directory
  - `ProjectContext.tsx` — projects from business_plans/bp_coaches/coach_evaluations
- **API**: `api/coaches.ts` (Vercel serverless, service_role로 coaches_directory 읽기)
- **Supabase 사용**: Auth + 모든 데이터 테이블

---

## 3. 데이터 모델 (Supabase schema)

마이그레이션 12개 (모두 `supabase/migrations/`에 있음, 시간순):

| 파일 | 추가된 것 |
|---|---|
| `20260413_create_coaching_logs.sql` | `coaching_logs` 기본 테이블 (전체 RLS open — 후속 마이그레이션이 좁힘) |
| `20260417_add_transcript_raw.sql` | STT 원문 저장 |
| `20260421_add_narrative_and_evidence.sql` | AI 내러티브 + 증거 인용 |
| `20260421_phase15_scalar_fields.sql` | last_done_rate 등 자동 계산 스칼라 |
| `20260421_phase4a_roles_rls.sql` | `profiles` + `is_admin()` + RLS |
| `20260423_phase4b_projects.sql` | `projects`, `project_members`, `is_project_member()` |
| `20260423_phase4d_coaches_directory.sql` | `coaches_directory`, `coaches_directory_history`, autolink trigger, photo storage |
| `20260424_phase4e_pgvector_rag.sql` | pgvector + `search_coaches_by_embedding()` RPC |
| `20260427_phase5a_pm_role.sql` | 3-tier RBAC (`pm` 역할 + `is_pm()` + `is_admin_or_pm()`), 도메인 자동 매칭 |
| `20260428_phase5b_business_plans.sql` | `business_plans`, `business_plan_coaches`, `coach_evaluations`, **`bp_on_won` 수주 트리거** |
| `20260429_phase_f_payment_info.sql` | bp_coaches에 `payment_info` jsonb + `task_summary`; bp에 `client` + `total_budget` + status 확장 (planning/active/completed) |
| `20260429_phase_f_legacy_firestore_id.sql` | bp에 `legacy_firestore_id` (이관 멱등성용) |

### 3.1 핵심 테이블 — 컬럼 요약

#### `auth.users` (Supabase 내장)
- 모든 로그인 사용자. Supabase Auth가 관리. 직접 INSERT 안 함.

#### `public.profiles` — 사용자 프로필 + 역할
```
id              uuid PK FK auth.users(id)
email           text
display_name    text
role            text CHECK IN ('admin','pm','coach')
created_at      timestamptz
```
- **트리거 `on_auth_user_created`** (`handle_new_user()`):
  - 새 auth.users 생성 시 자동으로 profiles 행 INSERT.
  - `udpb@udimpact.ai`, `udpb@underdogs.co.kr` → `admin`
  - `*@udimpact.ai`, `*@underdogs.co.kr` (admin 제외) → `pm`
  - 그 외 → `coach`
- **헬퍼 함수** (모두 SECURITY DEFINER, 정책 재귀 회피):
  - `is_admin()` → boolean
  - `is_pm()` → boolean
  - `is_admin_or_pm()` → boolean

#### `public.coaches_directory` — 코치 마스터 풀 (단일 진실 원천)
```
id                       uuid PK
external_id              text UNIQUE  -- 레거시 numeric id (anchor for 동기화)
name, email, phone, gender, location, country
regions, industries, expertise, roles, language, tags  -- text[]
organization, position
intro, career_history, education, underdogs_history, current_work, tools_skills
career_years numeric, career_years_raw text
photo_url, photo_filename
tier, category, business_type
availability_status      ('available' | 'limited' | 'unavailable')
linked_user_id           uuid FK auth.users (코치가 가입했을 때 매칭)
status                   ('active' | 'inactive' | 'archived' | 'draft')
notes
created_at, updated_at, last_synced_at
embedding                vector(1536)         -- Phase 4-E
embedding_source_hash    text                 -- 변경 감지용
embedding_updated_at     timestamptz
embedding_model          text
```
- 800+명 시드 (initial import via `tools/import-coaches.js`)
- HNSW 코사인 인덱스 (Phase 4-E) — RAG 검색 대비
- **트리거**: `coaches_audit_tr` → `coaches_directory_history`에 변경 스냅샷 저장
- **트리거**: `autolink_coach_on_profile_tr` → 코치가 가입하면 email 매치로 `linked_user_id` 자동 채움
- **트리거**: `coaches_invalidate_embedding` → 프로필 텍스트 바뀌면 embedding을 NULL로 초기화

#### `public.coaches_directory_history` — 변경 audit
```
id, coach_id, changed_at, changed_by, action ('insert'|'update'|'delete'),
snapshot jsonb  -- 변경 직전 row 전체
```
- admin/pm read

#### `public.projects` — 코칭 프로젝트 (수주 후 발생)
```
id          uuid PK
name        text
description text
status      ('active' | 'closed' | 'archived')
start_date, end_date  date
created_by  uuid FK auth.users
created_at, updated_at
```
- `bp_on_won` 트리거가 자동 INSERT (수주 시)

#### `public.project_members` — 프로젝트 ↔ 사용자
```
id, project_id, user_id, role ('lead_coach'|'coach'|'observer'), added_at, added_by
UNIQUE (project_id, user_id)
```
- `bp_on_won` 트리거가 자동 INSERT (BP의 accepted 코치들)

#### `public.coaching_logs` — 코칭 세션 기록
```
id                    uuid PK
team_name             text
project_id            uuid FK projects
coach_id              uuid FK auth.users
date, session_num, session_type, stage
founder_name
... (18개 구조화 필드: real_issue, blocker_type, last_done, ai_used, ...)
narrative_summary     text  -- AI 내러티브
transcript_raw        text  -- STT 원문 (검수/재분석용)
evidence              jsonb -- 필드별 증거 인용
metrics               jsonb
created_at, updated_at
```

#### `public.business_plans` — 사업 기획안 (BP)
```
id                   uuid PK
title                text NOT NULL
client               text       -- coach-finder의 자유 텍스트 고객사
client_org           text       -- 정형 조직명 (coaching-log)
description          text
status               text CHECK IN (
                       'draft','proposed','won','lost','cancelled',     -- coaching-log
                       'planning','active','completed'                   -- coach-finder
                     )
target_start_date, target_end_date  date
estimated_budget     numeric    -- coaching-log
total_budget         numeric    -- coach-finder (별도 의미)
notes                text
project_id           uuid FK projects   -- NULL until won
legacy_firestore_id  text UNIQUE  -- Firestore 이관 멱등성 (NULL for native)
created_by           uuid FK auth.users
created_at, updated_at
```
- 두 앱이 같은 테이블을 다른 lifecycle로 사용 → status 매핑 (coach-finder가 read 시점에 변환)

#### `public.business_plan_coaches` — BP에 핀된 코치
```
id                   uuid PK
business_plan_id     uuid FK business_plans CASCADE
coach_directory_id   uuid FK coaches_directory CASCADE
rank                 int
status               ('candidate' | 'proposed' | 'accepted' | 'rejected' | 'withdrawn')
notes                text
task_summary         text       -- coach-finder의 업무 요약
payment_info         jsonb      -- {payRole, payGrade, payUnit, payRatio, unitPrice, sessions, totalAmount}
added_by, added_at
UNIQUE (business_plan_id, coach_directory_id)
```

#### `public.coach_evaluations` — 코치 평가
```
id                       uuid PK
coach_directory_id       uuid FK coaches_directory CASCADE
business_plan_id         uuid FK business_plans SET NULL
project_id               uuid FK projects SET NULL
evaluator_id             uuid NOT NULL FK auth.users CASCADE
rating_overall           int CHECK 1..5
rating_communication     int CHECK 1..5
rating_expertise         int CHECK 1..5
rating_reliability       int CHECK 1..5
would_rehire             boolean
comment                  text
created_at, updated_at
```
- `evaluator_id` NOT NULL — RLS의 own-row 식별 키
- 코치 본인은 자기 평가 못 봄 (의도된 동작)

### 3.2 수주 트리거 — `bp_on_won` (가장 중요한 자동화)

위치: `20260428_phase5b_business_plans.sql`

```sql
CREATE TRIGGER bp_on_won
  AFTER UPDATE ON public.business_plans
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    AND NEW.status = 'won'
    AND NEW.project_id IS NULL
  )
  EXECUTE FUNCTION public.handle_business_plan_won();
```

함수 `handle_business_plan_won()` 동작:
1. `projects` 새 행 INSERT (`name`=BP.title, status='active', ...)
2. `business_plans.project_id`에 새 project id 채움
3. BP의 `accepted` 상태 코치들 중 `linked_user_id`가 있는 코치들을 `project_members`에 INSERT (role='coach')

→ PM이 사업기획 탭에서 "수주 처리" 버튼만 누르면 그 다음 모든 게 자동.

### 3.3 RLS 매트릭스

| 테이블 | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | own row OR admin/pm | self | admin only | (없음) |
| `coaching_logs` | own OR admin/pm OR project member | own | own | own |
| `projects` | admin/pm OR project member | admin/pm | admin all, pm own | admin all, pm own |
| `project_members` | admin/pm OR own membership | admin all, pm own project | 동일 | 동일 |
| `coaches_directory` | authenticated | admin only | admin OR own linked | admin only |
| `coaches_directory_history` | admin/pm | (트리거) | (없음) | (없음) |
| `business_plans` | admin/pm OR project member | admin/pm | admin all, pm own | admin only |
| `business_plan_coaches` | admin/pm | admin all, pm own BP | 동일 | 동일 |
| `coach_evaluations` | **admin/pm only** (코치 못 봄) | admin/pm | admin all, pm 작성자 본인 | admin only |

> 코치 평가의 SELECT가 admin/pm only인 것은 **의도된 보안 결정** — 코치가 솔직한 평가를 직접 보면 PM이 솔직하게 못 씀.

---

## 4. 사용자 흐름 (User Flow)

### 4.1 진입 흐름 (Entry)

```
사용자가 브라우저 접속
   │
   ├─ 직접 coaching-log URL → 자체 로그인 → 그대로 사용
   ├─ 직접 coach-finder URL → 자체 로그인 → 그대로 사용
   └─ Hub URL → 단일 로그인 → 카드 2개 선택 → 해당 앱으로 이동
                                              │
                                              └─ (현재) 도착 앱에서 한 번 더 로그인 필요
                                                 (Phase H3에서 SSO로 해결 예정)
```

### 4.2 Coach 흐름 — 코칭 세션 기록

1. **로그인** (coaching-log) → 첫 페인트 시 audit-fix 적용된 `loadCurrentUserRole`이 ~500ms 안에 role 결정 (`profiles.role` 조회).
2. **프로젝트 선택** — 자신이 멤버인 프로젝트만 picker에 노출 (`projects` RLS).
3. **기록** 탭 → STT 전사본 붙여넣기 → "초안 생성" → Gemini 3.1 Pro가 18개 필드 + 내러티브 자동 채움.
4. **검토 + 저장** — 자신감 < 0.7 필드는 ⚠ 표시.
5. **목록**에서 자기 세션 다시 찾기 / 편집 가능 (own row).
6. **대시보드** — 자기 팀 메트릭 트렌드 시각화.

### 4.3 PM 흐름 — 사업 기획 → 코치 배정 → 수주 → 평가

```
[coach-finder]                          [coaching-log]
                                           
1. 코치 검색 (필터/RAG)                    
2. 후보 코치 핀 + 단가 산출                 
3. 프로젝트 페이지에서 BP로 합쳐 저장          
   (= business_plans + business_plan_coaches)
                                           
                                        4. 사업기획 탭에서 같은 BP 보임
                                           (RLS는 admin/pm 모두 read 허용)
                                        5. status proposed → won 전환 클릭
                                        6. bp_on_won 트리거 자동 실행:
                                             - projects 새 행 생성
                                             - business_plans.project_id 채움
                                             - accepted 코치들 → project_members
                                        7. 코치들이 자기 코칭로그를 이 프로젝트로 기록 가능
                                           
사업 종료 후:                              
                                        8. BP 상세 → "+ 새 평가" → 코치 평가 작성
                                           (rating + 코멘트 + 재의뢰 의향)
                                           
9. coach-finder에서 같은 평가 조회 가능        
   (Phase C5 — read-only 집계 view 예정)    
```

### 4.4 Admin 흐름 — 사용자 + 코치 관리

1. **사용자 관리** 탭 (coaching-log, admin only):
   - 모든 profile 조회
   - 새 PM 등록 (이메일로 검색 → role을 'pm'으로 승격)
   - 가입 안 된 사용자에게 가입 링크 안내
2. **코치 디렉토리** 탭 (coaching-log + coach-finder 양쪽):
   - 800+명 코치 검색/필터
   - 코치 정보 편집 (직접 `coaches_directory` UPDATE)
   - 변경 시 `coaches_directory_history`에 audit 자동 저장

---

## 5. 인증 흐름 (Auth Flow) — audit lessons 적용된 핵심

세 앱 모두 **같은 Supabase 프로젝트**의 `auth.users` + `profiles`를 공유.

### 5.1 audit lessons (절대 회귀 금지)

cooaching-log 개발 중 1-3분 동안 role이 'coach'로 폴백되는 race condition 발생 → 두 가지 root cause 확정:

**Bug A — `supabaseAvailable` lazy-init 게이트 데드락**:
- 어떤 `supabaseAvailable` 같은 플래그가 후속 fetch 성공 시에만 true로 바뀌는 경우, 그 플래그를 검사해서 init-path 함수를 bail시키면 첫 페인트 시 항상 false라 영원히 데드락.
- **해결**: init-path 함수는 `currentUser` 또는 `supabase !== null` 같은 직접 검사만 사용.

**Bug B — onAuthStateChange listener 등록 시점**:
- Supabase v2는 `getSession()` 호출 시 동기적으로 `INITIAL_SESSION` 이벤트를 발화. listener를 `await getSession()` **이후**에 등록하면 그 이벤트 영원히 못 받음.
- **해결**: `onAuthStateChange` listener를 **`getSession()` 호출 전**에 등록. idempotent guard로 더블 mount 방어.

**Stale-token race**:
- 캐시된 JWT가 만료 임박이면 첫 profiles SELECT가 RLS에서 `auth.uid()=null`로 보여 빈 결과.
- **해결**: role 조회를 3회 retry. 첫 실패 후 `refreshSession()` 강제 호출. 두 번째 실패 후 600ms 백오프.

### 5.2 코드 위치

세 앱 모두 같은 패턴:

| 앱 | listener 등록 | role 조회 (retry+refreshSession) |
|---|---|---|
| coaching-log | `public/index.html` `attachAuthListener()` (line ~4370) | `loadCurrentUserRole()` (line ~4624) |
| coach-finder | `client/src/contexts/AuthContext.tsx` `onAuthStateChange` 호출 (line ~137) | `resolveUserRole()` (line ~69) |
| underdogs-hub | `public/index.html` `attachAuthListener()` (line ~715) | `loadCurrentUserRole()` (line ~602) |

> 라인 번호는 코드 변경에 따라 시프트하므로 함수 이름으로 grep 권장.

→ 향후 4번째 앱 추가 시 같은 패턴 복사. 새 패턴 발명 금지.

### 5.3 Login UI

- **coaching-log**: 자체 로그인 페이지 (이메일+비밀번호 + 비밀번호 찾기). 가입은 도메인 매칭으로 자동 role 부여.
- **coach-finder**: `LoginPage.tsx` — 이메일+비밀번호 + Google OAuth (`hd: 'udimpact.ai'` 도메인 힌트).
- **underdogs-hub**: 이메일+비밀번호 + 회원가입 + Google OAuth.

세션은 **도메인별 분리** (브라우저 쿠키 정책). 한 앱에서 로그인해도 다른 앱은 자체 로그인 필요. Phase H3에서 통일 예정.

---

## 6. 배포 & 운영 (Deployment & Ops)

### 6.1 배포 토폴로지

| 앱 | Vercel 프로젝트 | GitHub | 배포 트리거 |
|---|---|---|---|
| coaching-log | `udpb-5673s-projects/coaching-log` | `udpb/coaching_log` | main push 자동 |
| coach-finder | `udpb-5673s-projects/coach-finder` 또는 youngseung 측 | `udpb/coach-finder` (활성), `youngseungw/underdogs-coach-finder` (legacy) | main push 자동 |
| underdogs-hub | (배포 대기) | `udpb/underdogs-hub` (생성 대기) | main push 자동 |

### 6.2 환경변수 (Vercel + .env.local)

#### coaching-log
- 클라이언트 측 SUPABASE_URL/SUPABASE_KEY는 **`public/index.html`에 하드코딩** (anon key는 RLS로 보호되어 안전)
- 서버 측: `GEMINI_API_KEY` (api/extract-session.js에서 사용)

#### coach-finder
- **server (Vercel + .env.local)**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
- **client (Vercel + .env.local, VITE_ prefix)**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` (Cloud Run RAG)
- **삭제됨 (Phase F 이후)**: `VITE_FIREBASE_*` 6개 — Vercel에 남아 있어도 무해, 정리 권장

#### underdogs-hub
- **불필요** — anon key가 코드에 하드코딩 (다른 앱과 동일 패턴, RLS 보호)

### 6.3 핵심 운영 SQL

**전체 사용자 + 역할 조회**:
```sql
SELECT email, role, display_name, created_at
  FROM public.profiles
 ORDER BY created_at DESC;
```

**최근 N개 BP + 코치 수 + 평가 수**:
```sql
SELECT
  bp.title, bp.status, bp.client, bp.created_at,
  (SELECT count(*) FROM business_plan_coaches WHERE business_plan_id = bp.id) AS coaches,
  (SELECT count(*) FROM coach_evaluations WHERE business_plan_id = bp.id) AS evals,
  bp.project_id IS NOT NULL AS won
FROM business_plans bp
ORDER BY bp.created_at DESC LIMIT 20;
```

**수주 트리거 동작 검증**:
```sql
-- BP 한 건 만들고 won으로 전환
INSERT INTO business_plans (title, status) VALUES ('수주 테스트', 'draft') RETURNING id;
-- → BP id 메모. 그리고 코치 핀 + accepted 처리 후
UPDATE business_plans SET status='won' WHERE id='<id>';
-- → 자동 생성된 project + members 확인
SELECT bp.title, p.id AS project_id, p.name, p.status,
       (SELECT count(*) FROM project_members WHERE project_id=p.id) AS members
  FROM business_plans bp JOIN projects p ON p.id = bp.project_id
 WHERE bp.id='<id>';
-- 정리
DELETE FROM business_plans WHERE id='<id>';  -- bp_coaches CASCADE, project은 SET NULL로 살아남음
```

### 6.4 코치 풀 시드/동기화

- 초기 800명 시드: `tools/import-coaches.js` (1회 실행됨, repo에 보존)
- pgvector embedding 생성: `tools/embed-coaches.js` (Gemini embeddings, 매니지드 배치)
- 변경 시 자동 invalidation: `coaches_invalidate_embedding` 트리거가 프로필 텍스트 바뀌면 embedding을 NULL로 → 다음 배치에서 재생성

### 6.5 마이그레이션 스크립트 (일회성, 보존)

- `coach-finder/tools/firestore-to-supabase.mjs` — Phase F4의 일회성 Firestore → Supabase 데이터 이관 스크립트.
- Firebase service account JSON + Supabase service_role 키 필요.
- 이미 실행됨 (BP 1, bp_coaches 8, eval 1, edited 1, archived 1). 멱등이라 재실행해도 안전.
- 자세한 사용법: `coach-finder/tools/README.md`

---

## 7. Phase 진행 이력

| Phase | 완료일 | 내용 | 주요 commit |
|---|---|---|---|
| 1 | 4/13 | coaching_logs 기본 + STT 추출 | `3c77d24`(initial) |
| 1.5 | 4/21 | 자동 스칼라 계산 + 내러티브 + 증거 | (마이그레이션 4개) |
| 2 | 4/22 | 팀 대시보드 + SVG 차트 | (index.html 내) |
| 3 | 4/22 | 리포트 (PDF/Word, 단건+묶음) | (index.html 내) |
| 4-A | 4/21 | 3-tier RBAC 도입 (admin/coach 2단계) | `20260421_phase4a_roles_rls.sql` |
| 4-B | 4/23 | projects + project_members | `20260423_phase4b_projects.sql` |
| 4-D | 4/23 | coach directory (800명 시드) | `20260423_phase4d_coaches_directory.sql` |
| 4-E | 4/24 | pgvector + RAG RPC 준비 | `20260424_phase4e_pgvector_rag.sql` |
| 5-A | 4/27 | PM 역할 추가 (3-tier 완성) | `20260427_phase5a_pm_role.sql` |
| 5-B | 4/28 | BP + 평가 + 수주 트리거 | `20260428_phase5b_business_plans.sql`, `da61b5b` (UI) |
| C3 | 4/28 | 코치 평가 CRUD UI (BP 상세 안) | `9704c1e` |
| audit-fix | 4/28~29 | role race condition 진단 + 진짜 fix | `7c0e895`, `f301706` |
| C1 | 4/29 | coach-finder coach pool → Supabase | `fe0806f` (in coach-finder) |
| C4 | 4/29 | coach-finder Auth → Supabase | `fe0806f` (in coach-finder) |
| F1+F3+F5 | 4/30 | Firebase 0% (모든 Firestore 이관 + 패키지 제거) | `cc385e9` (in coach-finder), `6fa9070`+`b19a8d7`+`6ecbee3`+`8bc87d4` |
| H1+H2 | 4/30 | underdogs-hub 앱 + 양쪽 Hub 링크 | `af2874f` (hub 로컬), `fc88647`+`968b6e2` (link) |

---

## 8. 알려진 한계 & Future Work

### 8.1 의도된 한계 (현재 디자인)
- **코치 본인이 자기 평가 못 봄** — 의도된 보안 (5-B RLS)
- **"won"으로 변경한 BP는 status 되돌릴 수 없음** — 자동 생성된 project가 고아되는 것 방지 (UI에서 잠금)
- **Hub 클릭 후 도착 앱에서 재로그인 필요** — 도메인 분리. Phase H3에서 해결
- **pnpm 사용 강제** — coach-finder는 pnpm-lock.yaml. npm/yarn으로 install하면 깨짐

### 8.2 미착수 phases

| Phase | 내용 | 의존성 | 예상 효과 |
|---|---|---|---|
| **C2** | coach-finder PM RAG 검색 UI (pgvector 의미 검색) | 무관 | "AI 사업개발 + 여성 + 부산" 같은 자연어 쿼리 |
| **C5** | coach-finder 코치 상세에 평가 read-only 집계 view | C3 데이터 (있음) | 코치별 평균 별점 + 최근 평가 — 선택 의사결정 |
| **H3** | 진짜 SSO (cookie subdomain or OAuth handoff) | 도메인 정리 | 한 번 로그인 → 세 앱 다 자동 |
| **D** | ud-ops 새 앱 부트스트랩 | C2/C5 안정 후 | BP가 본거지로 이전 (현재 coaching-log에 임시 거주) |
| **Z** | AWS 이관 (RDS PostgreSQL + Cognito + S3 + Lambda + CloudFront) | 모든 phase 안정 후 | 인프라 일원화 |

### 8.3 운영 정리 권장
- **Firebase 프로젝트 (`gen-lang-client-0293778787`)**: 코드 의존성 0이지만 코치 사진 1.02GB가 Firebase Storage에 있음. 사진 URL이 `coaches_directory.photo_url`에 직접 박혀 있어서 그대로 동작. 삭제하지 말 것 (대안: Supabase Storage로 이전 후 URL 일괄 갱신 — 별도 phase로).
- **Vercel env vars의 `VITE_FIREBASE_*` 6개**: 코드에서 안 읽음. 정리 차원에서 제거 권장.
- **Firestore의 옛 데이터** (`projects` collection, `coachOverlay/global`): Supabase로 이미 이관 완료. ~2주 grace period 후 Firebase Console에서 삭제 가능.
- **`coaches_directory_history` 테이블**: 변경 audit. 1년 이상 누적 시 archive 정책 필요할 수 있음.

### 8.4 코드 정리 권장
- **`isFirebaseReady` 흔적**: `coach-finder` 헤더 코멘트에만 남아 있음 (마이그레이션 내력 archeology) — 그대로 둘 것.
- **`tools/firestore-to-supabase.mjs`**: 일회성이지만 보존 권장 (재이관 시 멱등). `firebase-admin`이 devDep으로 같이 보존됨.
- **legacy `id` (number) ↔ `uuid` 매핑** (coach-finder의 ProjectContext): 프로비저너 lifetime 동안만 메모리에 보관. 새로 만들어진 BP는 매번 새 매핑. 안정적이지만 복잡 — Phase D 때 ud-ops에서 처음부터 uuid native로 재설계 권장.

---

## 9. 신규 개발자 온보딩 체크리스트

### 9.1 환경 준비
- [ ] Node.js 20+ 설치
- [ ] `corepack enable` (pnpm 자동 사용)
- [ ] Vercel CLI: `npm i -g vercel` (선택)
- [ ] Supabase 대시보드 access — 기존 admin이 invite

### 9.2 Repo 클론
```bash
git clone https://github.com/udpb/coaching_log.git
git clone https://github.com/udpb/coach-finder.git
git clone https://github.com/udpb/underdogs-hub.git   # (생성된 후)
```

### 9.3 로컬 dev 실행
- **coaching-log**: `vercel link` → `vercel env pull` → `vercel dev` (port 3000)
- **coach-finder**: `pnpm install` → `pnpm dev` (port 3000, 자체 dev middleware로 /api/coaches 처리)
- **underdogs-hub**: `npx serve public` (단순 정적)

### 9.4 첫 PR 전 읽어야 할 것
1. 이 문서 (HANDOVER.md)
2. `docs/ARCHITECTURE.md` (기술적 디테일 + 결정 로그)
3. 가장 최근 audit fix 커밋 (`7c0e895`) — Bug A/B 패턴 학습
4. `coach-finder/tools/README.md` (마이그레이션 스크립트 설명)

### 9.5 새 기능 작업 시 패턴
1. **DB 변경 필요?** → `supabase/migrations/` 에 새 SQL 파일 (`YYYYMMDD_*.sql`). idempotent (DROP IF EXISTS / CREATE OR REPLACE).
2. **RLS 권한 필요?** → 기존 `is_admin()` / `is_pm()` / `is_admin_or_pm()` / `is_project_member()` 헬퍼 사용. SECURITY DEFINER 패턴 따라 새로 만들면 재귀 회피 됨.
3. **새 API 엔드포인트?** → coaching-log는 `api/*.js`, coach-finder는 `api/*.ts`. service_role은 server-only.
4. **클라이언트 mutation?** → browser supabase client (anon key) + RLS가 권한 결정. UI 검사는 보조.
5. **인증 관련 코드?** → 새 listener 만들지 말고 기존 `useAuth()` 또는 `currentUser` 전역 변수 사용.

---

## 10. 검증 매트릭스 (Verification Matrix)

이 문서의 핵심 주장이 실제 코드와 일치하는지 한눈에:

| # | 주장 | 검증 위치 | 결과 |
|---|---|---|---|
| 1 | 12개 마이그레이션 파일 존재 | `ls supabase/migrations/*.sql` | ✅ 12개 확인 |
| 2 | `profiles.role` CHECK는 admin/pm/coach | `20260427_phase5a_pm_role.sql` line 22 | ✅ |
| 3 | `udpb@udimpact.ai` → admin (handle_new_user) | `20260427_phase5a_pm_role.sql` line 43 | ✅ |
| 4 | 도메인 매칭 → pm | `20260427_phase5a_pm_role.sql` line 44 | ✅ `*@udimpact.ai`/`*@underdogs.co.kr` |
| 5 | `coaches_directory.status` CHECK는 4값 | `20260423_phase4d_coaches_directory.sql` line 70 | ✅ active\|inactive\|archived\|draft |
| 6 | `bp_on_won` 트리거 존재 | `20260428_phase5b_business_plans.sql` | ✅ 라인 ~141 (CREATE TRIGGER bp_on_won) |
| 7 | `business_plans.status`가 8값 허용 | `20260429_phase_f_payment_info.sql` | ✅ draft/proposed/won/lost/cancelled + planning/active/completed |
| 8 | `payment_info` jsonb 컬럼 | `20260429_phase_f_payment_info.sql` line 17 | ✅ |
| 9 | `legacy_firestore_id` 부분 unique | `20260429_phase_f_legacy_firestore_id.sql` | ✅ 부분 인덱스 (NOT NULL일 때만) |
| 10 | `coach_evaluations` SELECT는 admin/pm only | `20260428_phase5b_business_plans.sql` line ~270 | ✅ `is_admin_or_pm()` |
| 11 | 3개 앱이 같은 Supabase URL | 각 앱의 supabase 초기화 부분 | ✅ `zwvrtxxgctyyctirntzj.supabase.co` 모두 |
| 12 | coach-finder Firebase 0% — 0 import | `Grep "firebase" client/src/` | ✅ 헤더 코멘트만 (실 코드 0) |
| 13 | `firebase` 패키지 제거됨 | `coach-finder/package.json` | ✅ runtime deps에 없음. devDeps의 `firebase-admin`만 (마이그레이션용) |
| 14 | underdogs-hub repo 로컬 commit 1개 | `git log --oneline` (in `C:/Users/USER/underdogs-hub`) | ✅ `af2874f` |
| 15 | underdogs-hub 미배포 | GitHub remote 없음 | ✅ `git remote -v` 비어 있음 |
| 16 | coach-finder 최신 push = `cc385e9` | `git log udpb/main` | ✅ |
| 17 | coaching-log 최신 push = `2b75ec2` | `git log origin/main` | ✅ |
| 18 | audit fix 커밋 `7c0e895` 적용됨 | coaching-log git log + grep | ✅ `attachAuthListener` (line ~4370) + `loadCurrentUserRole` (line ~4624) — 라인 시프트 가능 |
| 19 | coach-finder의 audit lessons | `client/src/contexts/AuthContext.tsx` | ✅ `onAuthStateChange` (line ~137, getSession 전 호출), `resolveUserRole` (line ~69, retry+refresh) |
| 20 | underdogs-hub의 audit lessons | `public/index.html` | ✅ `attachAuthListener` (line ~715) + `loadCurrentUserRole` (line ~602) |
| 21 | `useCoachData()` API 시그니처 보존 | `CoachDataContext.tsx` line 39-50 | ✅ allCoaches/addCoach/updateCoach/deleteCoach/resetCustomData/customDataStats/loading/source |
| 22 | `useProjects()` API 시그니처 보존 | `ProjectContext.tsx` line 73-99 | ✅ projects/loading/addProject/updateProject/deleteProject/addCoachToProject/removeCoachFromProject/updateCoachTask/updateCoachPayment/saveEvaluation |
| 23 | TypeScript compile clean (coach-finder) | `npx tsc --noEmit` (Phase F 종료 시점) | ✅ 에이전트 보고 + 직접 확인 |
| 24 | F4 마이그레이션 실행 결과: BP 1 + bp_coaches 8 + eval 1 | Supabase SQL 검증 쿼리 | ✅ 사용자 확인 (8/1/1/1) |
| 25 | edited 코치 46번 + archived 코치 251번 | 같은 검증 쿼리 | ✅ |
| 26 | RLS 헬퍼 4개 존재 | `is_admin()`, `is_pm()`, `is_admin_or_pm()`, `is_project_member()` | ✅ 마이그레이션 4a + 4b + 5a |
| 27 | coach-finder의 LoginPage가 `isAuthReady` 사용 | `LoginPage.tsx` | ✅ `isFirebaseReady` 완전 제거 후 |
| 28 | ARCHITECTURE.md 로드맵 동기화 | `docs/ARCHITECTURE.md` | ✅ Phase F 등 완료 표시 |

검증 통과: **28/28 항목 일치**.

---

## 11. 연락처 / 인계 시점 의사결정

- **Supabase 프로젝트 owner**: udpb@udimpact.ai (필요 시 invite 추가)
- **GitHub `udpb` 계정**: 모든 repo 호스팅 (coaching_log, coach-finder, underdogs-hub)
- **Vercel team**: `udpb-5673s-projects` (모든 배포)
- **Firebase 프로젝트** (사진 호스팅만): `gen-lang-client-0293778787` (Coach AI 라벨)
- **Cloud Run AI 백엔드** (RAG 추천): `https://underdogs-ai-backend-103534218514.asia-northeast3.run.app` (별도 운영 — coach-finder의 `VITE_API_BASE_URL`)
- **AI 모델**:
  - Gemini 3.1 Pro (STT 추출, coaching-log)
  - Gemini Embeddings (코치 풀 임베딩, Phase 4-E)

---

## 부록 A. 빠른 트러블슈팅

### "ADMIN 배지가 1-3분 후에 뜬다"
→ audit Bug A/B 회귀. 다음 순서로 검증:
1. `loadCurrentUserRole`이 `supabaseAvailable` 같은 lazy 플래그에 게이트되어 있나?
2. `onAuthStateChange` listener가 `getSession()` **이전**에 등록되어 있나?
3. profiles 쿼리가 retry + refreshSession 패턴인가?

### "coach-finder에서 새 프로젝트 만들었는데 coaching-log 사업기획 탭에 안 보임"
→ 같은 BP 테이블이라 보여야 함. 다음 확인:
1. `business_plans` 테이블에 새 행이 있나? (Supabase Table Editor)
2. RLS — 본 사용자가 admin/pm인가?
3. coach-finder의 `created_by`가 채워졌나?

### "수주 처리했는데 project 안 만들어짐"
→ `bp_on_won` 트리거 검사:
1. status가 정확히 'draft'/'proposed'/'won' lifecycle을 탔나? (planning→won 같은 비표준 전이는 트리거 발화 X)
2. `OLD.status IS DISTINCT FROM NEW.status AND NEW.status='won' AND NEW.project_id IS NULL` 조건 만족?
3. 트리거가 생존하는지: `\df handle_business_plan_won` (psql) 또는 Supabase의 Functions 탭

### "코치 사진 안 보임"
→ Firebase Storage URL. 다음 확인:
1. `coaches_directory.photo_url` 필드 직접 조회 — 비어 있으면 사진 없음 (정상)
2. Firebase 프로젝트 active 상태 (절대 삭제 X)
3. 브라우저 콘솔에서 photo_url GET 실패 코드 확인

### "Supabase RLS error — coach 역할이 admin 데이터 보려고 함"
→ profiles.role 검사. 다음 SQL:
```sql
SELECT id, email, role FROM profiles WHERE id = auth.uid();  -- as the user
```
역할이 잘못 부여됐으면 admin이 SQL Editor에서 `UPDATE profiles SET role='admin' WHERE email='...'`.

---

## 부록 B. 파일 트리 요약

```
underdogs-coaching-log/
├── public/
│   └── index.html                # 메인 SPA (vanilla, ~10638줄)
├── api/
│   └── extract-session.js        # Gemini 3.1 Pro STT 추출 (Vercel func)
├── supabase/
│   └── migrations/               # 12개 SQL 파일 (시간순)
├── docs/
│   ├── ARCHITECTURE.md           # 기술적 디테일 + 결정 로그
│   └── HANDOVER.md               # 본 문서
├── tools/
│   ├── import-coaches.js         # 코치 풀 시드 스크립트
│   └── embed-coaches.js          # pgvector embedding 배치
├── lib/, data/, server.js        # 레거시 로컬 dev (Vercel 배포에선 미사용)
├── vercel.json
└── README.md

underdogs-coach-finder/
├── client/src/
│   ├── contexts/
│   │   ├── AuthContext.tsx       # Supabase Auth (Phase C4, audit lessons)
│   │   ├── CoachDataContext.tsx  # coaches_directory CRUD (Phase F1)
│   │   └── ProjectContext.tsx    # business_plans 통합 (Phase F3)
│   ├── lib/
│   │   ├── supabaseBrowser.ts    # 브라우저 Supabase client
│   │   └── (firebase.ts 삭제됨 — Phase F5)
│   ├── pages/                    # Home, LoginPage, ProjectsPage, NotFound
│   └── components/               # CoachCard, FilterPanel, AiRecommendModal, ...
├── api/
│   ├── coaches.ts                # Vercel func — service_role로 coaches_directory 읽기
│   └── _lib/supabaseAdmin.ts     # 서버 측 admin client
├── tools/
│   ├── firestore-to-supabase.mjs # Phase F4 일회성 마이그레이션
│   └── README.md                 # 사용법
├── package.json                  # firebase 제거됨, firebase-admin은 devDep
├── pnpm-lock.yaml                # pnpm 강제
└── vite.config.ts

underdogs-hub/
├── public/
│   └── index.html                # 단일 파일 vanilla (~764줄)
├── package.json                  # 거의 비어 있음 (Vercel용)
├── vercel.json
├── README.md
└── .gitignore
```

---

**문서 끝.** 질문/이슈 발생 시 `docs/ARCHITECTURE.md` 의 결정 로그(부록 D) + 가장 최근 commit message들 (`git log --oneline`) 참고.
