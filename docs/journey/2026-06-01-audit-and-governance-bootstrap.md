# 2026-06-01 · 심층 감사 + 운영 인프라 부트스트랩

| 메타 | 값 |
|------|----|
| 메인 세션 | Opus 4.8 (1M) |
| 관련 ADR | [ADR-001](../decisions/001-working-method-bootstrap.md) |
| 관련 브리프 | (없음 — 메인 직접 작성) |
| 다음 진입점 | [HANDOFF.md](../../HANDOFF.md) "다음 액션" |

## 한 일

- 5개 에이전트 병렬 심층 감사 (coach-finder · coaching-log 전체 · 공유 데이터레이어).
- coaching-log 핵심 확인:
  - `api/extract-session.js:93` 무인증 + `CORS *` → 익명 Gemini 비용/transcript POST.
  - `public/index.html` = 12,090줄 모놀리식 (빌드 없음, ~87 `innerHTML`, ~60 전역). 최대 유지보수 리스크.
  - RLS 설계는 전문가급 (SECURITY DEFINER 헬퍼 + PM 격리 phase_d3). extract 파이프라인(3-pass + 잘림복구)도 우수.
  - `coach_applications` anon INSERT 공개 (phase_j:91).
  - `server.js`·`lib/csv-manager.js`·`lib/backup.js` = Vercel 死코드. node-cron 백업 안 돎.
  - 문서 stale: README "Gemini 3.1 Pro"(코드 2.5) · `api/match-coaches.js` 없음 · "12 마이그레이션"(실제 28).
- ActBot 운영 체계 이식 (ADR-001).
- **공유 `coaches_directory` 계약 원본을 본 레포에 작성** (`docs/contracts/coaches-directory.md`) — 스키마 SoT 이므로. coach-finder·ud-ops 는 포인터.

## 뭘 틀렸나 / 의외 발견

- ud-ops `supabase-source.ts` 의 `coaches_directory` 사본이 이미 4컬럼 drift → 3중 복사가 시한폭탄임을 실증.
- `index.html:5194` 의 `"Allow all access"` 는 SQL 문자열 리터럴(死 DDL) — `phase4a` 가 DROP. 활성 정책 아님 (오해 주의).

## 결정한 것

- 거버넌스 = 두 레포 각각 + 공유 계약 단일 파일(본 레포 원본) (사용자).
- 구현 = 전부 브리프→서브에이전트 (사용자).

## 다음 세션이 알아야 할 것

- 사용자 GO 후 첫 브리프 `SEC1`(extract-session 인증). P0 순서는 HANDOFF 참조.
- `index.html` 작업은 반드시 함수/뷰/라인 범위로 좁힌 브리프로.

## 변경된 파일

- 신규: CLAUDE.md · AGENTS.md · HANDOFF.md · docs/glossary.md · docs/HISTORY.md · docs/AUDIT-2026-06-01.md · docs/contracts/coaches-directory.md(**원본**) · docs/playbook/*(3) · docs/decisions/{000,README,001} · docs/journey/{README, 본 파일} · .claude/agent-briefs/{README,_template,_archive/.gitkeep}
