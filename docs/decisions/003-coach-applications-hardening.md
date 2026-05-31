# ADR-003: coach_applications 익명 INSERT 페이로드 하드닝 (+ anti-spam 분리)

| 메타 | 값 |
|------|----|
| 상태 | **Accepted** |
| 일자 | 2026-06-01 |
| 작성자 | 메인 세션 (사용자 GO 기반) |
| 관련 브리프 | `.claude/agent-briefs/_archive/SEC2-coach-applications-hardening.md` |
| 관련 Journey | [docs/journey/2026-06-01-p0-security-fixes.md](../journey/2026-06-01-p0-security-fixes.md) |

---

## Context (왜)

감사(AUDIT-2026-06-01) P1: `coach_applications` 는 anon 이 INSERT 가능한 공개 코치 자가등록 테이블(`20260515_phase_j`). 의도된 공개 INSERT 이지만 텍스트 길이·배열 cardinality 상한이 없어 익명이 거대 페이로드로 남용 가능. 진짜 anti-spam(captcha)은 provider·아키텍처 결정이 필요해 즉시 못 하지만, **페이로드 상한**은 결정 없이 안전하게 줄일 수 있다.

## Decision (무엇을)

**(1) 즉시:** 신규 마이그레이션 `20260601_phase_r_coach_applications_hardening.sql` 로 `coach_applications` 의 anon-insertable 컬럼에 길이·배열 상한 CHECK 제약 10개(`NOT VALID`, idempotent)를 추가해 남용 면적을 줄인다.
**(2) 분리:** 진짜 anti-spam(captcha/Turnstile + 서버 경유 INSERT 또는 rate-limit)은 provider 선택·register 흐름 재설계가 필요하므로 **별도 ADR-004(예정)** 로 분리. 본 ADR 범위 아님.

상한: name≤100, email≤320(RFC), phone≤40, organization/position≤200, country≤100, intro≤4000, expertise/industries/regions cardinality≤30. 전부 `NOT VALID`(기존 행 미검증, 신규 INSERT/UPDATE 에만 적용).

## Consequences (결과)

### Positive
- 익명 거대 페이로드 INSERT 차단 (DoS/스토리지 남용 면적 ↓). 기존 데이터·정책 무영향.

### Negative / Trade-off
- 진짜 봇 스팸(정상 크기 다수 INSERT)은 여전히 가능 — captcha(ADR-004) 전까지 미해소.
- **마이그레이션 적용은 사용자 액션** (`supabase db push` 또는 SQL 콘솔). 메인/에이전트는 DB 직접 적용 불가 → end-to-end 미검증(파일 정적 검토까지).

### 영향 받는 코드 · 문서
- DB: `coach_applications` 에 CHECK 제약 10개 (신규 마이그레이션)
- 문서: 본 ADR · HANDOFF

## Alternatives Considered

| 옵션 | 설명 | 왜 채택 안 됐나(지금) |
|------|------|-----------------------|
| A. captcha + 서버 경유 INSERT | Turnstile/reCAPTCHA 검증 후 service-role INSERT | provider 결정 + register 흐름 재설계 필요 → ADR-004 |
| B. Postgres rate-limit 함수 | IP/email 쿨다운 | row 에 IP 없음 · 복잡 · 효과 제한 |
| C. 아무것도 안 함 | — | 페이로드 남용 면적 방치 |

## 검증 (Acceptance)

- [x] 마이그레이션 파일 10개 제약 · NOT VALID · idempotent — 메인 직접 read 검증
- [x] 기존 마이그레이션/정책/함수 무변경 (신규 파일 1개만)
- [ ] **DB 적용 + 검증 SQL 실행 — 사용자 액션 대기** (`supabase db push`)
- [x] 사용자 GO ("순차적으로 진행")

## 후속 작업

- **ADR-004 (예정)** — coach_applications anti-spam: captcha provider(Turnstile vs reCAPTCHA) + register 흐름(서버 경유 INSERT) 결정.
- 사용자: 마이그레이션 적용.
