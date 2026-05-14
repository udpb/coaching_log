# underdogs. 통합 아키텍처 — 4-앱 시스템 SSoT

> **작성일**: 2026-05-03
> **상태**: Active — 4-앱 통합 SSoT (Single Source of Truth)
> **선행 문서**: `coaching-log/docs/HANDOVER.md` (3-앱 기준, 보강됨)·`coaching-log/docs/ARCHITECTURE.md` (Phase 5-A 기준)·`ud-ops-workspace/PRD-v7.1.md` (ud-ops 단독 기준)·`ud-ops-workspace/docs/DIAGNOSIS-2026-05-03.md` (ud-ops 자체 진단)
> **이 문서의 역할**: **4개 앱 + 2개 DB + 데이터 흐름**을 한 화면에 정합시키고, 다이어그램(아키텍처 의도)과 실제 구현의 **gap 및 bridge 계획**을 명시.

---

## 0. 한 줄 요약

> **4개 앱이 2개 DB로 분리되어 있고, ud-ops Project가 Supabase로 동기화되지 않아 다이어그램의 lifecycle이 자연스럽게 안 흐른다. 본 문서는 그 다리 3개(Option 1·2·3)를 어떻게 놓을지의 계획서이다.**

---

## 1. 다이어그램(의도) — 사용자가 그린 아키텍처

```
┌─────────────────────────────────────────────────┐
│            SUPABASE  (공통 DB — 의도)            │
│ profiles · projects · coaches_directory         │
│ business_plans · curricula · sessions          │
│ evaluations · embeddings (pgvector)             │
└─────────────────────────────────────────────────┘
             ▲           ▲           ▲
             │           │           │
   ┌─────────┴───┐ ┌─────┴───────┐ ┌─┴─────────────┐
   │   ud-ops    │ │ coach-finder│ │ coaching-log  │
   │ (사업기획)   │ │ (코치풀+평가) │ │ (세션 기록)    │
   │  PM·UDI 직원│ │   PM·Admin   │ │   외부 코치    │
   └─────────────┘ └─────────────┘ └───────────────┘
        │                                 ▲
        └──── 수주 시 자동 ───→ 프로젝트 + 멤버 자동 생성
```

라이프사이클 (다이어그램 ⇒ 자연스러운 흐름):
```
① ud-ops에서 사업 기획 (RFP→커리큘럼→코치 배정→예산→제안서)
② coach-finder에서 코치 검색 (RAG)
③ 계약·온보딩 (수주)
   ▼ 자동 트리거
④ 코치들이 coaching-log에 자동 배정 → 세션 기록
⑤ PM이 coaching-log에서 모니터링
⑥ 종료 후 coach-finder에서 PM이 코치 평가
   → tier 자동 갱신 → 다음 사업 추천 가중치
```

---

## 2. 현실 — 실제 구현 상태

### 2.1 앱 4개 + DB 2개

```
[Supabase — zwvrtxxgctyyctirntzj.supabase.co]   [Neon Postgres — ap-southeast-1]
┌──────────────────────────────────┐             ┌──────────────────────────────────┐
│ coaching-log + coach-finder + hub │             │  ud-ops  (Next.js + Prisma)      │
│                                   │             │                                   │
│ • profiles (3-tier RBAC)          │             │ • User/Account/Session (NextAuth)│
│ • coaches_directory (800+ 마스터) │             │ • Coach (sync from coach-finder) │
│ • business_plans (BP)             │             │ • Project (RFP/예산/임팩트 풍부) │
│ • business_plan_coaches           │             │ • CurriculumItem                 │
│ • coach_evaluations               │             │ • CoachAssignment                │
│ • projects + project_members      │             │ • Budget · BudgetItem            │
│ • coaching_logs (STT/AI)          │             │ • ProposalSection                │
│ • coaches_directory_history       │             │ • ContentAsset                   │
│ • embeddings (pgvector — DEAD)    │             │ • + 30+ 모델 (25개 미사용)       │
└──────────────────────────────────┘             └──────────────────────────────────┘
                                                       ↑
                                                       │ /api/coaches/sync
                                                       │ (one-way pull)
                                                       │
                                                  coach-finder
                                                  Supabase coaches_directory
```

### 2.2 앱별 책임·테크스택 (실제)

