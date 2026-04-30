# Underdogs · 코칭 운영 시스템 아키텍처

> **단일 진실 원본 (Single Source of Truth)** for 세 앱 + 공유 백엔드
>
> | 항목 | 값 |
> |---|---|
> | 버전 | v1.0 (2026-04-27) |
> | 상태 | Active — 현재 구현 진행 중 |
> | 관리 주체 | udpb@udimpact.ai |
> | 갱신 시점 | 각 Phase 완료 시 + 구조적 결정 시 |

이 문서는 언더독스 코칭 운영의 **세 앱 + 하나의 공유 DB** 구조, 데이터 흐름, 권한, 진행 상황을 한 화면에서 파악하기 위한 문서입니다. 새 작업 시작 전 **반드시** 이 문서부터 검토하세요.

---

## 0. 5분 요약

언더독스는 정부·기업 위탁사업을 받아 **창업팀을 인큐베이팅**합니다. 그 운영을 세 단계로 분리한 앱이 다음과 같이 협업합니다:

```
[기획] ud-ops          → [매칭] coach-finder  → [수주] (자동 트리거)  
                                                       ↓
                       [평가] coach-finder    ←  [운영] coaching-log
```

세 앱은 모두 **하나의 Supabase 인스턴스**(공통 DB + Auth + Storage)를 공유합니다. 모든 비즈니스 로직(권한·검색·트리거)은 PostgreSQL/RPC 레벨에 두어 향후 **AWS 이관 시 거의 무손실로 옮길 수 있도록** 설계되었습니다.

---

## 1. 세 앱의 역할

```
                    ┌─────────────────────────────────────────┐
                    │         📦 SUPABASE (공통 DB)            │
                    │                                         │
                    │  profiles    · projects · project_members│
                    │  coaching_logs   ·  coaches_directory    │
                    │  business_plans  ·  coach_evaluations    │
                    │  embeddings (pgvector) · audit logs      │
                    │  RPC: search_coaches_by_embedding 등     │
                    │  RLS: admin/pm/coach 3-tier              │
                    └────┬────────────┬────────────┬───────────┘
                         │            │            │
              ┌──────────┘            │            └──────────┐
              ▼                       ▼                       ▼
   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
   │   🏢 ud-ops          │  │   🔍 coach-finder     │  │   📓 coaching-log     │
   │   사업 기획           │  │   코치풀 + 매칭/평가   │  │   세션 기록·분석      │
   │                      │  │                      │  │                      │
   │ ① 사업 제안서 작성    │  │ ② PM 코치 검색        │  │ ④ 코치 일지 작성     │
   │   · RFP 분석         │  │   · RAG 의미 검색      │  │   · STT → AI 추출  │
   │   · 커리큘럼 설계     │  │   · 필터·분야         │  │   · 내러티브        │
   │   · 코치 풀 선정      │  │ ③ 계약·온보딩         │  │   · evidence       │
   │   · 예산·임팩트       │  │   (체결 워크플로)     │  │ ⑤ 시계열 분석        │
   │   · 제안서 PDF       │  │ ⑥ 종료 후 평가        │  │   · 대시보드        │
   │                      │  │   (PM의 코치 평가)    │  │   · PDF/Word 리포트  │
   │ 사용자: PM           │  │ 사용자: PM·Admin     │  │ 사용자: 외부 코치     │
   │ 스택: Next.js        │  │ 스택: React + Node + │  │ 스택: Vanilla HTML   │
   │       (자체 DB 임시) │  │       Python (FAISS) │  │       + Vercel API   │
   └──────────┬───────────┘  └──────────┬───────────┘  └──────────────────────┘
              │                         │                         ▲
              │                         │                         │
              └─── 수주 시 자동 트리거 ──┴── projects + project_members 자동 생성 ─┘
```

라이프사이클: ① → ② → ③ → 🎯수주 → ④ → ⑤ → ⑥

---

## 2. 권한 — 3-tier RBAC

### 사용자 유형

| Role | 누구 | 어디 로그인 | 자동 부여 조건 |
|---|---|---|---|
| **admin** | 시스템 운영자 | 셋 다 | `udpb@udimpact.ai` / `udpb@underdogs.co.kr` (하드코딩) |
| **pm** | UDI 직원 | ud-ops · coach-finder · coaching-log | `*@udimpact.ai` / `*@underdogs.co.kr` (도메인 매칭, 가입 시 자동) |
| **coach** | 외부 코치 | coaching-log만 | 그 외 모든 가입자 (default) |

