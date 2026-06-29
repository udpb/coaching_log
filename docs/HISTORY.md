# HISTORY — 전 문서 인벤토리 + 신선도 (coaching-log)

> 새 세션은 HANDOFF → CLAUDE → 본 파일 순. 작성: 2026-06-01 · 메인 유지.

---

## 운영 문서 (2026-06-01 신규 · ADR-001)

| 파일 | 역할 | 신선도 |
|------|------|--------|
| `CLAUDE.md` / `AGENTS.md` / `HANDOFF.md` | 최상위 룰 · 서브 룰 · 핸드오버 | ✅ 최신 (2026-06-20) |
| `docs/glossary.md` | 용어 SoT | ✅ 최신 (ADR-023 반영) |
| `docs/AUDIT-2026-06-20.md` ⭐ | **종합 정리 감사** (데드컬럼·데드코드·스키마·문서 stale·핸드오프) | ✅ 최신·현행 |
| `docs/contracts/coaches-directory.md` | **공유 계약 원본 v2 (3앱 권위)** — 🔵 coach-finder 소유 컬럼 표식(ADR-025) | ✅ 최신 |
| `docs/playbook/*` / `docs/decisions/*` (ADR-001~025) / `docs/journey/*` / `.claude/agent-briefs/*` | 운영 체계 | ✅ 최신 |

## 기존 제품 문서 (현행)

| 파일 | 역할 | 신선도 |
|------|------|--------|
| `docs/PRD-v2.md` ⭐ / `.html` | **제품 정의 v2.0** — 현행 코드 기준, 사용자 플로우·프로세스 중심 | ✅ 최신 (2026-06-20 ADR-023·022·021·K1b 반영) |
| `docs/INTEGRATED_ARCHITECTURE.md` | 4앱 통합 + Gap 1~5 | ✅ 양호 (ADR-023 배너) |
| `docs/ARCHITECTURE.md` | 단일 앱 아키텍처 (AWS 포터블 의도) | ✅ 양호 |
| `README.md` | 개요 | ✅ 최신 (22필드·42마이그) |
| `supabase/migrations/*.sql` (44) | **스키마 SoT** | ✅ 권위 |

## 과거 기록 (`docs/history/` — 참고용, 현행 아님)

| 파일 | 역할 | 비고 |
|------|------|------|
| `docs/history/HANDOVER.md` | 3-앱 인수인계 (2026-04) | 구 status 어휘·검증매트릭스 등 과거 서술. 현행은 CLAUDE/PRD-v2/INTEGRATED |
| `docs/history/AUDIT-2026-06-01.md` · `-verification.md` | 최초 심층 감사 | 당시 정확. 후속 06-10/06-20 으로 갱신됨 |
| `docs/history/AUDIT-2026-06-10.md` | 고도화 0~2단계 감사 | 당시 정확 |

## 정리 이력 (감사 → 해소)

| 과거 항목 | 현황 |
|------|------|
| `server.js` · `lib/*` 死 레이어 + express/cors/node-cron 의존성 | ✅ 삭제 완료 (2026-06-01 CLEAN — 현존하지 않음) |
| `api/extract-session.js` 무인증 + CORS `*` (구 P0) | ✅ 해소 — JWT 인증 + origin allowlist (ADR-002/SEC1) |
| dead CSS `.bp-status-*`/`.bp-trans-*` | ✅ 제거 (2026-06-20, CLEAN-20260620) |
| `getCreateTableSQL()` 死 DDL | ✅ 제거 (2026-06-01, `fa5e06d`) |

## 주요 구조 리스크 (잔존)

- `public/index.html` ~10,880줄 모놀리식 — 최대 유지보수 리스크. 점진 모듈화 후보.
- 자동 테스트 0건 (extract→save + RLS 매트릭스 테스트 ADD 후보).

## 누락 (ADD 후보)
- extract→save + RLS 매트릭스 자동 테스트 · 평가→tier 자동 트리거 · 코치 사진 Firebase→Supabase 이전.
