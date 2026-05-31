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

> 참고: 제품 도메인 결정(coaching_logs 24필드 · 3채널 · RLS PM 격리 등)은 **마이그레이션 파일 주석 + INTEGRATED_ARCHITECTURE** 에 기록되어 있음. 향후 중요 결정부터 본 ADR 체계로 누적.

## 다음 ADR 후보 (감사 백로그 — [docs/AUDIT-2026-06-01.md](../AUDIT-2026-06-01.md))
- **ADR-004 (예정)** — `coach_applications` anti-spam: captcha provider(Turnstile vs reCAPTCHA) + register 서버 경유 INSERT 결정. (페이로드 하드닝은 ADR-003 으로 완료.)
- **ADR-004 (예정)** — `public/index.html` 점진 모듈화 전략 (`<script type="module">` 분리 순서).
- **ADR-005 (예정)** — 레거시 로컬 스택(`server.js`·`lib/*`) 제거.