**부여 흐름**: Supabase Auth 가입 → 트리거 `handle_new_user()` 가 도메인 보고 자동 분류 → `profiles.role` 채움.
관리자가 명시적으로 변경: `coaching-log` 의 **사용자 관리** 탭(admin 전용).

### 권한 매트릭스

| 리소스 | Admin | PM | Coach |
|---|---|---|---|
| `profiles` (사용자) | 전부 read · role 변경 | 전부 read · role 변경 ❌ | 본인만 read |
| `coaches_directory` | 전부 CRUD | 전부 read · 평가 작성 | 본인 row만 update (linked) |
| `coaches_directory_history` | 전부 read | 전부 read | ❌ |
| `business_plans` (ud-ops) 📋 | 전부 read/write | 본인 담당 사업 read/write | ❌ |
| `projects` | 전부 CRUD | 본인 만든 것 CRUD · 그 외 read | 배정된 것만 read |
| `project_members` | 전부 CRUD | 본인 프로젝트에서 CRUD | 본인 행만 read |
| `coaching_logs` | 전부 read | 전부 read | 본인 작성 + 배정된 프로젝트 read · 본인만 CRUD |
| `coach_evaluations` 📋 | 전부 read | 담당 프로젝트 코치 평가 | 본인 받은 평가 read |

📋 = 향후 도입 예정 (Phase B)

핵심 원칙:
- **Admin은 system-wide 가시성**을 갖되 코치의 일지·평가는 **read-only** (감사용, 코치 자율 보장)
- **PM은 admin-light** — 사용자/디렉토리 마스터 데이터 변경은 못 함
- **Coach는 본인 데이터에만 write**

DB-level 강제: 모든 정책은 PostgreSQL **RLS** 로 enforce. 클라이언트 코드를 조작해도 우회 불가.

---

## 3. End-to-End 라이프사이클

### T0 — 사업 기획 (ud-ops)

PM이 새 사업 기획을 시작:

```
ud-ops Step 1: RFP 업로드/분석 → rfp_data
       Step 2: 커리큘럼 설계   → curriculum_data
       Step 3: 코치 배정        ───────────────────┐
                                                  │ 
              Supabase RPC 호출:                  │
              search_coaches_by_embedding(        │
                query_embedding,                  ▼
                filters: { tier, expertise,    pgvector
                           regions, industries }) similarity
              → top N 코치                        search
              → PM이 최종 선정                    
                                                  │
       Step 4: 예산 산정                          │
       Step 5: 임팩트 매핑                        │
       Step 6: 제안서 PDF 생성                    │
                                                  │
       business_plans.status = 'submitted' ─── DB 저장
```

### T1 — 수주 (자동 트리거)

```
PM: business_plans.status = 'awarded'
                ↓
        DB Trigger (Supabase)
                ↓
   1. INSERT INTO projects
        (name, business_plan_id, start_date, end_date, status='active')
   2. INSERT INTO project_members
        (project_id, user_id, role) for each recommended coach
   3. (선택) 코치들에게 알림 메일
```

### T2 — 운영 (coaching-log)

```
코치 로그인 → coaching-log
       ↓
[프로젝트] 탭에 자동 배정된 프로젝트 보임
       ↓
프로젝트 진입 → 팀 추가 → 세션 기록
       ↓
STT transcript paste → Gemini 3.1 Pro
       ↓
narrative + 18 structured fields + evidence + last_done_rate auto
       ↓
저장 → DB → coaches_directory 임베딩과는 무관
```

PM은 동시에 coaching-log 대시보드로 **진행 상황 모니터링**:
- 팀별 시계열 (stage 변화 · energy 추이 · 메트릭 trend)
- 이행률 누적
- 반복 blocker 경고
- PDF/Word 리포트 출력

### T3 — 종료 + 평가 (coach-finder)

```
PM: project.status = 'closed'
       ↓
coach-finder 평가 화면
       ↓
각 코치별 평가:
  · 정량 (자동 계산): 출석률, 리포트 품질, 이행률 평균
  · 정성: 5-point 평가 + 코멘트
       ↓
INSERT INTO coach_evaluations
       ↓
coaches_directory.tier 자동 재계산 (누적 평균 기반)
       ↓
다음 사업 추천 알고리즘이 새 tier 반영
```

