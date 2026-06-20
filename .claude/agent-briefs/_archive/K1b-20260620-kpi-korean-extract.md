# 브리프 K1b-20260620-kpi-korean-extract — 추출이 한국어 KPI 이름 반환 + required_kpis 매칭

## 배경 (Why)
ADR-022 (docs/decisions/022-project-required-kpis.md 필독) 2단계 = 추출 연동. K1a 가 DB 컬럼
`projects.required_kpis`(`[{name:"DAU"},…]`) + 관리 모달 편집 + 신규 폼 prefill 까지 완료
(`.claude/agent-briefs/_archive/K1a-20260615-required-kpis-db-ui.md`).

**남은 문제 (사용자가 세션 첫머리에 지적):** 핵심 숫자(metrics) 카드에 **영어 라벨이 중복**으로 뜬다.
원인 — 모델이 metrics 이름을 `snake_case` 영어(`PAID_CUSTOMERS`)로 반환하는데, 프로젝트 카드는
한국어("유료 고객") 또는 영어 i18n 키(`metric_paying_customers`, 표시 라벨만 한국어)라서
병합 시 **정확 일치 실패 → AI 영어 항목이 별도 카드로 push** → "유료 고객"(빈칸) + "PAID_CUSTOMERS=5"
중복. 본 브리프가 이를 **완전 해결**한다: ① 모델이 한국어 이름 반환 + 프로젝트 required_kpis 의
이름을 그대로(verbatim) 사용하도록 프롬프트 유도, ② 클라 병합을 표시 라벨까지 포함한 정규화 매칭으로
강화(모델이 살짝 다른 한국어를 줘도/DEFAULT_METRICS 프로젝트여도 중복 방지).

## 산출물 (CAN touch — 이 3개 파일만)
1. `public/field-defs.js` — metrics valueRule 1줄 교체
2. `api/extract-session.js` — buildUserPrompt 컨텍스트 주입 + 예시 metrics 이름 정정 + EXTRACTION_VERSION 범프
3. `public/index.html` — extract 컨텍스트에 required_kpis 추가 + metrics 병합 매칭 강화

## 스펙

### 1. `public/field-defs.js` — metrics valueRule (현재 ~184행, `key: 'metrics'` 항목의 valueRule)
현재:
```
'  - metrics: array of { "name": snake_case, "value": "..." } for numeric business metrics mentioned (customers, revenue, conversions). value is the object\'s `value` field (the outer metrics.value is this array).'
```
다음으로 교체 (영어→한국어 이름 규칙 + required-KPI verbatim 매칭 지시):
```
'  - metrics: array of { "name": "<한국어 지표명>", "value": "..." } for numeric business metrics mentioned (customers, revenue, conversions). The "name" MUST be a SHORT KOREAN label (e.g. "유료 고객", "월 매출", "전환율") — NOT English, NOT snake_case with underscores. IF the session context lists "Required KPIs for this project", you MUST reuse the EXACT name string given there (verbatim, character-for-character) for any metric that corresponds to one, and only introduce a new Korean name for a genuinely different metric not in that list. value is the object\'s `value` field (the outer metrics.value is this array).'
```
⚠️ field-defs.js 주석(11행)에 명시된 계약: valueRule 변경 시 EXTRACTION_VERSION 범프 필수(아래 2-c).
⚠️ 한 줄 문자열이므로 `\'` 이스케이프 정확히. 이 줄만 바꾸고 FIELDS 의 key 순서/다른 필드 불변.

### 2. `api/extract-session.js`

**(a) buildUserPrompt — required_kpis 주입** (현재 ~720행 `function buildUserPrompt(transcript, ctx, prev, isFirst, isMemo)`).
`ctx.required_kpis` 는 클라가 넘기는 **문자열 배열**(이름들). prev 블록 근처(header.push 들 사이)에서,
값이 있을 때만 다음 블록을 추가:
```
## Required KPIs for this project (use these EXACT names verbatim for matching metrics)
- <이름1>
- <이름2>
```
가드: `Array.isArray(ctx.required_kpis) && ctx.required_kpis.length` 일 때만. 각 이름 trim, 빈 항목 제외.
시그니처 변경 불필요(ctx 이미 인자). memo/audio 모드 모두 ctx 흐르므로 자동 적용.

**(b) buildSystemPrompt 예시 metrics 이름 정정** (현재 ~713행 EXAMPLE 블록 metrics):
새 "snake_case 금지" 규칙과 모순 안 되게 예시도 정정 —
`"인터뷰_완료"` → `"인터뷰 완료"`, `"파일럿_의향_고객"` → `"파일럿 의향 고객"` (밑줄 → 공백).
metrics 줄의 evidence/value 등 다른 부분은 그대로. 다른 예시 필드 불변.

**(c) EXTRACTION_VERSION 범프** (60행):
`const EXTRACTION_VERSION = '2026-06-10.2';` → `'2026-06-20.1';`

### 3. `public/index.html`