| 앱 | URL | 사용자 | 코드 위치 | 스택 | 상태 |
|---|---|---|---|---|---|
| **ud-ops** | https://ud-planner.vercel.app | PM (UDI 직원) | `C:/Users/USER/projects/ud-ops-workspace` (`udpb/ud_planner`) | Next.js 16 + Prisma + Neon Postgres + NextAuth + Gemini Primary/Claude Fallback | production ready (PRD v7.1) |
| **coach-finder** | (Vercel URL TBD) | PM·Admin | `C:/Users/USER/underdogs-coach-finder` (`udpb/coach-finder`) | Vite+React 19 + Supabase Auth + Cloud Run python (RAG) | production ready (Phase F 완료) |
| **coaching-log** | https://coaching-log-lemon.vercel.app | 외부 코치 + PM + Admin | `C:/Users/USER/underdogs-coaching-log` (`udpb/coaching_log`) | Vanilla HTML + Vercel Functions + Supabase + Gemini 2.5-pro/flash | production ready |
| **underdogs-hub** | `ud-hub.vercel.app` | 모든 사용자 | `C:/Users/USER/underdogs-hub` (GitHub repo 미생성, Vercel 직접 deploy) | Vanilla HTML + Supabase Auth | 코드 완료, URL 확정 (2026-05-03) |

### 2.3 다이어그램 ↔ 실제 매핑

| 다이어그램 단계 | 다이어그램이 가리키는 위치 | 실제 위치 | 상태 |
|---|---|---|---|
| ① RFP 분석 | ud-ops | ud-ops `/api/ai/parse-rfp` | ✅ |
| ① 커리큘럼 설계 | ud-ops | ud-ops CurriculumItem + `/api/ai/curriculum` | ✅ |
| ① 코치 배정 (call coach-finder) | ud-ops | ud-ops CoachAssignment + 외부 URL 새창 | ⚠️ 외부 링크만 |
| ① 예산·임팩트 | ud-ops | ud-ops Budget/BudgetItem + logicModel | ✅ |
| ① 제안서 PDF | ud-ops | ud-ops ProposalSection + `/api/ai/proposal` | ✅ |
| ② 코치 검색 (Supabase RPC) | coach-finder | coach-finder Cloud Run python (FAISS) | ⚠️ 다이어그램과 다른 백엔드 |
| ② 필터·분야 | coach-finder | coach-finder Home.tsx | ✅ |
| ③ 계약·온보딩 | coach-finder | coach-finder ProjectsPage (사업·코치배정·단가) | ⚠️ "수주 처리" 명시 단계 없음 |
| ③→ 수주 트리거 | DB | coaching-log BP 탭의 "수주 처리" 버튼만 (status='won') | 🔴 **다리 깨짐** |
| ④ 코치 일지 | coaching-log | coaching-log 기록 탭 (STT→AI) | ✅ |
| ⑤ 시계열·리포트 | coaching-log | coaching-log 대시보드 | ✅ |
| ⑥ PM 평가 | coach-finder | coach-finder ProjectsPage **+** coaching-log BP 상세 | 🔴 **중복** |
| ⑥→ tier 자동 갱신 | DB trigger | 없음 | 🔴 **누락** |

### 2.4 다이어그램 vs 실제 데이터 모델 차이

| 다이어그램 | 실제 |
|---|---|
| **공통 DB**의 `curricula` | Neon에 `CurriculumItem` (Supabase에 없음) |
| **공통 DB**의 `embeddings` | Supabase pgvector 인프라만 있음 — coach-finder 가 사용 안 함 (Cloud Run RAG 별도 운영) |
| **공통 DB**의 `sessions` | Supabase `coaching_logs` (이름만 다름, OK) |
| **공통 DB**의 `evaluations` | Supabase `coach_evaluations` (있음) — 단, 작성 UI가 두 곳에 중복 |
| **단일 Coach 마스터** | Supabase `coaches_directory` (master) + Neon `Coach` (synced copy, drift 가능) |
| **단일 Project 마스터** | Supabase `business_plans` + Supabase `projects` + Neon `Project` (3중) |

---

## 3. Gap 분석 — 다이어그램의 lifecycle이 깨지는 5개 지점

### 🔴 Gap 1: ud-ops Project ↔ Supabase business_plans 다리 없음

```
ud-ops에서 Project 생성·기획 (RFP/커리큘럼/예산/제안서)
   ▼ "수주됐다" 시점에
   ✗ Supabase business_plans에 자동 생성 안 됨
   ✗ 따라서 bp_on_won 트리거도 발동 안 됨
   ✗ 따라서 projects/project_members 자동 생성 안 됨
   ✗ 따라서 코치들이 coaching-log에 들어가도 빈 화면
```

**원인**: ud-ops와 Supabase 간 양방향 동기화 코드 없음. ud-ops의 `/api/coaches/sync`는 **Coach만 단방향 pull**.

### 🔴 Gap 2: coach-finder도 수주 트리거 발동 못함