이 사이클이 반복되며 **코치풀의 품질이 시간에 따라 자체 정제** 됩니다.

---

## 4. 공유 데이터 모델

### 4.1 핵심 테이블 (현재 상태 표시)

상태 범례: ✅ live · ⚠ live but partial · 📋 planned

```
auth.users  ✅
└─ Supabase Auth 관리. id, email, raw_user_meta_data

profiles  ✅
├─ id (FK auth.users.id)
├─ email · display_name
├─ role : 'admin' | 'pm' | 'coach'      ← Phase 5-A 적용 후 3-tier
└─ created_at

projects  ✅
├─ id · name · description
├─ status: 'active' | 'closed' | 'archived'
├─ start_date · end_date
├─ created_by (FK profiles.id) ── 해당 PM
├─ business_plan_id (FK business_plans.id) 📋  ← 수주 시 자동 채움
└─ created_at · updated_at

project_members  ✅
├─ project_id · user_id (FK profiles.id)
├─ role: 'lead_coach' | 'coach' | 'observer'
└─ added_by · added_at

coaching_logs  ✅
├─ id · project_id (FK projects, nullable)
├─ coach_id (FK profiles)
├─ team_name (string) ⚠ ← 1급 entity 아님, 추후 검토
├─ session_num · date · founder_name
├─ session_type · stage · stage_detail · main_topic
├─ last_commitment · last_done · last_number · last_result
├─ last_done_numerator · last_done_denominator · last_done_rate (자동)
├─ real_issue · blocker_type · ai_used
├─ next_action · next_deadline · next_evidence
├─ next_checkin · next_checkin_date · next_checkin_channel
├─ session_note · watch_next · energy
├─ metrics (jsonb)
├─ narrative_summary (Phase 1)
├─ extraction_evidence (jsonb, Phase 1)
├─ transcript_raw · ai_extracted (Phase 1)
└─ embedding 📋 (선택, 추후)

coaches_directory  ✅  ── 800+ 코치 마스터풀
├─ id · external_id (sync anchor)
├─ name · email · phone · gender
├─ location · regions (text[]) · country
├─ organization · position
├─ industries · expertise · roles · tags (text[] 다중)
├─ language · overseas · overseas_detail
├─ intro · career_history · education
├─ underdogs_history · current_work · tools_skills
├─ career_years · career_years_raw
├─ photo_url · photo_filename
├─ tier · category · business_type
├─ availability_status: available | limited | unavailable
├─ max_concurrent_projects
├─ linked_user_id (FK auth.users.id, nullable)  ← 코치가 가입할 때 자동 매칭
├─ status: 'active' | 'inactive' | 'archived' | 'draft'
├─ embedding (vector 1536) ← Gemini 임베딩
├─ embedding_source_hash · embedding_updated_at · embedding_model
├─ notes (운영 메모, 내부)
├─ created_at · updated_at · last_synced_at

coaches_directory_history  ✅  ── 변경 이력 자동 기록
├─ coach_id · op (UPDATE/DELETE)
├─ changed_by · changed_at
└─ snapshot (jsonb, 변경 직전 OLD 행)

business_plans  📋 (Phase B에서 도입)
├─ id · name
├─ status: 'draft'|'submitted'|'awarded'|'rejected'
├─ rfp_data · curriculum_data · budget_data · impact_data (jsonb)
├─ pm_owner_id (FK profiles.id)
├─ recommended_coaches (uuid[] → coaches_directory.id)
├─ awarded_at · project_id (FK projects, nullable)
└─ created_at · updated_at

coach_evaluations  📋 (Phase B에서 도입)
├─ id · project_id · coach_id · evaluator_id (PM)
├─ rating_overall · rating_session_quality · rating_commitment · rating_communication
├─ comment · would_recommend
└─ created_at
```

### 4.2 RPC (PostgreSQL Functions)

| 함수 | 용도 | 호출자 |
|---|---|---|
| `is_admin()` `is_pm()` `is_admin_or_pm()` | RLS 정책 헬퍼 (재귀 방지용 SECURITY DEFINER) | DB 내부 |
| `is_project_member(uuid)` | 사용자가 특정 project_id의 멤버인지 | RLS |
| `search_coaches_by_embedding(embedding, count, filters...)` | RAG 코치 매칭 (코사인 유사도 + 룰필터) | ud-ops · coach-finder |
| `handle_new_user()` | 가입 시 profiles 자동 생성 + role 자동 부여 (도메인 매칭) | Auth trigger |
| `coaches_audit()` | coaches_directory 변경 시 history 자동 기록 | DB trigger |
| `coaches_invalidate_embedding_if_profile_changed()` | 코치 정보 수정 시 embedding hash 무효화 → 다음 배치에서 재생성 | DB trigger |
| `autolink_coach_on_profile()` | 코치가 가입 시 이메일 매칭으로 directory row 자동 연결 | DB trigger |

