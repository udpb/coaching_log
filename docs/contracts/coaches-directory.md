# 공유 계약 — `coaches_directory` (Single Source of Truth)

> **이 파일은 세 앱이 공유하는 Supabase 테이블 `public.coaches_directory` 의 단일 계약 원본입니다.**
>
> 물리적으로 **이 파일 한 개만 권위**를 가집니다. coach-finder · ud-ops-workspace 는 자기 레포에 사본을 두지 말고 **이 파일을 포인터로 참조**합니다 (각 레포 `docs/contracts/coaches-directory.md` 는 1줄 포인터).
>
> 위치 근거: `coaches_directory` 의 스키마 진실원본 = coaching-log 의 `supabase/migrations/*.sql`. 따라서 계약 문서도 여기 둡니다.
>
> 작성: 2026-06-01 · 유지: 각 레포 메인 세션 (변경은 ADR 동반).

---

## 0. 왜 이 문서가 존재하는가 (배경)

2026-06-01 감사에서 가장 큰 **구조 리스크**로 확인된 사실:

> `coaches_directory` 의 컬럼 모양이 **세 곳에 손으로 복사**되어 있고, 이미 어긋나기 시작했다.
> - coach-finder `api/_lib/supabaseAdmin.ts` (`CoachDirectoryRow` + `COACH_SELECT_COLUMNS` + `rowToCoach`)
> - ud-ops-workspace `src/lib/coaches/supabase-source.ts` (`CoachDirectoryRow` + `COACH_SELECT_COLUMNS`) — **이미 `inferred_skills` · `roles_capable` · `roles_active_2026` · `ud_programs` 4컬럼이 누락된 stale 상태**
> - coaching-log `public/index.html` 의 인라인 `.from('coaches_directory')` 쿼리 (일부 `select('*')`)

컬럼 하나를 rename 하면 **컴파일 에러 없이 조용히** ud-ops mapper 와 coaching-log 인라인 쿼리가 깨집니다. 이 계약 문서 + 변경 룰 + (후속) CI 일치 검사가 그 시한폭탄을 제거합니다.

---

## 1. 컬럼 계약 (v2 · 2026-06-20)

권위 출처: coach-finder `COACH_SELECT_COLUMNS` (현재 가장 완전한 사본) + coaching-log 마이그레이션.
컬럼 추가/삭제/rename 은 **§4 변경 룰** 필수.

> **소유(Owner) 표식 (v2, ADR-024):** 🔵 = **coach-finder 전용 기능 컬럼** — coaching-log 는 0참조
> (읽지도 쓰지도 않음). 공유 테이블이라 정의위치(스키마 SoT)는 coaching-log 마이그레이션이지만, 기능 소유·
> 사용·갱신 주체는 coach-finder. 표식 없는 컬럼은 공용(여러 앱이 읽음). ADR-024 참조 — 드롭/물리분리 안 함.