coach-finder ProjectsPage의 status enum은 `planning/active/completed`만 사용. `won`을 set 하지 않으므로 `bp_on_won` 트리거 (status='won'에만 발동) 작동 안 함.

→ coach-finder만 쓰는 PM도 코칭로그까지 흐름이 깨짐.

### 🔴 Gap 3: 평가 UI 중복 + schema 불일치

| 위치 | schema | 작성 가능 |
|---|---|---|
| coach-finder ProjectsPage | rating(1-5) + comment | PM |
| coaching-log BP 상세 (Phase C3) | rating_overall + 3차원(communication/expertise/reliability) + would_rehire + comment | PM |

→ PM이 어디서 평가할지 혼란. 한쪽에서 작성하면 다른 쪽 schema 항목이 NULL로 보임.

### 🟠 Gap 4: 평가 → tier 자동 갱신·RAG 가중치 없음

다이어그램: `평가 → coaches_directory.tier 자동 갱신 → 다음 사업 추천 가중치`

실제:
- `coach_evaluations` INSERT만 됨 (Supabase)
- `coaches_directory.tier` 갱신 트리거 없음
- coach-finder Cloud Run RAG가 평가 데이터 활용 X

→ 평가가 미래 추천에 영향 안 미침. "축적되지 않는 평가".

### 🟠 Gap 5: 인증·진입점 4중 분기

| 앱 | Auth | 사용자 식별 |
|---|---|---|
| coaching-log | Supabase Auth | profiles (admin/pm/coach) |
| coach-finder | Supabase Auth (Phase C4) | profiles 동일 |
| underdogs-hub | Supabase Auth | profiles 동일 |
| **ud-ops** | **NextAuth** (Google OAuth) | **별도 User 테이블** |

ud-ops의 `udpb@udimpact.ai`와 Supabase의 `udpb@udimpact.ai`는 **시스템상 다른 사용자**. evaluator_id 등의 ID 매칭 깨짐.

---

## 4. Bridge 계획 — Option 1·2·3 (사용자 결정대로 순차)

### Option 1 — ud-ops → Supabase business_plans 동기화 (P0, 가장 큰 효과)

#### 4.1.1 목표

ud-ops에서 Project를 만들거나 status가 변할 때마다 Supabase의 business_plans에 mirror INSERT/UPDATE. ud-ops가 "수주 완료"로 set하면 Supabase status='won' → bp_on_won 트리거 발동 → projects/project_members 자동 생성 → 코치들이 coaching-log로 이어받음.

#### 4.1.2 데이터 매핑

| Neon `Project` 필드 | Supabase `business_plans` 필드 | 비고 |
|---|---|---|
| `id` (cuid) | `legacy_firestore_id` (text) | ud-ops Project 식별자를 재활용 (Phase F4 컬럼) |
| `name` | `title` | |
| `client` | `client` | |
| `status` (DRAFT/PROPOSED/ACTIVE/COMPLETED 등) | `status` (draft/proposed/won/lost/cancelled/planning/active/completed) | 매핑 표 별도 |
| `projectStartDate`/`Date` | `target_start_date`/`target_end_date` | |
| `totalBudgetVat` | `total_budget` | |
| `rfpRaw` (text) | `description` | (요약하거나 원본 그대로) |
| 그 외 풍부한 필드 (rfpParsed/logicModel/impactGoal/strategicNotes/curriculumItems) | (없음) | **Supabase에 매핑 안 됨 — 향후 schema 확장 검토** |

ud-ops Project.coaches (CoachAssignment[]) → Supabase business_plan_coaches:
- `Coach.email`을 anchor로 Supabase `coaches_directory.email`과 매칭
- `coach_directory_id` 결정 → business_plan_coaches에 INSERT
- `payment_info` jsonb로 `agreedRate/totalFee/sessions` 매핑
- `task_summary`로 `notes` 매핑
- 매칭 실패 시 (이메일 없는 코치 등) 로그 + 건너뜀

#### 4.1.3 status 매핑 (중요)

| ud-ops `Project.status` | Supabase `business_plans.status` |
|---|---|
| DRAFT | draft |
| (PROPOSED 같은 단계 있다면) | proposed |
| **AWARDED / WON / 수주됨** | **won** ← 트리거 발동 트리거 |
| ACTIVE | active |
| COMPLETED | completed |
| LOST | lost |
| CANCELLED | cancelled |

ud-ops에는 ProjectStatus enum 정확히 무엇이 있는지 확인 필요. Coach Assignment confirmation 또는 별도 "수주 완료 표시" 액션을 트리거 시점으로 잡음.

#### 4.1.4 구현 옵션

