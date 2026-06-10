// ============================================================
// public/field-defs.js — coaching_logs 구조화 필드의 단일 진실원본 (ADR-020)
// ------------------------------------------------------------
// 22개 추출 필드(+파생 last_done_rate = 23키) 메타데이터를 한 곳에 모은다.
//   - 브라우저: <script src="/field-defs.js"> → window.UD_FIELD_DEFS
//   - 서버리스: require('../public/field-defs.js')  (Vercel @vercel/nft 가 추적)
//
// ⚠️ 동작 보존 계약 (M1-20260610-field-defs):
//   - FIELDS 의 key 순서 = 기존 api/extract-session.js STRUCTURED_FIELD_KEYS 와 동일.
//   - valueRule 텍스트 = 기존 buildSystemPrompt() VALUE RULES 블록과 문자 단위 동일.
//     (한 글자라도 바꾸면 EXTRACTION_VERSION 을 올려야 한다 — extract-session.js 참조)
//   - VALUE_RULES_ORDER 는 역사적 프롬프트 순서를 보존한다: 프롬프트에서는
//     last_done_numerator/denominator 가 last_result 보다 먼저 나오고,
//     last_done_rate 는 프롬프트에 없다(서버에서 num/den 으로 자동 파생).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.UD_FIELD_DEFS = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 필드별 메타:
  //   key        — coaching_logs 컬럼명이자 모델 출력 fields.* 키 (순서 불변).
  //   type       — text | enum | number | boolean | date | array
  //   enumValues — type 'enum' 일 때 허용 값 ('' = 미논의)
  //   valueRule  — 시스템 프롬프트 VALUE RULES 의 해당 줄(들). 문자열 또는
  //                여러 줄 배열(next_deadline). null = 프롬프트에 줄 없음.
  //   section    — 폼 섹션: basic|position|commitment|diagnosis|next|metrics|notes
  //   formEl     — 폼 앵커 요소 id (input/textarea/select id, 버튼그룹·메트릭은
  //                컨테이너 id). null = 전용 폼 요소 없음(파생 스칼라).
  //   formKind   — input | textarea | date | select | checkbox | buttonGroup |
  //                metrics | computed
  //   stateVar   — buttonGroup 의 전역 상태 변수명 (index.html)
  //   lowConfEl  — markLowConfidence() 가 하이라이트할 요소 id (null = 대상 아님)
  //   evidenceEl — fieldLabelNode() evidence 배지 앵커 id (null = 대상 아님;
  //                last_commitment 는 #commitmentLabel 특례로 맵에서 제외)
  //   streamScalar — 스트리밍 partial parse 의 문자열 스칼라 regex 대상 여부
  //                (energy/ai_used 는 별도 전용 regex, metrics 는 미대상)
  const FIELDS = [
    {
      key: 'stage', type: 'enum',
      enumValues: ['I', 'M', 'P', 'A', 'C', 'T', ''],
      valueRule: '  - stage: "I" (Ideation) | "M" (Market) | "P" (Product/Prototype) | "A" (Acquisition) | "C" (Commercialization) | "T" (Traction) | "".',
      section: 'position', formEl: 'stageSelector', formKind: 'buttonGroup', stateVar: 'selectedStage',
      lowConfEl: 'stageSelector', evidenceEl: 'stageSelector', streamScalar: true
    },
    {
      key: 'stage_detail', type: 'text',
      valueRule: '  - stage_detail: short phrase describing the founder\'s specific position within the stage.',
      section: 'position', formEl: 'fStageDetail', formKind: 'input',
      lowConfEl: 'fStageDetail', evidenceEl: 'fStageDetail', streamScalar: true
    },
    {
      key: 'main_topic', type: 'text',
      valueRule: '  - main_topic: the SURFACE topic — what the session nominally discussed.',
      section: 'position', formEl: 'fMainTopic', formKind: 'input',
      lowConfEl: 'fMainTopic', evidenceEl: 'fMainTopic', streamScalar: true
    },
    {
      key: 'last_commitment', type: 'text',
      valueRule: '  - last_commitment: what the founder committed to last session. "" on first session.',
      section: 'commitment', formEl: 'fLastCommitment', formKind: 'textarea',
      lowConfEl: 'fLastCommitment', evidenceEl: null, streamScalar: true
    },
    {
      key: 'last_done', type: 'enum',
      enumValues: ['done', 'partial', 'not_done', ''],
      valueRule: '  - last_done: "done" | "partial" | "not_done" | "". Only for non-first sessions.',
      section: 'commitment', formEl: 'doneSelector', formKind: 'buttonGroup', stateVar: 'selectedDone',
      lowConfEl: 'doneSelector', evidenceEl: 'doneSelector', streamScalar: true
    },
    {
      key: 'last_number', type: 'text',
      valueRule: '  - last_number: concrete numeric outcome of last commitment (e.g. "7 interviews out of 10").',
      section: 'commitment', formEl: 'fLastNumber', formKind: 'input',
      lowConfEl: 'fLastNumber', evidenceEl: 'fLastNumber', streamScalar: true
    },
    {
      key: 'last_result', type: 'text',
      valueRule: '  - last_result: what was learned from last commitment — the insight, not just the fact.',
      section: 'commitment', formEl: 'fLastResult', formKind: 'input',
      lowConfEl: 'fLastResult', evidenceEl: 'fLastResult', streamScalar: true
    },
    {
      key: 'last_done_numerator', type: 'number',
      valueRule: '  - last_done_numerator: the completed count (number, e.g. 7). Same source as last_number but isolated for aggregation. "" if not quantifiable.',
      section: 'commitment', formEl: null, formKind: 'computed',
      lowConfEl: null, evidenceEl: null, streamScalar: false
    },
    {
      key: 'last_done_denominator', type: 'number',
      valueRule: '  - last_done_denominator: the target count (number, e.g. 10). "" if the commitment wasn\'t numeric (e.g. "finish the deck") or if not given.',
      section: 'commitment', formEl: null, formKind: 'computed',
      lowConfEl: null, evidenceEl: null, streamScalar: false
    },
    {
      key: 'last_done_rate', type: 'number',
      valueRule: null, // 프롬프트에 없음 — 서버(normalizeModelOutput)가 num/den 으로 자동 파생
      section: 'commitment', formEl: null, formKind: 'computed',
      lowConfEl: null, evidenceEl: null, streamScalar: false
    },
    {
      key: 'real_issue', type: 'text',
      valueRule: '  - real_issue: the ROOT-CAUSE issue discovered today. Must differ from main_topic. If the session stayed at surface level, leave "".',
      section: 'diagnosis', formEl: 'fRealIssue', formKind: 'textarea',
      lowConfEl: 'fRealIssue', evidenceEl: 'fRealIssue', streamScalar: true
    },
    {
      key: 'blocker_type', type: 'enum',
      enumValues: ['모르겠음', '뭘 해야 할지 모름', '방법을 모름', '두려움/회피', '시간/자원 부족', '방향이 틀림', '팀 내부 갈등', ''],
      valueRule: '  - blocker_type: one of "모르겠음" | "뭘 해야 할지 모름" | "방법을 모름" | "두려움/회피" | "시간/자원 부족" | "방향이 틀림" | "팀 내부 갈등", or "" if unclear.',
      section: 'diagnosis', formEl: 'blockerSelector', formKind: 'buttonGroup', stateVar: 'selectedBlocker',
      lowConfEl: 'blockerSelector', evidenceEl: 'blockerSelector', streamScalar: true
    },
    {
      key: 'ai_used', type: 'boolean',
      valueRule: '  - ai_used: boolean — did the founder or coach discuss using AI tools during execution?',
      section: 'diagnosis', formEl: 'fAiUsed', formKind: 'checkbox',
      lowConfEl: null, evidenceEl: 'fAiUsed', streamScalar: false
    },
    {
      key: 'next_action', type: 'text',
      valueRule: '  - next_action: WHAT the founder commits to do next.',
      section: 'next', formEl: 'fNextAction', formKind: 'textarea',
      lowConfEl: 'fNextAction', evidenceEl: 'fNextAction', streamScalar: true
    },
    {
      key: 'next_deadline', type: 'date',
      valueRule: [
        '  - next_deadline: WHEN — MUST be a single ISO date in YYYY-MM-DD format.',
        '      · Use the session "date" from context as today\'s reference when resolving natural-language dates ("다음주 금요일", "next Friday", "이번주까지").',
        '      · If the transcript only gives a range (e.g. "월-수요일 사이에", "이번주 내로", "Monday to Wednesday"), pick the LAST day of the range — this is the conservative deadline that locks in the commitment.',
        '      · If the transcript says "before next session" or similar relative-to-session phrasing and no concrete date is given, leave "" and flag low_confidence.',
        '      · NEVER return natural language like "다음주 금요일" or a range like "2026-04-21 ~ 2026-04-24" — always a single YYYY-MM-DD.'
      ],
      section: 'next', formEl: 'fNextDeadline', formKind: 'date',
      lowConfEl: 'fNextDeadline', evidenceEl: 'fNextDeadline', streamScalar: true
    },
    {
      key: 'next_evidence', type: 'text',
      valueRule: '  - next_evidence: HOW to verify completion (concrete artifact/number).',
      section: 'next', formEl: 'fNextEvidence', formKind: 'input',
      lowConfEl: 'fNextEvidence', evidenceEl: 'fNextEvidence', streamScalar: true
    },
    {
      key: 'next_checkin', type: 'text',
      valueRule: '  - next_checkin: free-text natural-language summary ("목요일에 메시지로 점검"). Keep this as a human-readable sentence.',
      section: 'next', formEl: 'fNextCheckin', formKind: 'input',
      lowConfEl: 'fNextCheckin', evidenceEl: 'fNextCheckin', streamScalar: true
    },
    {
      key: 'next_checkin_date', type: 'date',
      valueRule: '  - next_checkin_date: same check-in as above but as a single YYYY-MM-DD. Range → latest day. "" if no specific date given.',
      section: 'next', formEl: 'fNextCheckinDate', formKind: 'date',
      lowConfEl: null, evidenceEl: null, streamScalar: false
    },
    {
      key: 'next_checkin_channel', type: 'enum',
      enumValues: ['message', 'call', 'video', 'email', 'inperson', 'other', ''],
      valueRule: '  - next_checkin_channel: how the coach will check in. One of: "message" | "call" | "video" | "email" | "inperson" | "other" | "". Pick the best match; leave "" only if truly ambiguous.',
      section: 'next', formEl: 'fNextCheckinChannel', formKind: 'select',
      lowConfEl: null, evidenceEl: null, streamScalar: false
    },
    {
      key: 'session_note', type: 'text',
      valueRule: '  - session_note: the coach\'s reflection / takeaway on this session.',
      section: 'notes', formEl: 'fSessionNote', formKind: 'input',
      lowConfEl: 'fSessionNote', evidenceEl: 'fSessionNote', streamScalar: true
    },
    {
      key: 'watch_next', type: 'text',
      valueRule: '  - watch_next: what the coach will specifically watch for next session.',
      section: 'notes', formEl: 'fWatchNext', formKind: 'input',
      lowConfEl: 'fWatchNext', evidenceEl: 'fWatchNext', streamScalar: true
    },
    {
      key: 'energy', type: 'number',
      valueRule: '  - energy: integer 1-5 for founder\'s emotional state, or 0 if not inferable.',
      section: 'notes', formEl: 'energySelector', formKind: 'buttonGroup', stateVar: 'selectedEnergy',
      lowConfEl: 'energySelector', evidenceEl: 'energySelector', streamScalar: false
    },
    {
      key: 'metrics', type: 'array',
      valueRule: '  - metrics: array of { "name": snake_case, "value": "..." } for numeric business metrics mentioned (customers, revenue, conversions). value is the object\'s `value` field (the outer metrics.value is this array).',
      section: 'metrics', formEl: 'metricGrid', formKind: 'metrics',
      lowConfEl: 'metricGrid', evidenceEl: 'metricGrid', streamScalar: false
    }
  ];

  // 모델 출력 정규화(normalizeModelOutput)·키 순회용 — FIELDS 순서 그대로.
  const STRUCTURED_FIELD_KEYS = FIELDS.map(function (f) { return f.key; });

  // 시스템 프롬프트 VALUE RULES 의 역사적 출력 순서 (STRUCTURED_FIELD_KEYS 와
  // 다름 — 주석 상단 참조). last_done_rate 는 제외(프롬프트 줄 없음).
  const VALUE_RULES_ORDER = [
    'stage', 'stage_detail', 'main_topic',
    'last_commitment', 'last_done', 'last_number',
    'last_done_numerator', 'last_done_denominator', 'last_result',
    'real_issue', 'blocker_type', 'ai_used',
    'next_action', 'next_deadline', 'next_evidence',
    'next_checkin', 'next_checkin_date', 'next_checkin_channel',
    'session_note', 'watch_next', 'energy', 'metrics'
  ];

  const byKey = {};
  FIELDS.forEach(function (f) { byKey[f.key] = f; });

  // VALUE RULES 블록의 줄 배열 (next_deadline 은 5줄로 전개) — join('\n') 하면
  // 기존 buildSystemPrompt 의 해당 블록과 문자 단위 동일해야 한다.
  const VALUE_RULES_LINES = [];
  VALUE_RULES_ORDER.forEach(function (key) {
    const rule = byKey[key].valueRule;
    if (rule === null || rule === undefined) return;
    if (Array.isArray(rule)) { rule.forEach(function (line) { VALUE_RULES_LINES.push(line); }); }
    else { VALUE_RULES_LINES.push(rule); }
  });

  // markLowConfidence() 용: field key → 하이라이트 대상 요소 id
  const LOW_CONF_ELEMENT_MAP = {};
  FIELDS.forEach(function (f) { if (f.lowConfEl) LOW_CONF_ELEMENT_MAP[f.key] = f.lowConfEl; });

  // fieldLabelNode() 용: field key → evidence 배지 앵커 요소 id
  // (last_commitment 는 #commitmentLabel 특례 처리라 의도적으로 제외)
  const EVIDENCE_ELEMENT_MAP = {};
  FIELDS.forEach(function (f) { if (f.evidenceEl) EVIDENCE_ELEMENT_MAP[f.key] = f.evidenceEl; });

  // partialParseFields() 의 문자열 스칼라 regex 대상 키 (FIELDS 순서 보존)
  const STREAM_SCALAR_KEYS = FIELDS
    .filter(function (f) { return f.streamScalar; })
    .map(function (f) { return f.key; });

  return {
    FIELDS: FIELDS,
    STRUCTURED_FIELD_KEYS: STRUCTURED_FIELD_KEYS,
    VALUE_RULES_ORDER: VALUE_RULES_ORDER,
    VALUE_RULES_LINES: VALUE_RULES_LINES,
    LOW_CONF_ELEMENT_MAP: LOW_CONF_ELEMENT_MAP,
    EVIDENCE_ELEMENT_MAP: EVIDENCE_ELEMENT_MAP,
    STREAM_SCALAR_KEYS: STREAM_SCALAR_KEYS
  };
});