### 4.3 Storage

| Bucket | Public? | 용도 |
|---|---|---|
| `coach-photos` | public read | 코치 프로필 사진 (admin 업로드, 모두 조회) |

---

## 5. 인터-앱 경계 (현재 상태)

```
                          ┌──────────────┐
                          │   Supabase   │
                          └──────┬───────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     │                           │                           │
     ▼                           ▼                           ▼
┌─────────┐               ┌──────────────┐            ┌──────────────┐
│ ud-ops  │               │ coach-finder │            │ coaching-log │
└─────────┘               └──────────────┘            └──────────────┘
   ⚠ 미연결                  ⚠ JSON 사용 중             ✅ 통합 완료
   (자체 DB 별도)            (Supabase 이전 대기)        Phase A·B·D·E
```

| 앱 | Supabase 연결 | RAG RPC 호출 | 상태 |
|---|---|---|---|
| **coaching-log** | ✅ profiles, projects, project_members, coaching_logs, coaches_directory, business_plans, business_plan_coaches, coach_evaluations, storage | ❌ (의도적 — coach-finder 영역) | **production ready** |
| **coach-finder** | ✅ coaches_directory, business_plans, business_plan_coaches, coach_evaluations, profiles (Auth) — **Firebase 0%** (Phase F 완료) | 📋 Phase C2 | **production ready** (RAG UI 대기) |
| **underdogs-hub** | ✅ profiles (Auth만) | — | local commit (배포 대기) |
| **ud-ops** | ❌ 자체 DB | 📋 Phase D | 통합 대기 |

---

## 6. 단계별 진행 (로드맵)

### ✅ 완료된 Phase

| Phase | 내용 | 산출물 |
|---|---|---|
| **0** | coaching-log 초기 구축 (vanilla HTML + Vercel + Supabase) | DB 스키마, 기록 폼, 목록, 상세 |
| **1** | STT → AI 추출 (Claude → Gemini로 후속 이전) | extract-session API, narrative + evidence |
| **1.5** | 스칼라 데이터화 (이행률, checkin date, metrics trend) | Phase 1.5 마이그레이션 |
| **2** | 팀 타임라인 대시보드 | KPI · 메트릭 차트 · 이행률 바 · blocker 변천 |
| **3** | PDF/Word 리포트 출력 | Underdogs 디자인 가이드 적용 |
| **4-A** | 권한 모델 (admin · coach 시작) | profiles + RLS |
| **4-B** | 프로젝트 + 멤버 | projects · project_members + RLS |
| **4-D** | 코치 디렉토리 통합 | coaches_directory (800명 import) + audit + storage |
| **4-E** | pgvector RAG 기반 | embedding 컬럼 + RPC + Gemini 임베딩 스크립트 |
| **5-A** | PM 역할 추가 (3-tier) | profiles.role 'pm' + RLS 재정비 + 사용자 관리 화면 |

### 🚧 진행 / 다음 Phase

| Phase | 내용 | 우선순위 | 시점 |
|---|---|---|---|
| **5-A polish** | 미배정 세션 → 프로젝트 이동 UI · 폼 컨텍스트 배너 · 상세뷰 프로젝트 표시 | 🔥 즉시 | 진행 중 |
| **C1** | coach-finder 백엔드 Supabase 연결 (JSON → coaches_directory) | 🔥 다음 | |
| **C1** | coach-finder coach data (Supabase 직접 fetch) | ✅ 완료 | — |
| **B/5-B** | business_plans + business_plan_coaches + coach_evaluations 스키마 + 수주 트리거 | ✅ 완료 | — |
| **C3** | coaching-log BP 상세에 코치 평가 CRUD UI | ✅ 완료 | — |
| **C4** | coach-finder Firebase Auth → Supabase Auth | ✅ 완료 | — |
| **F** | coach-finder Firebase 0% (Firestore overlay/projects → Supabase, firebase 패키지 제거) | ✅ 완료 | — |
| **H1/H2** | underdogs-hub 앱 + 양쪽 앱 헤더 Hub 링크 | 🟡 코드 완료, 배포 대기 | 사용자 액션 |
| **C2** | coach-finder PM RAG 검색 UI (pgvector → search_coaches_by_embedding RPC) | 🟡 | F 후 |
| **C5** | coach-finder에 코치 평가 read-only aggregated view (코치별 평균 별점) | 🟡 | C2 병행 |
| **H3** | 진짜 SSO (cookie subdomain or OAuth handoff) | 🟡 | 도메인 정리 후 |
| **D** | ud-ops 부트스트랩 — BP+평가 CRUD를 coaching-log에서 이전 | 🟡 | H3 이후 |
| **Z** | **AWS 이관** (전체 안정화 후 최종) | 🏁 마지막 | 모든 Phase 완료 후 |