**(a) extract 컨텍스트에 required_kpis 추가** (현재 ~7487행 `runSttExtract` 의 `const ctx = {…}`):
ctx 객체에 한 줄 추가:
```js
    required_kpis: (typeof projectRequiredKpiNames === 'function' ? projectRequiredKpiNames() : []),
```
`projectRequiredKpiNames()` (~6612행, 이미 존재)는 현재 프로젝트 required_kpis 의 정규화 이름 배열 반환.
이 ctx 는 text/audio/memo 세 경로 모두 `Object.assign({}, ctx, { prev })` 로 서버에 전달됨(7510-7513) — 자동 포함.

**(b) metrics 병합 매칭 강화** (현재 ~7907-7915행, `applyExtractedFields` 내 `!isPartial` metrics 블록):
현재 코드:
```js
      const byName = {};
      (currentMetrics || []).forEach(m => { byName[(m.name || '').replace(/^metric_/, '')] = m; });
      for (const m of incoming) {
        if (byName[m.name]) {
          if (m.value) byName[m.name].value = m.value;
        } else {
          currentMetrics.push({ name: m.name, value: m.value });
        }
      }
```
를 **정규화 + 표시라벨 매칭**으로 교체(중복 방지 핵심). 들어온 AI 한국어 이름을, 기존 카드의
`name` 정규화 OR 표시라벨 `t(name)` 정규화 양쪽으로 매칭. 매칭되면 기존 카드 **이름은 유지하고 값만**
갱신(PM 이 정한 KPI 이름·i18n 키가 canonical). 미매칭이면 진짜 신규 지표로 push. 예시:
```js
      // K1b: 정규화(metric_ 접두 제거·trim·lowercase) + 표시라벨(t(name)) 양면 매칭.
      // 모델이 한국어 이름을 주고 카드가 한국어 KPI 이거나 영어 i18n 키(DEFAULT_METRICS,
      // 표시만 한국어)여도 동일 지표로 인식 → 영어/중복 카드 push 방지. 기존 카드 이름은
      // canonical 로 유지하고 값만 채운다. (augmentWithRequiredKpis 의 dedup 과 같은 사상)
      const _norm = s => String(s == null ? '' : s).replace(/^metric_/, '').trim().toLowerCase();
      const findCard = (incomingName) => {
        const key = _norm(incomingName);
        for (const card of (currentMetrics || [])) {
          if (_norm(card.name) === key) return card;
          const label = (typeof t === 'function') ? t(card.name) : card.name;
          if (label && _norm(label) === key) return card;
        }
        return null;
      };
      for (const m of incoming) {
        const card = findCard(m.name);
        if (card) {
          if (m.value) card.value = m.value;
        } else {
          currentMetrics.push({ name: m.name, value: m.value });
        }
      }
```
incoming 의 `name` 은 7902행에서 이미 `metric_` 접두 제거됨 — `_norm` 도 제거하므로 정합. 그 위
unwrap/shape 보정(7884-7905)·로그(7906)·이후 렌더(7930-) 불변.

## MUST NOT
- 위 3파일 외 변경 금지. 기존 마이그레이션 수정 금지. DB/RLS 변경 없음(본 브리프는 코드만).
- DEFAULT_METRICS·projectRequiredKpiNames·initialMetricsForProject·augmentWithRequiredKpis 함수
  로직 변경 금지(병합부만 손댐). required_kpis 저장 shape(`[{name}]`) 변경 금지.
- escHtml/escAttr 규칙 준수(이 변경은 새 innerHTML sink 없음 — 값만 셋). git 금지(메인이 커밋).
- `--no-verify` 금지. EXTRACTION_VERSION 형식 `YYYY-MM-DD.<serial>` 유지.

## 검증 (빌드 없음 — 증거 첨부)
1. `node --check api/extract-session.js` · `node --require ./public/field-defs.js -e ""` 불가하면
   `node -e "const m=require('./public/field-defs.js'); console.log(m.VALUE_RULES_LINES.find(l=>l.includes('metrics')))"`
   로 새 metrics 규칙 줄이 한국어 지시 포함하는지 출력.
2. `public/index.html` 인라인 스크립트 추출 → `node --check` (또는 변경 함수 구문 점검).
3. **병합 로직 단위 시뮬레이션**(node): currentMetrics=[{name:'metric_paying_customers',value:''}]
   (표시라벨 '유료 고객'), incoming=[{name:'유료 고객',value:'5'}] → 결과가 **카드 1개**
   (`metric_paying_customers` 값 '5'), 중복 0 임을 보여라. t() 가 node 에 없으면 라벨맵을
   가짜로 주입해 검증. 또 required_kpis 케이스: currentMetrics=[{name:'유료 전환율',value:''}],
   incoming=[{name:'유료 전환율',value:'12%'}] → 카드 1개 값 채움.
4. EXTRACTION_VERSION 이 '2026-06-20.1' 로 바뀐 grep 결과.
5. ⚠️ 라이브 배포(Vercel)·브라우저 실측은 메인이 함. 보고서에 "배포 후 메인이 확인할 것" 명시:
   required_kpis 설정 프로젝트에서 실제 추출 시 한국어 이름·중복 없음.

## Return Format (5섹션 필수)
한 일(파일:라인) / 못한 일 / 결정(ADR 후보) / 검증(위 1-4 실제 실행 결과·출력) / 위험 신호.
