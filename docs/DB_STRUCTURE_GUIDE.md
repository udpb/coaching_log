# Coaching Log — DB 테이블·컬럼 사전

> 출처: `supabase/migrations/*.sql` (PostgreSQL 16 + pgvector · Supabase) · 마이그레이션 44개를 시간순으로 누적 적용한 **최종 상태**
> 표기: 🔑 PK(기본키) · 🔗 FK(다른 테이블 연결) · ⭐ UK(고유값)
> 비고: 세 앱(coaching-log · coach-finder · ud-ops)이 **단일 Supabase 인스턴스를 공유**합니다. 사용자 ID는 모두 Supabase 내장 `auth.users`를 가리킵니다. (총 17개 테이블)

---

## A. 코칭 일지 도메인

### coaching_logs — 코칭 세션 기록 (핵심 테이블)
> 코치가 창업팀 코칭 세션을 기록. 음성(STT) transcript를 Gemini가 내러티브 + 구조화 필드 + 근거로 추출해 저장.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | bigint | 일지 고유 ID |
| created_at | timestamptz | 생성 시각 |
| date | text | 세션 일자 |
| coach | text | 코치 이름(자유 텍스트) |
| coach_id 🔗 | uuid | → auth.users.id (작성 코치 · RLS 소유권 기준) |
| project_id 🔗 | uuid | → projects.id (소속 프로젝트) |
| team_name | text | 창업팀 이름 |
| founder_name | text | 창업가 이름 |
| session_type | text | 세션 유형 |
| session_num | integer | 세션 회차 |
| stage / stage_detail | text | 팀 단계 / 상세 |
| main_topic | text | 이번 세션 주요 주제 |
| last_commitment | text | 지난 세션 약속 |
| last_done | text | 지난 약속 이행 내용 |
| last_done_numerator / _denominator / _rate | numeric | 이행률 분자 / 분모 / 비율(0~1, 자동계산) |
| last_number / last_result | text | 지난 성과 수치 / 결과 |
| real_issue | text | 진짜 이슈·병목 |
| blocker_type | text | 블로커 유형 |
| ai_used | boolean | 창업팀의 AI 사용 여부 |
| next_action / next_deadline / next_evidence | text | 다음 액션 / 마감 / 증빙 |
| next_checkin | text | 다음 점검(구 자유 텍스트) |
| next_checkin_date | date | 다음 점검 날짜 |
| next_checkin_channel | text | 점검 채널(message/call/video/email 등) |
| session_note | text | 세션 메모 |
| watch_next | text | 다음에 주시할 점 |
| energy | integer | 창업가 에너지 수치 |
| metrics | jsonb | 핵심 숫자 배열 |
| narrative_summary | text | AI 작성 세션 내러티브 요약 |
| transcript_raw | text | 원본 STT transcript |
| ai_extracted | boolean | AI 추출 초안 여부 |
| extraction_evidence | jsonb | 필드별 transcript 근거 인용 + confidence |
| extraction_model | text | 추출에 쓰인 Gemini 모델 ID |
| extraction_version | text | 추출 스크립트 버전 |

---

## B. 사용자 / 권한 도메인

### profiles — 사용자 프로필 + 역할
> `auth.users` 미러 + role 컬럼. admin/pm/coach 3단계 권한의 기준.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑🔗 | uuid | → auth.users.id |
| email | text | 이메일 |
| display_name | text | 표시 이름 |
| role | text | admin / pm / coach (기본 coach · 도메인 매칭 자동 부여) |
| onboarded_at | timestamptz | 온보딩 모달 노출 시각(null=신규) |
| created_at | timestamptz | 생성 시각 |

---

## C. 프로젝트 / 멤버 도메인

### projects — 코칭 사업(engagement) 단위
> 수주(business_plan) 트리거가 자동 생성. 직접 INSERT는 차단되어 있음.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 프로젝트 고유 ID |
| name | string | 프로젝트 이름 |
| description | text | 설명 |
| status | text | active / closed / archived |
| start_date / end_date | date | 시작·종료일 |
| created_by 🔗 | uuid | → auth.users.id (담당 PM) |
| business_plan_id 🔗 | uuid | → business_plans.id (역링크) |
| required_kpis | jsonb | 프로젝트 공통 필수 KPI 목록 |
| created_at / updated_at | timestamptz | 생성·수정 시각 |

