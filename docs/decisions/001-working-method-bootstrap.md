# ADR-001: 일하는 방식 셋업 (운영 인프라 부트스트랩)

| 메타 | 값 |
|------|----|
| 상태 | **Accepted** |
| 일자 | 2026-06-01 |
| 작성자 | 메인 세션 (사용자 요청 기반) |
| 관련 Journey | [docs/journey/2026-06-01-audit-and-governance-bootstrap.md](../journey/2026-06-01-audit-and-governance-bootstrap.md) |

---

## Context (왜)

사용자가 1차로 만든 두 제품(coach-finder · coaching-log)을 검증하고 싶다고 요청 → 2026-06-01 심층 감사 ([docs/AUDIT-2026-06-01.md](../AUDIT-2026-06-01.md)). P0 보안 + 공유 스키마 드리프트 확인. 이어 사용자가 UDImpact-ActBot 수준의 일하는 방식을 **먼저 세팅한 뒤 작업** 하라고 요청.

안 하면: 메인 직접 구현 슬립 / 결정 휘발 / 검증 없는 보고 / 공유 스키마 드리프트 방치.

## Decision (무엇을)

**ActBot 의 일하는 방식을 coach-finder · coaching-log 두 레포에 각각 이식하고, 공유 `coaches_directory` 계약은 단일 물리 파일로 통합한다. 본 레포가 그 계약의 물리적 원본을 보유한다** (스키마 SoT = 본 레포 마이그레이션). 사용자 결정(2026-06-01): "두 레포 각각 + 공유 계약 문서", "구현은 전부 브리프→서브에이전트".

세부:
- 5역할 분리 (메인 직접 구현 금지) · 5대 운영 원칙.
- 신규 파일: CLAUDE/AGENTS/HANDOFF/glossary/HISTORY/playbook×3/decisions×3/journey×2/agent-briefs×3 + AUDIT-2026-06-01 + **docs/contracts/coaches-directory.md (공유 계약 원본)**.
- 기존 문서(INTEGRATED_ARCHITECTURE/ARCHITECTURE/HANDOVER/README) 원본 유지, HISTORY 신선도 표 표기.
- 빌드/lint 가 없는 스택이므로 품질 게이트를 "엔드포인트 호출 / SQL / 브라우저 / RLS 매트릭스" 검증으로 재정의.

## Consequences (결과)

### Positive
- 진입점 명확 · 서브 자급자족 · 결정 영구 보존 · 공유 계약 단일화 · 신뢰 가능한 보고.

### Negative / Trade-off
- 초기 셋업 비용 · 매 세션 HANDOFF/Journey 의무 · 직접 짜기 차단(단기 속도 ↓, 장기 구조 보존 — 사용자 동의).

### 영향 받는 코드 · 문서 · DB
- 코드: 변경 없음. 문서: 위 신규 파일. DB: 변경 없음 (계약은 기존 스키마 문서화).

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| A. 단일 플랫폼 거버넌스 | 두 제품 통합 관리 | 독립 git·배포. 사용자가 "두 레포 각각" 선택 |
| B. 계약 두 레포 복사 | 자급자족 | **복사 드리프트가 그 버그** — 단일 물리 파일이 핵심. 본 레포가 원본 |

## Migration / Rollout
1. ✅ 공유 계약 원본 (본 레포 `docs/contracts/coaches-directory.md`)
2. ✅ coach-finder 풀세트 (+포인터)
3. ✅ coaching-log 풀세트 (본 ADR 포함)
코드 변경 없음.

## 검증 (Acceptance)
- [x] 글로서리 · CLAUDE · AGENTS 신규
- [x] 영향 코드: 없음
- [x] 사용자 명시 승인 (2026-06-01 결정 2건)

## 후속 작업
- **ADR-002~005 (예정)** — extract-session 인증 · coach_applications 방어 · index.html 모듈화 · 레거시 제거.
- 첫 구현 브리프 = `SEC1` (extract-session 인증) — 사용자 GO 후.
