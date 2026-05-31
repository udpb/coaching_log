# Journey — 세션 단위 시행착오 기록 (coaching-log)

> 매 세션 끝, 메인 세션이 "뭘 했고 · 뭘 틀렸고 · 다음이 알아야 할 것" 기록. 과거 삭제 금지.

## 파일 명명
`YYYY-MM-DD-<slug>.md`

## 포맷
```markdown
# YYYY-MM-DD · <한 줄 제목>

| 메타 | 값 |
|------|----|
| 메인 세션 | (모델/버전) |
| 관련 ADR | |
| 관련 브리프 | |
| 다음 진입점 | HANDOFF.md 의 섹션 |

## 한 일
## 뭘 틀렸나 / 의외 발견
## 결정한 것
## 다음 세션이 알아야 할 것
## 변경된 파일
```

## 인덱스
| 일자 | 제목 | 메인 세션 |
|------|------|-----------|
| [2026-06-01](./2026-06-01-audit-and-governance-bootstrap.md) | 심층 감사 + 운영 인프라 부트스트랩 (ADR-001) | Opus 4.8 (1M) |
| [2026-06-01 #2](./2026-06-01-p0-security-fixes.md) | P0 보안 1차 — SEC1 extract-session 인증 (ADR-002) | Opus 4.8 (1M) |
| [2026-06-01 #3](./2026-06-01-migration-drift-phase-j.md) | 마이그레이션 드리프트 — Phase J(coach_applications) 실DB 미적용 발견 | Opus 4.8 (1M) |

## 왜 Journey 인가
- ADR = 무엇을·왜. Journey = 어떻게·뭘 틀렸나. 둘 다 필요.
