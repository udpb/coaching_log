# HISTORY — 전 문서 인벤토리 + 신선도 (coaching-log)

> 새 세션은 HANDOFF → CLAUDE → 본 파일 순. 작성: 2026-06-01 · 메인 유지.

---

## 운영 문서 (2026-06-01 신규 · ADR-001)

| 파일 | 역할 | 신선도 |
|------|------|--------|
| `CLAUDE.md` / `AGENTS.md` / `HANDOFF.md` | 최상위 룰 · 서브 룰 · 핸드오버 | ✅ 최신 |
| `docs/glossary.md` | 용어 SoT | ✅ 최신 |
| `docs/AUDIT-2026-06-01.md` | 심층 감사 (백로그 출처) | ✅ 최신 |
| `docs/contracts/coaches-directory.md` | **공유 계약 원본 (3앱 권위)** | ✅ 최신 |
| `docs/playbook/*` / `docs/decisions/*` / `docs/journey/*` / `.claude/agent-briefs/*` | 운영 체계 | ✅ 최신 |

## 기존 제품 문서 (원본 유지 · 일부 stale)

| 파일 | 역할 | 신선도 |
|------|------|--------|
| `docs/INTEGRATED_ARCHITECTURE.md` | 4앱 통합 + Gap 1~5 | ✅ 양호 (핵심 참조) |
| `docs/ARCHITECTURE.md` | 단일 앱 아키텍처 (AWS 포터블 의도) | ✅ 양호 |
| `docs/HANDOVER.md` | 인수인계 | 🟡 일부 stale — "Gemini 3.1 Pro"(코드 `gemini-2.5-pro`) · "12 마이그레이션"(실제 28) |
| `README.md` | 개요 | 🟡 stale — `api/match-coaches.js` 참조(존재 안 함, 실제는 `extract-session.js`) · 모델명 |
| `supabase/migrations/*.sql` (28) | **스키마 SoT** | ✅ 권위 |

## 데드/제거 대상 (감사)

| 경로 | 상태 |
|------|------|
| `server.js` · `lib/csv-manager.js` · `lib/backup.js` | ❌ Vercel 死 (로컬 파일기반 프로토타입). node-cron 백업 안 돎 |
| `package.json` express/cors/node-cron/dotenv | 위 死코드 전용 의존성 |
| `api/extract-session.js:29` `GEMINI_KEY=''` | 死 상수 |
| `public/index.html:5194` `"Allow all access"` | 死 DDL 문자열 (phase4a 가 DROP) |

## 주요 구조 리스크 (감사)

- `public/index.html` 12,090줄 모놀리식 — 최대 유지보수 리스크. 점진 모듈화 후보.
- `api/extract-session.js` 무인증 + CORS `*` — P0.
- 자동 테스트 0건.

## 누락 (ADD 후보)
- extract→save + RLS 매트릭스 자동 테스트 · 평가→tier 자동 트리거 · 코치 사진 Firebase→Supabase 이전.
