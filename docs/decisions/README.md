# Architecture Decision Records (ADR) — coaching-log

> 되돌리기 어려운 결정 / 여러 모듈 영향 / 나중에 "왜?" 물을 결정의 기록.

## 운영 룰
1. Accepted ADR 수정 금지 → 새 ADR (`Supersedes`).
2. 번호 영구. 재사용 금지.
3. `Proposed` → `Accepted` → (필요 시) `Superseded`/`Deprecated`.
4. 결정 직후 작성. 5. 메인만 작성 (서브는 "결정한 것" 보고만). 6. 템플릿 [`000-template.md`](000-template.md).

## ADR 후보 신호
- 되돌리기 어렵다 (마이그레이션·데이터) / 여러 모듈 / 공유 계약·RLS / 사용자 가시 / 변경 금지 항목 / 글로서리 핵심 용어 / `index.html` 프레임워크 도입.

## ADR 목록
| 번호 | 상태 | 제목 | 일자 |
|------|------|------|------|
| [001](./001-working-method-bootstrap.md) | **Accepted** | 일하는 방식 셋업 (5역할 · 브리프 · ADR · Journey · 글로서리 이식) | 2026-06-01 |
| [002](./002-extract-session-auth.md) | **Accepted** | /api/extract-session Supabase JWT 인증 + CORS 제한 | 2026-06-01 |
| [003](./003-coach-applications-hardening.md) | **Accepted** | coach_applications 익명 INSERT 페이로드 하드닝 (+anti-spam 분리) | 2026-06-01 |
| [011](./011-eval-write-removal.md) | **Accepted** | 평가(coach_evaluations) 쓰기 권한을 coach-finder 로 단독 이전 | 2026-06-06 |
| [013](./013-project-invites-bulk-assign.md) | **Accepted** | 미가입 코치 초대 예약(project_invites) + 다중 검색 일괄 배정 | 2026-06-06 |
| [014](./014-project-status-enum-normalize.md) | **Accepted** | projects.status 표시값 정규화 | 2026-06-07 |
| [018](./018-tobe-phase-x-foundations.md) | **Accepted** | To-Be 분리 1단계 — 비파괴 DB 기반 (Phase X) | 2026-06-07 |
| [019](./019-tobe-seal-coaching-log.md) | **Accepted** | To-Be 분리 2단계 — 직접생성 봉인 (SEAL1 + Phase Y RLS) | 2026-06-07 |
| [020](./020-field-defs-shared-module.md) | **Accepted** | 22필드 정의 중앙화 — public/field-defs.js 공유 모듈 | 2026-06-10 |
| [021](./021-two-hour-chunked-transcription.md) | **Accepted** | 2시간 세션 — 클라이언트 청크 분할 전사 | 2026-06-10 |
| [022](./022-project-required-kpis.md) | Proposed (K1a/K1b 구현·배포됨) | 프로젝트별 필수 KPI | 2026-06-15 |
| [023](./023-status-single-lifecycle-coachfinder-sot.md) | **Accepted** | 사업 status 단일 라이프사이클 — coach-finder=SoT | 2026-06-15 |
| [024](./024-contract-info-encryption.md) | **Accepted** | coach_contract_info 민감정보(계좌·주소) 필드 암호화 | 2026-06-25 |
| [025](./025-coachfinder-owned-directory-columns.md) | **Accepted** | coaches_directory 의 coach-finder 전용 컬럼 — 보존 + 소유권 명문화 | 2026-06-20 |

> 번호 공백(004~010·012·015~017)은 미할당(예약/결번). 권위 목록은 본 `docs/decisions/` 디렉토리.
> 참고: 초기 제품 도메인 결정(coaching_logs 필드 · RLS PM 격리 등)은 **마이그레이션 파일 주석 + INTEGRATED_ARCHITECTURE** 에 기록.

## 다음 ADR 후보 (감사 백로그 — [docs/history/AUDIT-2026-06-01.md](../history/AUDIT-2026-06-01.md) · 최신 [docs/AUDIT-2026-06-20.md](../AUDIT-2026-06-20.md))
- **ADR-004 (예정)** — `coach_applications` anti-spam: captcha provider(Turnstile vs reCAPTCHA) + register 서버 경유 INSERT 결정. (페이로드 하드닝은 ADR-003 으로 완료.)
- **ADR-004 (예정)** — `public/index.html` 점진 모듈화 전략 (`<script type="module">` 분리 순서).
- **ADR-005 (예정)** — 레거시 로컬 스택(`server.js`·`lib/*`) 제거.