| 옵션 | 방식 | 장점 | 단점 |
|---|---|---|---|
| **A1 (push)** | ud-ops API에서 Supabase service_role로 직접 INSERT/UPDATE | 단순, 양 시스템 자율 | ud-ops에 Supabase URL/SERVICE_ROLE 추가 필요 |
| A2 (queue) | ud-ops가 Vercel KV/Upstash에 메시지 → 별도 worker가 sync | 재시도 신뢰성 | 인프라 복잡도 |
| A3 (Cron) | Supabase에서 ud-ops Neon을 reverse-fetch | ud-ops 코드 무변화 | Cross-DB query 어려움 |

→ **A1 추천**. 작은 변경, 점진적.

#### 4.1.5 Trigger point (언제 sync?)

다음 시점 중 하나 (보수적):
- (a) ud-ops Project 신규 생성 시 즉시 mirror (안전)
- (b) ud-ops Project.status 변경 시 mirror
- (c) ud-ops에 "수주 처리" 버튼 추가 → 클릭 시에만 mirror (가장 명시적)

추천: **(a) + (b)**. Project 생성 즉시 Supabase에 도착 → 모든 후속 변경도 동기화 → 수주 시 status='won' set.

#### 4.1.6 작업 단위 (작은 단위 완성도)

1. ud-ops에 `lib/supabase-sync.ts` 작성 (Supabase service_role client)
2. env vars: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE` 추가
3. Project save hook (Prisma middleware 또는 API route 후처리): create/update 시 syncToSupabase 호출
4. 매핑 함수: udopsProjectToBpRow + udopsCoachAssignmentToBpcRow
5. 첫 1건 수동 테스트 → 검증 SQL → 잘 되면 자동화

작업 시간: ~3-4시간 + 테스트.

---

### Option 2 — coach-finder 수주 버튼 추가 (P0, 가장 작은 작업)

#### 4.2.1 목표

coach-finder ProjectsPage에서 PM이 "수주 완료" 버튼을 눌러 status='won' set → bp_on_won 트리거 → projects/project_members 자동 생성.

#### 4.2.2 변경 범위

1. `client/src/types/project.ts`:
   - `ProjectStatus` 타입에 `'won'` 추가 (선택적: `'lost'`, `'cancelled'`도)
   - `PROJECT_STATUS_LABELS`에 'won' 라벨 + color 추가
2. `client/src/contexts/ProjectContext.tsx`:
   - `normalizeStatus`에 'won' 통과 (기존 won→active 매핑 제거)
3. `client/src/pages/ProjectsPage.tsx`:
   - status 변경 dropdown/button에 '수주 완료 (won)' 추가
   - won으로 변경 시 확인 dialog: "코치들이 coaching-log에 자동 배정됩니다. 진행하시겠습니까?"
   - won set 후 refetch → project_id 채워졌는지 확인

작업 시간: ~2시간.

---

### Option 3 — 평가 UI 일원화 (P1, 다이어그램 정합성)

#### 4.3.1 결정 필요

평가 schema는 두 곳이 다름. 통합 방식 두 가지:

**Option 3-A**: coach-finder를 master, coaching-log는 read-only summary로
- coach-finder ProjectsPage 평가 UI를 4차원 + would_rehire로 확장 (coaching-log 항목 흡수)
- coaching-log BP 상세는 평가 작성 UI 제거, "이 BP의 평가 N건 보러가기 →" 링크만 (coach-finder URL)

**Option 3-B**: coaching-log를 master, coach-finder는 read-only로
- coaching-log Phase C3 평가 UI를 master로 (4차원 + would_rehire)
- coach-finder ProjectsPage 평가 UI를 read-only summary로 (작성 불가, 표시만)

→ 다이어그램은 ⑥ "PM 평가"를 **coach-finder에**. **3-A 추천**.

#### 4.3.2 3-A 작업 범위

1. coach-finder `client/src/pages/ProjectsPage.tsx` 평가 모달:
   - rating + comment → rating_overall + rating_communication + rating_expertise + rating_reliability + would_rehire + comment
   - 4 별점 + 1 체크박스 + textarea
2. coach-finder `ProjectContext.saveEvaluation`:
   - 새 fields를 Supabase coach_evaluations에 INSERT
3. coaching-log Phase C3:
   - 평가 작성 모달 제거
   - 평가 카드는 read-only summary 유지 (이미 있음)
   - "+ 새 평가" 버튼 → coach-finder URL로 redirect
4. 데이터 마이그레이션:
   - 기존 coach-finder의 단순 rating 평가는 rating_overall로 매핑 (기존 데이터 있으면)

작업 시간: ~4-5시간.

---

## 5. 확정된 진행 순서 (사용자 결정)

```
[Step 4 ✓] 통합 PRD 작성 (이 문서) — 완료
   ↓
