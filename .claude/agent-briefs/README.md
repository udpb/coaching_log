# Agent Briefs Index — coaching-log

서브 에이전트에게 위임할 작업의 자급자족 브리프 모음.
**메인 세션이 `Agent` 호출 시 → 브리프 파일 내용을 `prompt` 로 전달.**

> 인덱스는 메인이 갱신. 서브는 본인 브리프만. 운영 원칙은 [../../CLAUDE.md](../../CLAUDE.md) · [../../AGENTS.md](../../AGENTS.md).

## 명명 컨벤션
| 패턴 | 의미 | 예시 |
|------|------|------|
| `SEC{N}-*` | 보안 (감사 P0) | `SEC1-extract-session-auth.md` |
| `A{N}-*` | serverless API | `A1-...md` |
| `H{N}-*` | `public/index.html` 모듈화/뷰 | `H1-bp-detail-extract.md` |
| `D{N}-*` | DB / 마이그레이션 / 공유 계약 | `D1-...md` |
| `FIX-*` / `DOCS-*` | 핫픽스 / 문서 | |

상태: 🟡 in-progress · ✅ 완료(`_archive/`) · 🔴 blocked · 📦 deferred

## 활성 브리프
| 브리프 | 주제 | P | 의존성 | 상태 |
|--------|------|---|--------|------|
| (없음) | — | — | — | — |

## 다음 브리프 후보 (감사 백로그)
1. **DOCS1** — README/HANDOVER 정정 (모델명 · `api/match-coaches.js` · 마이그레이션 수) + 死 `GEMINI_KEY` 제거.
2. **H1** — `public/index.html` 모듈화 착수 (940줄 `renderBPDetailBody` 분리부터, `<script type="module">`).
3. **D-legacy** — 레거시 로컬 스택 제거 (`server.js`·`lib/csv-manager.js`·`lib/backup.js` + deps).
4. **ADR-004 결정 후** — coach_applications captcha anti-spam.

## 완료 브리프 (Archive)
| 브리프 | 결과 | 일자 |
|--------|------|------|
| [SEC1-extract-session-auth](_archive/SEC1-extract-session-auth.md) | extract-session JWT 인증 + CORS allowlist + 클라 토큰. ADR-002 | 2026-06-01 |
| [SEC2-coach-applications-hardening](_archive/SEC2-coach-applications-hardening.md) | coach_applications 페이로드 상한 10 CHECK(NOT VALID). ADR-003 | 2026-06-01 |
| [D1-coaches-contract-parity](_archive/D1-coaches-contract-parity.md) | ud-ops supabase-source.ts 4컬럼 parity + 계약 포인터 (drift D-1 해소) | 2026-06-01 |

## 호출 방식
```
Agent({ description: "SEC1 extract auth", subagent_type: "general-purpose", prompt: <브리프 내용> })
```
탐색만은 `Explore`. 병렬 독립은 `run_in_background: true`.

## 스코프 위반 검출 (메인 책임)
- `git diff --name-only` ⊆ `CAN touch`
- 적용된 마이그레이션 수정 / 변경 금지 항목 터치 → revert
- 글로서리에 없는 신규 용어 → 갱신 또는 revert