### 🏁 Phase Z — AWS 이관 (최종)

이관 시 작업:

| 컴포넌트 | Supabase | AWS | 작업량 |
|---|---|---|---|
| DB | Supabase Postgres | RDS for PostgreSQL (pgvector) | `pg_dump` → restore |
| Auth | Supabase Auth | Cognito | 사용자 마이그레이션 |
| Storage | Supabase Storage | S3 + CloudFront | 파일 복사 + URL 정규식 치환 |
| Serverless | Vercel | Lambda + API Gateway 또는 ECS | 코드 거의 그대로 |
| Frontend | Vercel | CloudFront + S3 또는 Amplify | 정적 자원 이전 |
| RPC/RLS/트리거 | PostgreSQL 표준 | PostgreSQL 표준 | 변경 없음 ✓ |

**AWS-friendly 설계 원칙 준수 중**:
- 모든 비즈니스 로직 = PostgreSQL RPC (Supabase Edge Functions 사용 X)
- Storage URL = relative path 또는 정규식 치환 가능
- 서버리스 = Vercel API (Lambda 호환 코드 패턴)
- Realtime 의존 X

---

## 7. 기술 스택 요약

| 레이어 | 도구 |
|---|---|
| Database | Supabase (PostgreSQL 16 + pgvector + RLS) |
| Auth | Supabase Auth (이메일/비밀번호 + GitHub OAuth) |
| Storage | Supabase Storage (`coach-photos` public bucket) |
| Serverless | Vercel (`api/extract-session.js`) |
| AI 모델 | Google Gemini 3.1 Pro (chat) · gemini-embedding-001 (1536-dim) |
| 폰트 | Pretendard (한국어) + Poppins (브랜드 italic) |
| 리포트 PDF | 브라우저 print + `@media print` CSS |
| 리포트 Word | docx@8.5 (UMD CDN, lazy-load) |
| 외부 의존성 | 없음 (브라우저 내장 + Supabase SDK + docx) |

---

## 8. 핵심 결정 로그

| 일자 | 결정 | 이유 |
|---|---|---|
| 2026-04-15 | Vanilla HTML 단일 파일 | 빠른 반복 + 외부 의존 최소 |
| 2026-04-21 | Anthropic Claude → Google Gemini 3.1 Pro | 비용·결제 카드 부담 제거 + 한국어 multilingual 우수 |
| 2026-04-23 | OpenAI 임베딩 → Gemini gemini-embedding-001 | 무료 tier + Document/Query 구분 (RAG 정확도 ↑) |
| 2026-04-23 | 코치 디렉토리 = Supabase 단일 master | coach-finder의 JSON은 seed 용도로만, 향후 deprecate |
| 2026-04-24 | RAG 검색 알고리즘 owner = Supabase RPC (option b) | 두 앱이 동등하게 호출, 로직 중복 X |
| 2026-04-27 | 3-tier 권한 (admin · pm · coach) | UDI 직원과 외부 코치 분리, 도메인 자동 부여 |
| 2026-04-27 | AWS 이관 = 최종 Phase Z | 안정화 후 마지막에. 지금부터 AWS-friendly 설계 |
| 2026-04-27 | **팀 = string (별도 entity 승격 X)** | 동시 진행 2개 프로젝트가 서로의 코칭 기록을 공유할 필요가 없음. `coaching_logs.team_name`을 프로젝트 scope 내에서만 의미 있게 유지. 향후 시계열 통합 분석 필요해지면 재검토 (ud-ops 통합 시점) |

---

## 9. 알려진 이슈 / 결정 대기