| 컬럼 | 타입 | 민감 | 비고 |
|------|------|------|------|
| `id` | uuid (PK) | | 내부 식별자 |
| `external_id` | text | | 레거시 Firestore id (정수 문자열). `approve_coach_application` 이 `::integer` 캐스트 — `^[0-9]+$` 가정 |
| `name` | text | | |
| `email` | text | 🔴 PII | **공개/익명 응답에 절대 포함 금지** |
| `phone` | text | 🔴 PII | **공개/익명 응답에 절대 포함 금지** |
| `gender` | text | 🟡 PII | |
| `location` | text | 🟡 PII | |
| `country` | text | | |
| `regions` | text/array | | |
| `organization` | text | | |
| `position` | text | | |
| `industries` | text/array | | 검색 필터 |
| `expertise` | text/array | | 검색 필터 |
| `roles` | text/array | | Phase P 역할 분리 |
| `language` | text | | |
| `overseas` | bool | | |
| `overseas_detail` | text | | |
| `intro` | text | | 카드 노출 |
| `career_history` | text | | |
| `education` | text | | |
| `underdogs_history` | text | | |
| `current_work` | text | | |
| `tools_skills` | text | | |
| `career_years` | int | | |
| `career_years_raw` | text | | |
| `photo_url` | text | | ⚠️ Firebase Storage URL (외부 의존 — HANDOVER §8.3) |
| `photo_filename` | text | | |
| `tier` | text | | 베테랑/UD/외부풀 등급 (코드별 파싱 `parseTier`) |
| `category` | text | | "파트너코치" 라벨은 2026-05-15 폐기 (→ "코치") |
| `business_type` | text | | |
| `status` | text | | `active` / `inactive`(휴식) / `archived` |
| `inferred_skills` | jsonb/array | | 🔵 coach-finder. Phase E4 — 일지 기반 자동 추출 스킬. coach-finder `tools/infer-coach-skills` 가 갱신. coaching-log 0참조 |
| `roles_capable` | jsonb/array | | 🔵 coach-finder. Phase P — 보유 역량 역할. coach-finder 필터(`supabaseAdmin.ts`). coaching-log 0참조 |
| `roles_active_2026` | jsonb/array | | 🔵 coach-finder. Phase P — 2026 활동 의향 역할. coaching-log 0참조 |
| `ud_programs` | jsonb/array | | 🔵 coach-finder. Phase Q — 참여 UD 프로그램. `CoachCard.tsx` 렌더. coaching-log 0참조 |
| `embedding` (+`_source_hash`/`_updated_at`/`_model`) | vector(1536) | | 🔵 coach-finder. pgvector (Gemini `gemini-embedding-001` → 1536, ⚠️ 마이그 주석 "OpenAI" 는 오기). 추천 RPC `search_coaches_by_embedding` 전용 (coach-finder `recommend.ts`). coaching-log 0참조. SELECT 목록 미포함 |
| `linked_user_id` | uuid | | `profiles.id` 연결 (코치 본인 self-update RLS 키) |

> ⚠️ **임베딩 차원(1536) 은 세 앱이 동일해야 함.** 마이그레이션 `20260424_phase4e` 주석은 "OpenAI text-embedding-3-small"이라 적혀 있으나 **실제는 Gemini `gemini-embedding-001` 을 1536 으로 truncate**. 모델/차원 변경 = 전 임베딩 재생성 + 세 앱 동시 반영 (ADR 필수).

---

## 2. Writer / Reader 매트릭스

| 동작 | coach-finder | coaching-log | ud-ops-workspace |
|------|--------------|--------------|------------------|
| **읽기** | `/api/coaches` (service-role 프록시) + `/api/v1` (API-key) | 브라우저 anon SDK (RLS) | `src/lib/coaches/supabase-source.ts` (service-role) |
| **쓰기 (INSERT)** | admin/PM (CoachBulkUploadModal · 자가등록 승인) | admin 승인 플로우 | ❌ (안 씀) |
| **쓰기 (UPDATE)** | admin OR 코치 본인(`linked_user_id`) | 코치 self-edit · admin | ❌ |
| **embedding 생성** | `tools/embed-coaches.mjs` (**canonical**) | `tools/embed-coaches.js` (중복 — 축소/삭제 대상) | ❌ (자체 콘텐츠 테이블만) |

---

## 3. RLS (Row Level Security) — 권위 = coaching-log 마이그레이션

- **SELECT** = `cd_read_authenticated` — `authenticated` 롤만 (anon 0행). coach-finder 브라우저는 Supabase 세션이 없어 service-role 서버 프록시로 우회. ⚠️ 이 때문에 `/api/coaches` 가 **무인증 PII 노출** P0 가 됨 (감사 참조).
- **INSERT** = admin + PM (`cd_admin_or_pm_insert`, Phase O `20260522`)
- **UPDATE** = admin OR `linked_user_id = auth.uid()`
- **DELETE** = admin only
- **history**: `coaches_directory_history` (audit trigger `coaches_audit`) — admin only SELECT (PM 은 D3 에서 제외)
- RLS 헬퍼: `is_admin()` · `is_pm()` · `is_admin_or_pm()` (SECURITY DEFINER, 재귀 회피)

