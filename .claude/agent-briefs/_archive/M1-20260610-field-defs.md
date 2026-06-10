# 브리프 M1-20260610-field-defs — 필드 메타데이터 중앙화 (ADR-020)

## 배경 (Why)
ADR-020 (Accepted): 22필드 정의 5곳 중복 → `public/field-defs.js` 공유 모듈 1곳. **동작 보존 리팩토링** — 기능 추가 아님. 상세 맥락: docs/decisions/020-field-defs-shared-module.md.

## 산출물
1. 신규 `public/field-defs.js`
2. `api/extract-session.js` — 키목록·VALUE RULES 를 defs 에서 생성
3. `public/index.html` — `<script src="/field-defs.js">` + 키목록/FIELD_ELEMENT_MAP/evidence 대상 목록을 defs 에서 생성

## 스펙

### 1. public/field-defs.js (UMD)
```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.UD_FIELD_DEFS = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // ── coaching_logs 22 구조화 필드의 단일 진실원본 (ADR-020) ──
  const FIELDS = [ { key: 'stage', type: 'enum', enumValues: ['I','M','P','A','C','T',''], valueRule: '...', formEl: 'stageSelector', formKind: 'buttonGroup', section: 'position' }, ... ];
  return { FIELDS, STRUCTURED_FIELD_KEYS: FIELDS.map(f => f.key) };
});
```
- 22필드 전체: 현재 `api/extract-session.js` 의 `STRUCTURED_FIELD_KEYS`(:411 부근)와 **순서까지 동일하게**.
- `valueRule`: 현재 VALUE RULES(:527-553 부근)의 각 필드 줄 텍스트를 **그대로 옮긴다** (영문, 한 글자도 다듬지 말 것 — 프롬프트 동일성 목표).
- `formEl`/`formKind`: index.html 의 실제 매핑 — input/textarea 는 요소 id(`fStageDetail` 등), 버튼그룹은 kind 'buttonGroup' + 전역 상태명, metrics 는 kind 'metrics'. 현재 `FIELD_ELEMENT_MAP`(~:6700 부근, 실코드 검색)·`applyExtractedFields` 분기와 일치해야 함.
- 메모모드 등 다른 프롬프트 블록(PASS 0/1/2, EXAMPLE, MEMO MODE)은 **옮기지 않는다** — VALUE RULES 의 필드별 줄만.

### 2. API 소비
- `const { STRUCTURED_FIELD_KEYS, FIELDS } = require('../public/field-defs.js');` — 기존 하드코딩 배열 제거.
- `buildSystemPrompt` 의 VALUE RULES 블록을 `FIELDS.map(f => f.valueRule).join('\n')` 류로 생성. **목표: 생성된 시스템 프롬프트가 기존과 문자 단위 동일.** 검증에서 구/신 프롬프트 diff 첨부 — 공백 하나라도 다르면 맞춰라. 정말 불가피하게 달라지면 EXTRACTION_VERSION 을 '2026-06-10.3' 으로 올리고 사유 보고.
- normalizeModelOutput 의 키 순회는 공유 키목록 사용 (이미 동일 배열이면 참조만 교체).

### 3. 프론트 소비
- `<head>` 또는 supabase-js CDN 스크립트 근처에 `<script src="/field-defs.js"></script>` (인라인 메인 스크립트보다 **앞**).
- 인라인 스크립트에서 `UD_FIELD_DEFS.STRUCTURED_FIELD_KEYS`/`FIELDS` 로: (a) FIELD_ELEMENT_MAP 생성 (b) evidence 적용 대상 목록 (c) 스트리밍 partial parse 의 필드 키 목록 — 각각 현재 하드코딩과 결과가 동일해야 함.
- `gatherFormData`·`hydrateFormFromRecord`·폼 HTML 자체는 **이번에 재작성 금지** (동작 보존). 단, 하드코딩 키 목록이 더 있으면 위치만 보고.

## CAN touch
- 위 3개 파일만.

## MUST NOT
- 프롬프트 의미 변경 · SSE 형식 · 22필드 집합/순서 변경 금지. DB 금지. git 금지. vercel.json 수정 금지 (require 추적은 자동 — 만약 배포에서 파일 누락 문제가 의심되면 수정하지 말고 보고).

## 검증
- node --check 양쪽 + `node -e "console.log(require('./public/field-defs.js').STRUCTURED_FIELD_KEYS.length)"` = 23개(metrics 포함 현행 그대로) 확인.
- **구/신 buildSystemPrompt(false)·(true) 각각 문자 단위 diff** (git stash 또는 git show HEAD 로 구버전 추출 실행) — 동일 또는 차이 사유.
- 프론트: 생성된 FIELD_ELEMENT_MAP 이 구 하드코딩과 deep-equal 임을 node 로 증명 (DOM 없이 매핑 데이터만 비교).
- mock fetch 로 핸들러 1회 실호출 (Q2 검증 방식 재사용) — 200 + 필드 정상.
- Return Format 5섹션.
