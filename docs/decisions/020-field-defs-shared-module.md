# ADR-020: 22필드 정의 중앙화 — public/field-defs.js 공유 모듈

| 메타 | 값 |
|------|----|
| 상태 | Accepted |
| 일자 | 2026-06-10 |
| 작성자 | 메인 세션 (사용자 승인 — 2026-06-10 옵션 선택) |
| 관련 브리프 | M1-20260610-field-defs |
| 관련 문서 | AUDIT-2026-06-10 §2 (5곳 하드코딩) · §4 로드맵 2단계 |

---

## Context (왜)
coaching_logs 의 22개 추출 필드 정의가 5곳에 중복 하드코딩돼 있다: ① API 프롬프트 VALUE RULES ② API `STRUCTURED_FIELD_KEYS` ③ 폼 HTML ④ 폼 `FIELD_ELEMENT_MAP` ⑤ evidence 맵 (+DB 컬럼). 필드 1개 추가 = 최소 5곳 수정. 3단계(프로젝트별 템플릿 `projects.template_config`)는 "필드 정의를 데이터로 다루는 것"이 전제라, 이 중복을 먼저 끝내야 한다.

제약: 이 스택은 **빌드가 없다** — 프론트는 단일 `public/index.html`, API 는 Vercel 서버리스. import 공유가 자명하지 않음.

## Decision (무엇을)
**`public/field-defs.js` 단일 파일에 필드 메타데이터를 집약하고, 브라우저는 `<script src>`, API 는 `require()` 로 같은 파일을 읽는다** (UMD 패턴 — `module.exports` 존재 시 export, 아니면 `window.FIELD_DEFS`). Vercel 의 의존성 추적(@vercel/nft)이 require 를 따라가므로 서버리스 번들에 자동 포함된다.

- 각 필드: `key · type(text/enum/number/boolean/date/array) · enum값 · valueRule(프롬프트 규칙) · 폼 요소 매핑 · 섹션` 메타.
- API: `STRUCTURED_FIELD_KEYS`·VALUE RULES 텍스트를 defs 에서 **생성**. 프롬프트 텍스트가 달라지면 `EXTRACTION_VERSION` 갱신.
- 프론트: 필드 키 목록·FIELD_ELEMENT_MAP·evidence 맵을 defs 에서 생성. `gatherFormData`/`hydrateFormFromRecord` 의 명령형 본문은 이번 단계에서 전면 재작성하지 않는다 (동작 보존 우선 — 3단계에서 점진).

## Consequences (결과)
### Positive
- 필드 추가/변경 = field-defs.js 1곳 (+DB 마이그레이션) — 5곳 → 1곳.
- 3단계 템플릿의 자연 토대: `template_config` 가 defs 의 key 를 참조해 섹션 on/off·enum 교체.
### Negative / Trade-off
- public/ 에 노출되는 정적 파일 — 프롬프트 valueRule 영문 규칙이 공개됨 (이미 추출 결과로 유추 가능한 수준, 시크릿 아님).
- index.html 외 두 번째 프론트 파일 등장 — "단일 파일" 관행의 첫 예외 (의도된 것, ADR 로 봉인).
### 영향 받는 코드
- 신규 `public/field-defs.js` · `api/extract-session.js` (생성 로직) · `public/index.html` (script 태그 + 맵 생성) · CLAUDE.md 스택 표.

## Alternatives Considered
| 옵션 | 설명 | 왜 채택 안 됐나 |
|------|------|-----------------|
| API 만 중앙화 | 프론트 3곳 중복 유지 | 템플릿화 때 재작업 — 반쪽 해결 |
| DB 에 필드 정의 저장 | projects 테이블 등에서 로드 | 현 단계 과설계 — 코어 22필드는 전 프로젝트 공통(안정 항목), 가변은 3단계 template_config 로 |
| 3단계까지 한 번에 | 중앙화+템플릿 동시 | 변경 범위 과대 — 검증 부담, 사용자도 비권장 선택 |

## 검증 (Acceptance)
- [ ] 구 프롬프트 vs 신(생성) 프롬프트 diff — 의미 동일 (텍스트 변경 시 EXTRACTION_VERSION 갱신)
- [ ] 추출→폼 채움→저장 흐름 라이브 회귀 없음
- [x] 사용자 명시 승인 (공유 모듈 옵션 선택)

## 후속 작업
- 3단계: `projects.template_config` (섹션 토글·enum 교체·커스텀 필드 jsonb) — defs 기반.