[Option 1] ud-ops → Supabase business_plans mirror sync
   ↓ (검증)
[Option 2] coach-finder 수주 버튼
   ↓ (검증)
[Option 3] 평가 UI 일원화
   ↓
다이어그램의 자연스러운 lifecycle 작동
```

각 단계는 **작은 단위 완성도** 우선. 한 단계 끝나면 검증 후 다음.

---

## 6. 다음 단계 — Option 1 시작 시 첫 액션

1. ud-ops Project schema 정밀 확인 (특히 ProjectStatus enum 값들)
2. ud-ops에 Supabase service_role 키 환경변수 추가
3. `lib/supabase-sync.ts` 작성 (mapping 함수 + upsert 로직)
4. Project create/update API route에 sync hook 추가
5. 1건 수동 테스트 (ud-ops에서 Project 만든 후 Supabase Table Editor에서 business_plans 확인)
6. status='AWARDED' 시 status='won' mirror → coaching-log BP 탭에서 새 BP 확인 → 코치 배정 후 자동 트리거 작동 검증

---

## 부록 A. 미해결 이슈 (Option 1·2·3 외)

| 이슈 | 우선순위 | 비고 |
|---|---|---|
| Coach 데이터 ud-ops Neon ↔ Supabase 양방향 sync | P1 | 현재는 단방향 pull. 양쪽 admin이 수정 가능하면 drift |
| 평가 → tier 자동 갱신 트리거 | P1 | DB function + AFTER INSERT/UPDATE trigger |
| 수주 시 코치 알림 메일 | P1 | Resend 또는 SMTP 통합 |
| 인증 통합 (ud-ops도 Supabase Auth로) | P2 | 큰 작업, 사용자 영향 큼 |
| Hub에 ud-ops 카드 추가 | P2 | 작은 작업이지만 진입점 통일 |
| coach-finder Cloud Run RAG vs Supabase pgvector 결정 | P2 | dead 인프라 정리 |
| ud-ops 자체 진단 (DIAGNOSIS-2026-05-03)의 P0/P1 | P0/P1 | ud-ops 내부에서 진행 중 |
| 데이터 모델 일원화 (Coach·Project 중복 제거) | P3 | 큰 리팩토링, 장기 |

---

## 부록 B. 관련 문서 인덱스

| 문서 | 위치 | 역할 |
|---|---|---|
| **이 문서 (INTEGRATED_ARCHITECTURE.md)** | `coaching-log/docs/` | **4-앱 SSoT** (현재) |
| HANDOVER.md | `coaching-log/docs/` | 3-앱 (coaching-log/coach-finder/hub) 인수인계 |
| ARCHITECTURE.md | `coaching-log/docs/` | Phase 5-A 기준 기술 디테일 + 결정 로그 |
| PRD-v7.1.md | `ud-ops-workspace/` | ud-ops 단독 PRD (Express + Deep Track) |
| DIAGNOSIS-2026-05-03.md | `ud-ops-workspace/docs/` | ud-ops 자체 종합 진단 |
| HANDOVER.md | `ud-ops-workspace/` | ud-ops 인수인계 |

→ 향후 4-앱 통합 변경사항은 본 문서 갱신. 단독 앱 변경은 각 앱의 문서 갱신 + 본 문서에서 인덱싱.

---

## 부록 C. "전체 점검 제대로" 체크포인트 (2026-05-03 추가)

> **배경**: 2026-05-03 점검에서 `coach-finder/python-service/` (Cloud Run FastAPI 소스) 와 `coach-finder/ingest_data.py` (root 레벨 Python 스크립트) 를 누락. 원인: `client/` + `api/` 디렉터리만 보고 "Vite + Vercel Functions" 구조로 단정함. **빌드 로그의 `.vercelignore` 출력에 경로가 보였음에도** 폴더 내용을 확인 안 했음. 같은 실수를 반복하지 않기 위한 체크리스트.

### C.1 앱 단위 — 점검 시 반드시 확인할 항목

각 앱(coaching-log, coach-finder, underdogs-hub, ud-ops)마다 다음을 모두 본다:

#### (a) 디렉터리 토폴로지
- [ ] **repo root의 모든 디렉터리** 나열 (`ls -la`) — `src/`, `client/`, `api/` 같은 "보일 만한 것"만 보지 말고 **전부**
- [ ] root 레벨의 **숨겨지지 않은 모든 파일** 확인 — 특히 `*.py`, `*.sh`, `Dockerfile`, `__init__.py` 같은 "이 스택에 안 어울리는" 파일
- [ ] `.gitignore` / `.vercelignore` / `.dockerignore` — **무엇이 ignore 되는지가 곧 무엇이 존재하는지의 단서**
- [ ] `node_modules/`, `venv/`, `dist/`, `.next/`, `__pycache__/` 같은 빌드 산출물 디렉터리는 식별만 하고 무시

#### (b) 모든 패키지/의존성 매니페스트
- [ ] `package.json` (dependencies + devDependencies + scripts 전부)
- [ ] `pnpm-lock.yaml` / `package-lock.json` 존재 여부 (어느 매니저인지)
- [ ] `requirements.txt` / `Pipfile` / `pyproject.toml` (Python)
- [ ] `Dockerfile` / `docker-compose.yml`
- [ ] `vercel.json` — buildCommand, outputDirectory, rewrites, functions 설정
- [ ] `prisma/schema.prisma` (Prisma 사용 시)
- [ ] `supabase/migrations/*.sql` (Supabase 사용 시) — 모든 마이그레이션 파일

#### (c) 환경 변수
- [ ] `.env.example` / `.env.local` / `.env.production` 모든 변종
- [ ] Vercel Project 의 Production / Preview / Development 환경변수 (CLI: `vercel env ls`)
- [ ] **차원·모델·키 등 정확히 일치해야 하는 값들의 cross-app 매칭** (예: 임베딩 차원, Supabase project ref)

#### (c-2) **Supabase Dashboard 설정** (코드 밖에 사는 설정 — 점검 누락 빈번)
- [ ] **Authentication → URL Configuration** — Site URL + Redirect URLs allow-list (모든 앱의 prod + local dev URL 등록 필요. 누락 시 비밀번호 재설정·이메일 변경·OAuth·magic link 깨짐)
- [ ] **Authentication → Sign In / Providers** — 활성화된 provider 목록 (코드와 일치 여부)
- [ ] **Authentication → Email** — confirm 메일 템플릿, "Confirm signup" / "Reset password" 활성화 여부
- [ ] **Authentication → Rate Limits** — 이메일 발송 한도, OTP 한도
- [ ] **Authentication → Attack Protection** — Captcha 활성화, leaked password 검사
- [ ] **Database → Roles / RLS Policies** — 코드의 SQL 마이그레이션과 실제 DB 일치 여부
- [ ] **Storage → Buckets** — public / private 설정 + RLS policy
- [ ] **Project Settings → API → Project URL** — 코드의 SUPABASE_URL과 일치 여부
- [ ] **Project Settings → API → service_role 키 노출 여부** (절대 클라이언트 코드 / VITE_ prefix에 들어가면 안 됨)

#### (d) 외부 서비스 / 백엔드
- [ ] Vercel Functions (`api/*.ts` **AND `api/*.py`** — Python serverless도 가능) — 모두 나열
- [ ] **별도 호스팅 백엔드** (Cloud Run, Render, Fly, Railway 등) — repo 안에 소스가 있을 수 있음 (← 5-3 누락 사례)
- [ ] Supabase Edge Functions (`supabase/functions/*`)
- [ ] Cron jobs (Vercel Cron, GitHub Actions schedule 등)
- [ ] **각 함수가 실제로 호출되는지** 검증 — repo에 파일 있어도 dead code일 수 있음 (호출 grep으로 확인)

#### (e) 데이터 / 정적 자산 stale 검사
- [ ] 큰 JSON / CSV (`>100KB`) 의 마지막 수정일 — **2주 이상 오래되었으면 stale 의심**
- [ ] FAISS / Pinecone / pgvector 인덱스의 마지막 빌드 시점
- [ ] DB의 `*_updated_at` MAX 와 코드 디렉터리의 mtime 비교

#### (f) 배포 상태
- [ ] 배포된 URL (production + preview)
- [ ] 의도한 URL과 실제 URL 일치 여부 (cross-app 링크 깨짐 방지)
- [ ] 마지막 성공한 배포 commit + 날짜
- [ ] 마지막 실패한 배포가 있으면 에러 로그 확인

### C.2 Cross-app 점검 — 반드시 모든 앱 간 조합으로 확인

| 점검 항목 | 어디 vs 어디 | 어떻게 확인 |
|---|---|---|
| **Auth identity 동일성** | 4-앱 전부 | 같은 Supabase project ref · 같은 email = 같은 user · profiles.role 일관성 |
| **데이터 차원·스키마 호환** | DB 컬럼 ↔ 사용 코드 | 예: `vector(1536)` ↔ 임베딩 모델 출력 dim |
| **Cross-link URL** | A의 외부 링크 ↔ B의 실제 URL | 모든 `<a href>` / `redirectTo` / signup 안내 링크 |
| **공유 테이블 RLS** | DB policy ↔ 모든 사용처 | 어느 한 앱에서 SELECT 안 되면 끝 |
| **DB trigger의 타겟** | trigger 정의 ↔ 어느 앱에서 INSERT 발생 | `bp_on_won` 같은 자동 생성 트리거 |
| **동기화 hook의 커버리지** | sync 코드 ↔ 모든 mutation 경로 | 새 API 라우트 추가 시 sync 누락 위험 |

### C.3 점검 종료 기준 (Definition of Done)

다음 모두 만족해야 "전체 점검 완료" 라고 말할 수 있다:

1. ☐ 4개 앱 모두 §C.1의 (a)~(f) 6개 카테고리 전부 확인 완료
2. ☐ §C.2 의 6개 cross-app 점검 항목 모두 결과 기록
3. ☐ 발견된 문제는 본 문서의 §5 "5가지 핵심 gap" 섹션에 추가 또는 갱신
4. ☐ 결정 필요 항목(예: 임베딩 차원 미스매치)은 사용자에게 명시적 확인 요청
5. ☐ 점검 일자 + 점검자(누구·언제) 기록

### C.4 안티 패턴 — 다시는 하지 말 것

- ❌ "중요한 디렉터리만 보면 되겠지" → 모든 root-level 디렉터리·파일을 본다
- ❌ "ignore 됐으니 신경 안 써도 됨" → ignore된 것이 곧 존재하는 것의 단서
- ❌ "외부 호스팅이라 repo에 없겠지" → repo 안에 Cloud Run / Render / Fly 소스 있을 수 있음
- ❌ "차원 같겠지" / "스키마 같겠지" → 명시적으로 숫자·타입 비교
- ❌ "agent 한테 시켜야지" → 사용자 명시 요청: 직접 본다
- ❌ "DB 마지막 업데이트 안 봐도 됨" → 정적 데이터 stale 여부는 결과 정확도에 직결

---

---

## §6. 2026-05-03 작업 영구 기록 (Phase C2 + D1+D2+D3 + 후속 정리)

### 6.1 Phase C2 (coach-finder) — Cloud Run → Vercel native 추천

| 단계 | 내용 | Commit |
|---|---|---|
| **Step 1** | Supabase `coaches_directory.embedding` 800/800 채움 (`gemini-embedding-001`, 1536 dim Matryoshka). `tools/embed-coaches.mjs` + `verify-embeddings.mjs` 추가. RPC `search_coaches_by_embedding` self-match 1.0000 확인. | `ca93e76` |
| **Step 2-3** | `api/_lib/recommend.ts` + `api/recommend/index.ts` + `api/recommend/stream.ts`. Home.tsx 클라이언트는 `/api/recommend(.stream)` 호출로 교체. | `ca93e76` |
| **Step 6** | `tools/verify-recommend.mjs` local smoke test (12s, top-5 sim 0.68-0.69). | `ca93e76` |
| **Build fix #1** | `tsconfig.json` `include` 에 `api/**/*.ts` 추가. `@google/generative-ai` devDep → deps 이동. `TaskType` enum + `outputDimensionality` 타입 단언 우회. | `3c0272f` |
| **Build fix #2** | Node ESM strict mode 대응 — internal import 4개에 `.js` 확장자 명시. | `8610fe4` |
| **Step 4-5** | Cloud Run / dead code / stale 일괄 삭제 — `python-service/`, `api/index.py`, `__init__.py`, `ingest_data.py`, `client/src/data/coaches*.json`, `사용자_가이드.md`, `ideas.md`, `todo.md`. `coachesFallback` import 제거 (빈 배열 fallback). `.env.example` 에서 `VITE_API_BASE_URL` 제거 + `GEMINI_API_KEY` 카테고리 추가. | `6814e76` |

데이터 흐름 변화:
- **Before**: `Home.tsx → Cloud Run FastAPI (gemini-2.5-flash + FAISS embedding-001 768d) → coaches_db.json (2개월 stale)`
- **After**: `Home.tsx → /api/recommend (Vercel Node) → Gemini chat + embedding-001 1536d → Supabase pgvector RPC → coaches_directory (live)`

### 6.2 Phase D (coaching-log) — 모바일 UX + STT 녹음 + PM 가시성 분리

| 단계 | 내용 | Commit |
|---|---|---|
| **D1** | 모바일 헤더·탭 잘림 fix. `nav-tabs` 가로 스크롤 + `scroll-snap` + 활성탭 자동 visible. 모바일에서 lang-switch / CSV 숨김. 사용자명 ellipsis. | `f9f51b3` |
| **D2** | STT 음성 녹음 통합 (`gemini-2.5-pro` Native Audio). `MediaRecorder` API + base64 + inline_data. 기존 textarea 붙여넣기 흐름 그대로 유지. 자동 정지 (7분 ceiling, Vercel 4.5MB body limit). `vercel.json` `functions.maxDuration: 60`. | `25f2968` |
| **D3-a** | RLS PM 가시성 분리 — `is_admin_or_pm()` 호출을 `is_admin() OR is_pm_of_project(id)` 로 좁힘. 새 helper `is_pm_of_project(uuid)`. `project_members.role` enum: `lead_coach` 제거 + `pm` 추가 (협업 PM). `coaches_directory_history.SELECT` admin only 로 좁힘. Supabase migration `20260503_phase_d3_pm_isolation.sql` 수동 적용. | `8a2fa96` |
| **D3-b** | 클라이언트 `isAdmin` / `isPM` / `canManageProjects` 변수 분리. PM 요약 카드 (활성 사업 / 코치 / 누적 세션). 빈 상태 메시지 "관리자에게 문의" → "담당 PM에게 문의". | `f6c81fa` |
| **D3-c** | 코치 배정 흐름 재설계 — coach-finder `coaches_directory` 가 마스터. `linked_user_id` 즉시 사용. 미가입 검출 시 inline 초대 영역 (✉️ Magic Link 발송 + 🔗 가입 URL 복사). 검색 결과 0건일 때 coach-finder 등록 링크 안내. | `1917529` |

### 6.3 권한 매트릭스 (D3 적용 후 확정)

| 권한 | admin | PM | coach |
|---|---|---|---|
| 모든 프로젝트 SELECT | ✓ | ✗ | ✗ |
| 본인 PM 프로젝트 SELECT (created_by) | ✓ | ✓ | ✗ |
| 프로젝트 멤버 (project_members) SELECT | ✓ | ✓ (본인 프로젝트만) | ✗ |
| 본인 멤버인 프로젝트 SELECT | ✓ | ✓ | ✓ |
| coaching_logs INSERT 본인 | ✓ | ✓ | ✓ |
| 새 프로젝트 INSERT | ✓ | ✓ | ✗ |
| 프로젝트 UPDATE/DELETE | ✓ (전체) | ✓ (created_by 만) | ✗ |
| project_members INSERT (코치 배정) | ✓ | ✓ (본인 프로젝트) | ✗ |
| coaches_directory 편집 | ✓ | ✗ (read only) | ✓ (본인 row만) |
| profiles role 변경 | ✓ | ✗ | ✗ |
| coaches_directory_history (audit) | ✓ | ✗ | ✗ |

### 6.4 점검 누락 → 발견 → 학습 사항 (부록 C 보강)

이번 작업으로 발견 + 부록 C 에 영구 반영:
- (a) 디렉터리 토폴로지 — repo root 의 **모든** 디렉터리·파일 확인 (python-service 누락 사례)
- (b) `tsconfig.json` 의 `include` 가 실제 빌드 대상을 모두 포함하는지 (Vercel 별도 typecheck)
- (c-2) **Supabase Dashboard 설정** — URL Config / providers / email / RLS / storage 등 코드 밖 설정 점검
- (d) `api/` 안에 `.py` 파일도 가능 + 함수 실제 호출 여부 grep
- (e) JSON·CSV stale mtime 검사
- (f) ESM strict (`"type": "module"`) 환경에서 internal import `.js` 확장자 강제
- (g) npm package 가 devDeps 가 아닌 deps 에 들어가야 runtime require 가능 (Vercel functions)

### 6.5 사용자 후속 (코드 외부)

| 항목 | 상태 |
|---|---|
| Vercel coach-finder env: `VITE_FIREBASE_*` 6개 + `VITE_API_BASE_URL` 제거 | 사용자 작업 |
| `.env.local` 에서 `VITE_API_BASE_URL` 직접 삭제 | 사용자 작업 |
| GCP Console `underdogs-ai-backend` Cloud Run 비활성화 (선택) | 사용자 작업 |
| Supabase URL Config redirect URLs 에 `ud-hub.vercel.app/*` `**` 추가 | 사용자 작업 (Hub 배포 시) |
| Hub 배포 (vercel deploy --prod) | 사용자 작업 |

---

**문서 끝.** Option 1 시작 시 본 문서의 §4.1 매핑 표를 starting point로 사용. 점검 작업 시 부록 C 체크리스트 사용. 작업 영구 기록은 §6 에 단계별 추가.