### project_members — 프로젝트 배정 멤버
| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| project_id 🔗 | uuid | → projects.id |
| user_id 🔗 | uuid | → auth.users.id |
| role | text | pm / coach / observer |
| added_by 🔗 | uuid | → auth.users.id (배정자) |
| added_at | timestamptz | 배정 시각 |

> 제약: ⭐ UNIQUE(project_id, user_id)

### project_invites — 미가입 코치 초대 예약
> 아직 가입 안 한 코치를 프로젝트에 예약. 가입 후 RPC로 project_members로 승격.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| project_id 🔗 | uuid | → projects.id |
| coach_directory_id 🔗 | uuid | → coaches_directory.id |
| role | text | lead_coach / coach / observer |
| invited_by 🔗 | uuid | → auth.users.id |
| invited_at | timestamptz | 초대 시각 |

> 제약: ⭐ UNIQUE(project_id, coach_directory_id)

---

## D. 코치 디렉토리 도메인 (세 앱 공유 마스터 · 변경 주의)

### coaches_directory — 코치 마스터 풀 (800+ · 단일 진실원본)
> pgvector 임베딩 기반 의미 검색(RAG 매칭) 지원. 세 앱이 공유하는 계약 테이블.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| external_id ⭐ | text | coach-finder 원본 ID (upsert 기준) |
| name | text | 이름 |
| email | text | 이메일(부분 UNIQUE) |
| phone / gender / location / country | text | 전화 / 성별 / 위치 / 국가 |
| regions | text[] | 활동 지역 |
| organization / position | text | 소속 / 직책 |
| industries / expertise / roles | text[] | 산업 / 전문분야 / 수행역할 |
| language | text | 언어 |
| tags | text[] | 운영 자유 태그 |
| overseas / overseas_detail | bool/text | 해외 활동 가능 여부·상세 |
| intro / career_history / education | text | 소개 / 경력 / 학력 |
| underdogs_history / current_work / tools_skills | text | UD 이력 / 현재 업무 / 도구·스킬 |
| career_years / career_years_raw | numeric/text | 경력 연수 / 원본 텍스트 |
| photo_url / photo_filename | text | 프로필 사진 URL / 파일명 |
| tier | text | PM 세그먼트 등급(라이브는 integer · RPC가 캐스트) |
| category / business_type | text | 카테고리 / 사업 유형 |
| availability_status | text | available / limited / unavailable |
| max_concurrent_projects | integer | 동시 진행 가능 프로젝트 수 |
| linked_user_id ⭐🔗 | uuid | → auth.users.id (로그인 계정 연결 · 대부분 null) |
| status | text | active / inactive / archived / draft |
| notes | text | 내부 운영 메모 |
| embedding | vector(1536) | **pgvector 임베딩**(Gemini 1536차원 · HNSW cosine) |
| embedding_source_hash / _updated_at / _model | text/ts/text | 임베딩 소스 해시 / 갱신 시각 / 모델 |
| inferred_skills | text[] | 코칭일지에서 자동 추론한 스킬 |
| inferred_skills_updated_at / _source | ts/text | 추론 스킬 갱신 시각 / 방식(gemini/frequency) |
| roles_capable | text[] | 보유 역량 역할 |
| roles_active_2026 | text[] | 2026년 적극 활동 의향 역할 |
| ud_programs | text[] | 참여 UD 프로그램 |
| created_at / updated_at / last_synced_at | timestamptz | 생성 / 수정 / 동기화 시각 |

> RPC: `search_coaches_by_embedding(...)` (RAG 코치 매칭) · `ensure_my_coach_directory_row()` (코치 self-link)

### coaches_directory_history — 코치 변경 이력(감사)
> coaches_directory 변경 시 트리거가 자동 기록.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | bigint | 고유 ID |
| coach_id | uuid | 변경된 코치 ID(coaches_directory.id 값) |
| op | text | UPDATE / DELETE |
| changed_by | uuid | 변경자(auth.uid) |
| changed_at | timestamptz | 변경 시각 |
| snapshot | jsonb | 변경 직전 행 전체 |

