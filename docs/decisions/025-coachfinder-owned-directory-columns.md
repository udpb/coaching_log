# ADR-025: coaches_directory 의 coach-finder 전용 기능 컬럼 — 보존 + 소유권 명문화

| 메타 | 값 |
|------|----|
| 상태 | Accepted (사용자 승인 2026-06-20) |
| 일자 | 2026-06-20 |
| 작성자 | 메인 세션 (사용자: "coach-finder 에서만 작동하고 거기 필요한 기능이면 거기에 맞춰 정리") |
| 관련 | 공유 계약 `docs/contracts/coaches-directory.md` · AUDIT-2026-06-20 §ⓐ · phase4e/phase_e4/phase_p/phase_q 마이그레이션 |

---

## Context (왜)
운영자 핸드오프 정리(AUDIT-2026-06-20) 중, `coaches_directory` 의 다음 컬럼들이 **coaching-log 코드에서
0회 참조**됨이 확인되어 "죽은/미구현 컬럼, 폐기 후보"로 분류되었다:

- **embedding** 4컬럼: `embedding`(vector 1536)·`embedding_source_hash`·`embedding_updated_at`·`embedding_model` (phase4e)
- **inferred_skills** 3컬럼: `inferred_skills`·`inferred_skills_updated_at`·`inferred_skills_source` (phase_e4)
- **roles_capable** · **roles_active_2026** (phase_p)
- **ud_programs** (phase_q)

그러나 coach-finder 코드를 직접 조사한 결과 **이 컬럼들은 죽은 게 아니라 coach-finder 핵심 기능에 실사용 중**:
- `embedding` + `search_coaches_by_embedding` RPC → coach-finder **코치 추천 엔진**(`api/_lib/recommend.ts:261`, `/api/recommend`).
- `inferred_skills`·`roles_capable`·`roles_active_2026`·`ud_programs` → coach-finder `api/_lib/supabaseAdmin.ts`
  (`CoachDirectoryRow`·`COACH_SELECT_COLUMNS`·`rowToCoach`) + `ud_programs` 는 `CoachCard.tsx:103-110` 에서 **화면 렌더**.

즉 이들은 **coach-finder 전용 기능 컬럼**이며, 물리적으로 **3앱 공유 테이블 `coaches_directory`** 에 존재한다.
`coaches_directory` 의 스키마 진실원천(SoT)은 의도적으로 coaching-log 마이그레이션에 중앙화되어 있다(계약문서 — 손복사
드리프트 방지). coach-finder 의 자체 `supabase/migrations/` 는 신규 전용 도메인(partners_*)만 담고, 공유 테이블
변경은 coaching-log 에 둔다는 원칙이 이미 확립됨(`coach-finder/supabase/migrations/20260610_phase_pa1` 헤더).

## Decision (무엇을)
**컬럼을 드롭하지 않고 `coaches_directory` 에 보존한다. 소유=coach-finder(기능), 정의위치=coaching-log(공유 SoT)
임을 문서로 명문화한다.**

- 위 5그룹(총 10컬럼)은 **coach-finder feature columns** 로 분류. 계약문서 §1 에 소유 표식 추가.
- coaching-log 는 이 컬럼들을 읽지도 쓰지도 않으며(향후에도), 단지 공유 테이블 SoT 로서 마이그레이션 파일만 보관.
- coach-finder 문서(glossary·계약 포인터)가 "본 제품 소유 컬럼"으로 가시화.
- **embedding 차원·모델 정정**: 마이그레이션 `20260424_phase4e` 주석은 "OpenAI text-embedding-3-small"이라
  적혀 있으나 **실제는 Gemini `gemini-embedding-001` 을 1536 으로 사용**. 마이그 파일은 불변(적용됨)이므로
  **계약문서가 정정 권위**(이미 §1 주석에 기재됨, 본 ADR 이 재확인).

## Alternatives Considered
| 옵션 | 왜 기각 |
|------|------|
| **드롭(폐기)** | coach-finder 추천 엔진·코치 카드가 즉시 깨짐. 3앱 공유 계약 위반. |
| 마이그레이션 파일을 coach-finder 로 물리 복제/이전 | 공유 테이블 스키마 SoT 가 두 레포로 쪼개져 **계약문서가 경고하는 손복사 드리프트** 재발. DB 는 그대로라 실익 없음. |
| coach-finder 전용 테이블로 컬럼 분리(진짜 분리) | RPC(`search_coaches_by_embedding`) 재작성 + 데이터 이관 + 전 코치 재임베딩 동반. 핸드오프 직전 리스크 과다. → **핸드오프 후 별도 ADR 후보**(본 ADR 범위 밖). |

## Consequences
### Positive
- coach-finder 무영향(추천·카드 그대로). 3앱 공유 계약 유지. 드리프트 위험 0.
- 운영자가 "이 컬럼이 왜 coaching-log 에 정의됐는데 안 쓰이지?" 혼란 제거 — 소유권 명문화.
### Negative / Trade-off
- coaching-log 마이그레이션에 coaching-log 가 안 쓰는 컬럼이 남음(불가피 — 공유 테이블 SoT 중앙화의 결과).
- 진짜 물리 분리는 미룸(향후 필요 시 별도 ADR).

## 검증 (Acceptance)
- [x] coach-finder 실사용 file:line 확인(recommend.ts·supabaseAdmin.ts·CoachCard.tsx)
- [x] 사용자 승인(2026-06-20)
- [ ] 계약문서 §1 소유 표식 + §6 v2 이력 반영
- [ ] AUDIT-2026-06-20 §ⓐ · HANDOFF "폐기 결정 대기" 서술 정정
- [ ] coach-finder glossary/계약 포인터 소유 선언
