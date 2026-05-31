# 일하는 방식 — 메인 세션 + 서브 에이전트 + 사용자 (coaching-log)

> 최상위 룰 요약은 [../../CLAUDE.md](../../CLAUDE.md) · 서브 에이전트 룰은 [../../AGENTS.md](../../AGENTS.md).
> 원천: UDImpact-ActBot 의 working-method 를 본 레포(바닐라 스택)에 맞게 어댑테이션.

---

## 1. 핵심 철학

> **"기능을 만드는 자(서브 에이전트)와 구조를 지키는 자(메인 세션)를 분리한다."**

없으면: 구조 흐트러짐 / "문서는 나중에" → 안 함 / 결정 이유 휘발 / 유사어 침투. 그래서 **메인은 직접 구현하지 않음** 강제.

---

## 2. 역할 분담

| 역할 | 누가 | 무엇을 |
|------|------|--------|
| 사용자 | 사람 | 제품 방향 · 비즈니스 결정 · 스코프 승인 |
| 메인 세션 | Claude Code 메인 | Architect · Guardian · Curator · Orchestrator · Historian. **직접 구현 금지** |
| 서브 에이전트 | Agent 도구 | 브리프 받아 구현 → 검증 → 보고 |

### 메인이 직접 하면 안 되는 것
- `public/index.html` JS 본문 · `api/*.js` 핸들러 본문 · SQL 마이그레이션 본문
- 의존성 설치 / 환경 설정 / 보일러플레이트

### 메인이 반드시 하는 것
- 요청을 INTEGRATED_ARCHITECTURE · 감사 백로그 · 글로서리와 대조
- 스코프 크리프 → 사용자 재확인
- 중요 결정 → ADR 먼저
- 브리프 작성 → 호출 → 검증(`git diff` · 동작/RLS) → 보고
- 세션 끝 Journey + HANDOFF 갱신

> 예외: 운영 인프라 문서 작성은 메인 직접.

---

## 3. 세션 라이프사이클

**시작**: HANDOFF → Journey 최근 3건 → CLAUDE/AGENTS/glossary diff → 활성 브리프 → 요청.
**작업 들어오면**: 대조 → 스코프 판정 → 용어 검사 → ADR 먼저 → 직접(문서)/위임(코드) 분리.
**작업 중**: 브리프 작성(자급자족) → Prerequisites 재확인 → 호출 → 검증 → 보고 → 정합화. 미흡 시 브리프 보강 후 재호출 (**메인 직접 패치 금지**).
**끝**: Journey 갱신 → HANDOFF 덮어쓰기 → CLAUDE 이력 한 줄 → 사용자 5섹션 보고.

---

## 4. 서브 에이전트 호출

브리프 = `.claude/agent-briefs/<ID>-<slug>.md` ([`_template.md`](../../.claude/agent-briefs/_template.md) · 12항목 [brief-checklist.md](brief-checklist.md)).
```
Agent({ description: "SEC1 extract-session auth", subagent_type: "general-purpose", prompt: <브리프 내용> })
```
막히면 STOP 후 메인 보고. 메인이 Prerequisites/경로/결정 가이드 보강 후 재호출.

---

## 5. 의사결정 3단 계층

| 중요도 | 수단 | 예시 |
|--------|------|------|
| 높음 | **ADR** | 인증 모델 · 공유 스키마 · RLS 근본 변경 · `index.html` 프레임워크 도입 |
| 중간 | 문서 갱신 | 데이터 모델 필드 · 글로서리 |
| 낮음 | 코드 주석 / 브리프 | 변수명 · 작은 로직 |

ADR Accepted 후 수정 금지 → 새 ADR Supersedes.

---

## 6. 품질 게이트 (빌드 없음 — 검증 직접)

각 브리프 완료 시:
- [ ] 서버리스: 로컬/배포 엔드포인트 호출 결과 첨부
- [ ] DB: 마이그레이션 적용 + `-- 검증` SQL 결과
- [ ] `index.html`: 브라우저 동작 + 콘솔 에러 0
- [ ] RLS: 역할별 접근 매트릭스 확인
- [ ] Scope 위반 없음 · 글로서리 정합 · 변경 금지 미터치

---

## 7. 메인이 자주 빠지는 함정

1. "직접 짜도 되겠지" — 브리프 → 에이전트.
2. "index.html 한 줄인데 직접" — 12k줄 전역 상태 웹. 위험. 브리프.
3. "ADR 안 써도 자명" — 결정 이유 휘발.
4. "성공 보고 했으니 됐겠지" — `git diff` · 동작 직접 확인.
5. "용어 충돌 나중에" — 동의어 지옥.

---

## 8. 문서 생명주기

- INTEGRATED_ARCHITECTURE / ARCHITECTURE / HANDOVER — 기존 자산. 원본 유지, stale 는 HISTORY 표기.
- CLAUDE / AGENTS / glossary / 계약 — 메인 유지.
- ADR — Accepted 후 수정 금지.
- Journey — append only.
- 브리프 — 완료 후 `_archive/`.
- HANDOFF — 단일 라이브, 매 세션 덮어쓰기.

---

## 9. 보고

[reporting.md](reporting.md) 5섹션. 성공 위주 요약 금지. **투명한 보고가 신뢰의 기반.**