### coach_contract_info — 코치 계약 민감정보
> 계약서 자동 채움용(주소·계좌·원천세). 본체와 분리해 RLS 세분화.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| coach_directory_id 🔑🔗 | uuid | → coaches_directory.id |
| address | text | 주소 |
| bank_name / account_number / account_holder | text | 은행명 / 계좌번호 / 예금주 |
| tax_type | text | 원천세 구분(business_3_3 / other_8_8) |
| is_business | boolean | 사업자 등록 여부 |
| business_number / business_name | text | 사업자등록번호 / 상호 |
| updated_by 🔗 | uuid | → auth.users.id |
| updated_at | timestamptz | 수정 시각 |

### coach_applications — 신규 코치 자가 등록 신청
> 비로그인 신청 가능. admin 승인 시 coaches_directory로 이전.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| name / email / phone | text | 이름 / 이메일 / 전화 |
| organization / position / country | text | 소속 / 직책 / 국가 |
| intro | text | 소개 |
| expertise / industries / regions | text[] | 전문분야 / 산업 / 지역 |
| status | text | pending / approved / rejected |
| submitted_at | timestamptz | 신청 시각 |
| reviewed_by 🔗 | uuid | → auth.users.id (검토 admin) |
| reviewed_at | timestamptz | 검토 시각 |
| rejected_reason | text | 거절 사유 |
| linked_coach_id 🔗 | uuid | → coaches_directory.id (승인 시 생성된 코치) |

> 제약: 부분 ⭐ UNIQUE(email, phone) WHERE status='pending'

### coach_bookmarks — PM별 코치 숏리스트
> 사용자별 완전 격리(admin도 타인 것 못 봄).

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| user_id 🔗 | uuid | → auth.users.id |
| coach_directory_id 🔗 | uuid | → coaches_directory.id |
| note | text | 메모 |
| tags | text[] | 본인용 자유 태그 |
| created_at | timestamptz | 생성 시각 |

> 제약: ⭐ UNIQUE(user_id, coach_directory_id)

---

## E. 사업 기획 / 제안 도메인

### business_plans — 사업 기획·제안 단위
> PM이 관리. status가 won/active로 전환되면 트리거가 projects + 멤버/초대를 자동 생성.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| title | text | 사업명 |
| client_org / client | text | 고객 조직(정형) / 고객사(자유 텍스트) |
| description | text | 설명 |
| status | text | 이중 lifecycle(draft/proposed/won/lost/cancelled + planning/active/completed) |
| target_start_date / target_end_date | date | 목표 시작·종료일 |
| estimated_budget / total_budget | numeric | 예상 예산 / 총 예산(원) |
| payment_schedule | text | lump(일시불) / installment(분할) |
| installment_midpay_note / _balance_note | text | 선금 / 잔금 지급 시기 문구 |
| kickoff_count | int | 계약서 제4조 킥오프 미팅 횟수 |
| task_program_learning / _review_participation / _program_attendance | text | 제4조 업무 옵션(학습/심사참여/프로그램참여) |
| task_participant_type / _report_frequency | text | 제5조 참가자 단위 / 보고서 주기 |
| notes | text | PM 내부 메모 |
| project_id 🔗 | uuid | → projects.id (수주 시 채움) |
| created_by 🔗 | uuid | → auth.users.id (담당 PM) |
| legacy_firestore_id ⭐ | text | Firestore 마이그레이션 원본 doc id |
| created_at / updated_at | timestamptz | 생성·수정 시각 |

### business_plan_coaches — 사업 후보 코치
| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| business_plan_id 🔗 | uuid | → business_plans.id |
| coach_directory_id 🔗 | uuid | → coaches_directory.id |
| rank | int | 순위 |
| status | text | candidate / proposed / accepted / rejected / withdrawn |
| payment_info | jsonb | 코치별 단가 정보 |
| task_summary | text | 코치별 업무 요약 |
| notes | text | PM 내부 메모 |
| added_by 🔗 | uuid | → auth.users.id |
| added_at | timestamptz | 추가 시각 |

