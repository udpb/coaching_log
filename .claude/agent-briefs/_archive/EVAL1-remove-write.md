# Brief EVAL1 — coaching-log 평가 쓰기 제거 (읽기 유지) · Gap3

> 자급자족 브리프. 본 파일 + CLAUDE.md + AGENTS.md + docs/glossary.md 외 컨텍스트 불필요.

| 메타 | 값 |
|------|----|
| ID | `EVAL1-remove-write` · P2 · 브랜치 `fix/eval-readonly` |
| 관련 | coach-finder ADR-011 (평가 쓰기 = coach-finder 단일 소유) |

## 🎯 Mission
coaching-log 의 `coach_evaluations` **쓰기(작성·편집·삭제) UI/함수를 제거**하고, **읽기(평가 목록 표시)는 유지**한다. BP 상세 평가 섹션은 "보기 전용 + 평가는 coach-finder 에서" 안내. 빌드 없는 단일 파일 — `node --check`(인라인 JS) 통과 필수.

## 📋 Context
- 평가는 coach-finder 가 단일 소유(ADR-011). coaching-log 는 표시만.
- 양쪽 읽기는 독립 SELECT — 쓰기 제거해도 표시 무영향.
- 제거 대상(쓰기): 평가 모달 HTML(~3760-3845) · `saveBPEval`(~11771) · `deleteBPEval`(~11852) · `deleteBPEvalFromModal`(~11874) · `openBPEvalCreateModal`(~11679) · `openBPEvalEditModal`(~11719) · `canWriteEval` 사용처의 편집/삭제/새평가 버튼(~11007-11055).
- 유지(읽기): 평가 목록 fetch·렌더(`_bpDetailEvaluations`, `renderBPDetailBody` 의 평가 표시 부분).

## ✅ Prerequisites (STOP)
- [ ] 위 함수/HTML 존재 확인(라인 이동 가능 — grep 보정).
- [ ] 평가 **읽기** 경로(목록 fetch + 표시)가 쓰기 함수와 **분리**돼 있는지 확인. 얽혀 있으면 STOP 보고(어디가 얽혔는지).

## 📖 Read First
1. CLAUDE.md · AGENTS.md · docs/glossary.md
2. `public/index.html`: 3760-3845(평가 모달 HTML) · 11000-11060(평가 섹션 렌더 = 읽기+버튼) · 11679-11900(쓰기 함수들)

## 🎯 Scope
### CAN touch
- `public/index.html` (평가 쓰기 모달 HTML + 쓰기 함수 + 쓰기 버튼만)
### MUST NOT touch
- 평가 **읽기**(목록 fetch·표시) · 다른 화면 · 스키마/RLS · escHtml 헬퍼 · 변경 금지 항목

## 🛠 Tasks
1. **쓰기 버튼 제거**: 평가 섹션 렌더(11007-11055)에서 "✏️ 편집"·"🗑 삭제"·"+ 새 평가" 버튼 생성부 제거. `canWriteEval` 분기가 그 버튼들에만 쓰이면 관련 변수도 정리.
2. **안내 추가**: 평가 섹션에 "평가 작성·수정은 coach-finder 에서 합니다" 한 줄(기존 톤, var(--gray500) 정도). 평가 0건일 때도 자연스럽게.
3. **쓰기 함수 제거**: `saveBPEval`·`deleteBPEval`·`deleteBPEvalFromModal`·`openBPEvalCreateModal`·`openBPEvalEditModal` + 그들만 쓰는 헬퍼(예: 평가 모달 상태 변수) 삭제.
4. **모달 HTML 제거**: 평가 작성/편집 모달(`#bpEvalModal` 류, 3760-3845) 제거. 그 모달만 여는 코드도 제거.
5. **읽기 보존 확인**: 평가 목록 표시는 그대로 동작해야 함. 표시에 쓰는 fetch/변수는 건드리지 말 것.
6. **죽은 참조 0**: 제거한 함수명 grep → 0(주석 제외). `node --check` 통과.

## 🔒 Tech Constraints
- 빌드 없음 — 검증 = node --check(인라인 추출) + HTML 균형 육안. escHtml 유지. 파괴적 git·`--no-verify` 금지.

### node --check
```
python3 -c "import re;src=open('public/index.html',encoding='utf-8').read();s=re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>',src,re.S);open('_chk.js','w',encoding='utf-8').write(chr(10)+';'+chr(10).join(s))"
node --check _chk.js && echo OK
rm -f _chk.js
```

## ✔️ Definition of Done
- [ ] 평가 쓰기 모달·함수·버튼 제거, 읽기(표시) 유지
- [ ] "평가는 coach-finder 에서" 안내
- [ ] 제거 함수 grep 0(주석 제외) · `node --check` OK · HTML 균형
- [ ] `git diff --name-only` = public/index.html 만

## 📤 Return Format
```
## ✅ 한 일  (제거 모달/함수/버튼 + 안내 + 읽기 보존 근거)
## ❌ 못한 일 / 보류
## 🤔 결정한 것  (canWriteEval 처리·안내 문구·얽힌 코드 분리법)
## 🔬 검증  (node --check · 제거함수 grep 0 · 읽기 동작 확인)
## ⚠️ 위험 신호 / 다음 (없으면 "없음")
```

## 🚫 Do NOT
- 평가 읽기/표시 제거 · 스키마/RLS · 다른 화면 · escHtml 우회 · 죽은 함수 잔존 · hook 우회

## 🏁 Final Note
부수 발견은 "위험 신호"에만. 본 브리프는 평가 쓰기 제거 + 읽기 유지만.