---

## 4. 변경 룰 (⚠️ 어기면 다른 앱이 조용히 깨짐)

`coaches_directory` 의 컬럼을 **추가 / 삭제 / rename / 타입 변경** 하려면:

1. **ADR 작성** — 변경 사유 + 영향 받는 3개 앱 명시 (변경 주도 레포의 `docs/decisions/`).
2. **이 계약 문서(§1) 먼저 갱신** + 버전 bump (`v1` → `v2`) + 변경 이력(§6) 추가.
3. **마이그레이션** = coaching-log `supabase/migrations/` 에 **새 파일**로만 (기존 파일 수정 금지).
4. **세 사본 동시 반영** — 같은 PR/세션에서:
   - coach-finder `api/_lib/supabaseAdmin.ts` (`CoachDirectoryRow` · `COACH_SELECT_COLUMNS` · `rowToCoach`)
   - ud-ops-workspace `src/lib/coaches/supabase-source.ts`
   - coaching-log `public/index.html` 인라인 쿼리
5. **rename/삭제는 2단계** — 먼저 신규 컬럼 추가 + 동시 쓰기 → 세 앱 전환 확인 → 다음 ADR 에서 구 컬럼 제거. **한 번에 rename 금지.**
6. PII 컬럼(`email`·`phone`·`gender`·`location`)을 새 응답 경로에 넣을 때 = 그 경로의 인증/화이트리스트 재확인.

### 후속(권장): CI 일치 검사 — ⚠️ 미구현

세 사본의 컬럼 리스트가 이 문서 §1 과 일치하는지 검사하는 스크립트를 각 레포 release-check 에 추가. (브리프 후보: `DOCS-coaches-contract-ci`)
2026-06-01 기준 ud-ops 사본은 D1 로 parity 맞췄으나, **재발 방지용 자동 일치 검사는 아직 없음** — 또 다른 손복사 드리프트가 조용히 생길 수 있음.

---

## 5. 알려진 드리프트 (2026-06-01 기준 · 해소 대상)

| # | 드리프트 | 조치 |
|---|----------|------|
| D-1 | ~~ud-ops `supabase-source.ts` 가 `inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs` 누락~~ | ✅ **해소 (2026-06-01, 브리프 D1)** — Row+SELECT parity 맞춤 + 계약 포인터. ⚠️ Prisma 매핑(`MappedCoach`)은 미정(향후 결정). |
| D-2 | embedding 차원 주석이 "OpenAI" 라 적힘 (실제 Gemini) | `20260424_phase4e` 주석 정정 |
| D-3 | embed 툴 2개(coach-finder `.mjs` / coaching-log `.js`) | `.mjs` 를 canonical 로 명시, `.js` 축소/삭제 |
| D-4 | `coach_evaluations` 가 두 앱에서 다른 스키마로 기록 (rating vs 4차원) | 별도 계약/ADR (이 문서 범위 밖) |

---

## 6. 변경 이력

- **v2 (2026-06-20, ADR-024)** — 소유(Owner) 표식 도입(🔵 = coach-finder 전용 기능). embedding(4)·
  inferred_skills(3)·roles_capable·roles_active_2026·ud_programs 를 coach-finder 소유로 명문화(coaching-log 0참조이나
  공유 테이블이라 정의는 coaching-log SoT). 핸드오프 정리 중 "폐기 후보" 오판을 정정 — coach-finder 추천 엔진·
  코치 카드 실사용이라 보존. embedding 모델/차원 = Gemini 1536(마이그 "OpenAI" 주석은 오기) 재확인. **스키마 변경 없음.**
- **v1 (2026-06-01)** — 최초 작성. 감사(2026-06-01)에서 발견된 3중 복사 드리프트 대응. 컬럼 36 + embedding/linked_user_id.