| # | 이슈 | 상태 |
|---|---|---|
| 1 | 미배정 세션 → 다른 프로젝트 이동 UI 부재 | 🔥 Phase 5-A polish에서 해결 예정 |
| 2 | 프로젝트 컨텍스트 배너가 `viewForm` / `viewDetail`엔 없음 | 🔥 Phase 5-A polish |
| 3 | coach-finder JSON과 Supabase 데이터 이중화 | 🟡 Phase C1에서 해소 |
| 4 | (보류) 같은 창업팀이 여러 프로젝트 거치는 시계열 통합 분석 | ⏸ ud-ops 통합 시점 또는 실제 운영에서 필요해지면 재검토. 현재는 프로젝트 scope 내 분석만 지원 |

---

## 10. 작업 흐름 (운영 모드)

이 문서를 가진 후 모든 작업은 다음 패턴:

```
[사용자] 새 요구사항 / 이슈 보고
    ↓
[관리자(Claude)] 어느 Phase에 해당하는지, 영향 범위 파악
    ↓
[관리자] 명세 작성 (스코프, 입출력, 제약)
    ↓
[에이전트] 위임 받아 구현
    ↓
[관리자] 결과 검수
    ↓
[배포] vercel deploy --prod
    ↓
[사용자] E2E 검증
    ↓
[관리자] 이 문서 갱신 (변경 사항이 있으면)
```

---

## 부록 A. 마이그레이션 이력 (Supabase)

`supabase/migrations/` 안의 SQL 파일들. 적용 순서:

| 파일 | 내용 |
|---|---|
| `20260413_create_coaching_logs.sql` | 초기 coaching_logs 테이블 + open RLS |
| `20260417_add_transcript_raw.sql` | transcript_raw, ai_extracted 컬럼 추가 |
| `20260421_add_narrative_and_evidence.sql` | narrative_summary, extraction_evidence (Phase 1) |
| `20260421_phase15_scalar_fields.sql` | next_checkin_date/channel, last_done_rate 등 |
| `20260421_phase4a_roles_rls.sql` | profiles + admin/coach RLS |
| `20260423_phase4b_projects.sql` | projects + project_members |
| `20260423_phase4d_coaches_directory.sql` | coaches_directory + audit + storage |
| `20260424_phase4e_pgvector_rag.sql` | pgvector + RPC |
| `20260427_phase5a_pm_role.sql` | PM 역할 + 3-tier RLS |

향후 추가 예정:
- `business_plans` + `coach_evaluations` (Phase B)
- `teams` 테이블 (5번 이슈 결정 시)

---

## 부록 B. 다른 두 앱 통합 가이드

### coach-finder 통합 (Phase C1+C4+F 완료)
- 코치 풀: `python-service/coaches_db.json` → `coaches_directory` ✅
- 인증: Firebase Auth → Supabase Auth ✅ (Phase C4)
- 데이터: Firestore overlay/projects → `coaches_directory` 직접 + BP 테이블들 ✅ (Phase F)
- 패키지: `firebase` runtime dep 제거됨 (`firebase-admin`만 devDep, 일회성 마이그레이션용)
- RAG 검색: 자체 FAISS → `search_coaches_by_embedding` RPC (Phase C2 대기)

### ud-ops 통합 시 (Phase D)
- 기존 자체 DB는 일단 유지 (자체 도메인 데이터)
- **공유 영역**:
  - 코치 추천 → `search_coaches_by_embedding` RPC 호출
  - business_plans (Phase B에 도입) → Supabase에 미러 저장
  - 수주 시 → 트리거로 projects 자동 생성
- 인증: ud-ops도 Supabase Auth로 일원화 시 PM이 모든 앱에서 SSO

---

## 부록 C. 이 문서 갱신 책임

이 문서는 **living document**. 새 결정 / 새 Phase 완료 / 구조 변경 시 함께 갱신.

각 Phase 완료 시:
- 섹션 6 (로드맵) 의 진행 상태 업데이트
- 섹션 4 (데이터 모델) 의 새 테이블·컬럼 반영
- 섹션 8 (결정 로그) 에 새 결정 추가
- 섹션 9 (이슈) 에서 해결된 항목 제거 / 새 이슈 추가
- 부록 A (마이그레이션 이력) 에 신규 SQL 파일 추가

다른 두 앱 (`underdogs-coach-finder`, `ud-ops-workspace`)에 이 문서를 복제할 경우, **coaching-log의 사본이 SoT**임을 헤더에 명시.