> 제약: ⭐ UNIQUE(business_plan_id, coach_directory_id)

### coach_evaluations — 코치 평가
> admin/pm이 코치를 평가. 코치 본인은 자기 평가를 볼 수 없음(의도).

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| coach_directory_id 🔗 | uuid | → coaches_directory.id |
| business_plan_id 🔗 | uuid | → business_plans.id |
| project_id 🔗 | uuid | → projects.id |
| evaluator_id 🔗 | uuid | → auth.users.id (평가자) |
| rating_overall / _communication / _expertise / _reliability | int | 종합 / 소통 / 전문성 / 신뢰성 평점(1~5) |
| would_rehire | boolean | 재고용 의향 |
| comment | text | 코멘트 |
| created_at / updated_at | timestamptz | 생성·수정 시각 |

> 제약: 부분 ⭐ UNIQUE(business_plan_id, coach_directory_id)

---

## F. RFP / API / 사용량 도메인

### rfp_history — RFP 작성·추출 이력
> PM이 작성한 RFP + Gemini 추출 결과 저장(재사용). 사용자별 완전 격리.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| user_id 🔗 | uuid | → auth.users.id |
| rfp_text | text | RFP 원문 |
| extraction | jsonb | Gemini 추출 결과 |
| filters | jsonb | 호출 시점 필터(재현용) |
| result_count | integer | 추천받은 코치 수 |
| title | text | 제목(추출 프로젝트명 또는 앞 80자) |
| business_plan_id 🔗 | uuid | → business_plans.id (선택) |
| use_count | integer | 사용 횟수 |
| created_at / last_used_at | timestamptz | 생성 / 마지막 사용 시각 |

### api_consumers — 외부 연동 API 키 관리
> admin 전용. 평문 키는 생성 시 1회만 노출.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | uuid | 고유 ID |
| name | text | 사용처 이름 |
| key_hash ⭐ | text | sha256(api_key) |
| key_prefix | text | 키 앞 12자(식별용) |
| allowed_fields | text[] | 응답 허용 필드 화이트리스트 |
| allowed_endpoints | text[] | 허용 엔드포인트 |
| rate_limit_per_day | int | 일일 호출 한도 |
| is_active | boolean | 활성 여부 |
| notes | text | admin 메모 |
| created_by 🔗 | uuid | → profiles.id |
| created_at / last_used_at | timestamptz | 생성 / 마지막 사용 시각 |

### api_consumer_usage — API 호출 로그
| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | bigint | 고유 ID |
| consumer_id 🔗 | uuid | → api_consumers.id |
| endpoint | text | 호출 엔드포인트 |
| status_code | int | 응답 상태 코드 |
| request_at | timestamptz | 호출 시각 |

### ai_usage — AI 호출 사용량(일일 캡)
> AI 호출 1건당 1행. 사용자별 일일 한도 카운터.

| 컬럼 | 타입 | 의미 |
|---|---|---|
| id 🔑 | bigint | 고유 ID |
| user_id | uuid | 호출 사용자 |
| endpoint | text | AI 엔드포인트 라벨(recommend / parse_pdf 등) |
| created_at | timestamptz | 호출 시각 |

---

## 핵심 비즈니스 로직 메모 (트리거/RPC)

- **수주 자동화**: `business_plans.status`가 `won`/`active`로 바뀌면 트리거(`bp_lifecycle_sync_*`)가 `projects` 생성 → 가입 코치는 `project_members`로, 미가입 코치는 `project_invites`로 자동 배정. (`projects`는 직접 INSERT 차단 · 트리거 전용)
- **코치 매칭(RAG)**: `coaches_directory.embedding`(pgvector) + RPC `search_coaches_by_embedding`로 RFP 의미 검색.
- **신규 코치 유입**: `coach_applications`(비로그인 신청) → admin 승인 → `coaches_directory` INSERT + 신청서에 `linked_coach_id` 연결.
- **공유 테이블 주의**: `coaches_directory` · `business_plans`는 세 앱(coaching-log · coach-finder · ud-ops)이 공유하는 계약 테이블 → 변경 시 ADR 필요.
