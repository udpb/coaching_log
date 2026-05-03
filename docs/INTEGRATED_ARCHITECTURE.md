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
| **underdogs-hub** | (배포 보류) | 모든 사용자 | `C:/Users/USER/underdogs-hub` (GitHub repo 미생성) | Vanilla HTML + Supabase Auth | 코드 완료, 배포 대기 |

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

**문서 끝.** Option 1 시작 시 본 문서의 §4.1 매핑 표를 starting point로 사용.
