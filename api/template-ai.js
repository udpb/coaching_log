// Vercel Serverless Function — 리포트 템플릿 AI 파이프라인
// POST /api/template-ai
//
// 리포트 템플릿(AI 자동채움) 기능의 AI 단계. 두 모드:
//   · mode:'ingest' (B3, 본 파일) — B2 문서 스켈레톤 → AI 슬롯 스키마.
//       AI 는 "채울 슬롯 목록 + 반복그룹" 만 식별한다(값 배정 아님).
//   · mode:'fill'   (B4, 예정)    — 슬롯 스키마 + 세션 데이터 →
//       슬롯별 { value, evidence, confidence }. 아래 handler 에 자리만 예약.
//
// 설계 확정안: LLM-Wiki [[코칭로그 템플릿 기반 리포트]] (3단계 파이프라인).
// 원칙: AI 는 최종 파일을 만들지 않는다 — 매핑만. 서식 보존 주입은 렌더러(코드).
//
// 인증: extract-session 과 동일하게 Supabase 로그인 JWT 필수(verifyAuth). 401.
// 모델: ingest 는 정확도 우선 → PRIMARY(gemini-2.5-pro), 지속 실패 시 flash 폴백.
//       JSON-mode + thinkingBudget 캡 + 잘림복구(공용 geminiClient 재사용).
//
// Body (ingest):
//   { mode:'ingest', format:'docx'|'xlsx', skeleton:{...B2 출력...}, template_name? }
// Response (200):
//   { slot_schema:{ template_kind, slots:[...], repeat_groups:[...] },
//     ingest_model, ingest_version, usage }
'use strict';

// 22 구조화 필드 키 (ADR-020, field_guess 허용 어휘) — @vercel/nft 가 추적.
const { STRUCTURED_FIELD_KEYS } = require('../public/field-defs.js');
const {
  callWithFallback,
  verifyAuth,
  extractGeminiText,
  parseJsonFromText,
  applyCors
} = require('./_lib/geminiClient.js');

// ingest/fill 프롬프트·스키마 버전. 의미가 바뀌는 변경마다 범프(EXTRACTION_VERSION 동형).
const INGEST_VERSION = '2026-07-06.3'; // .3: xlsx 세로 행반복(xlsx_row_pattern/axis) 지원
const FILL_VERSION   = '2026-07-06.2'; // .2: report 컨텍스트 키 힌트 추가(표지 자동채움)

// 세션 필드(field-defs 22키) + 리포트/메타 레벨 키 = field_guess 허용 목록.
// 허용 밖 키는 normalizeSlotSchema 에서 null 로 강등(환각 키 차단).
// 표지 메타(program_name·period_from/to·coach_org·session_count·generated_date)는
// fill 입력 report 컨텍스트로 채울 수 있는 값 → 허용에 포함해 표지 자동채움(2026-07-06).
// ⚠️ 여기 없는 진짜 gap(진행방식 modality·시각 session_time·종합의견 overall_summary·
//    이미지·자가진단)은 그대로 field_guess=null → fill 공란강제 유지(정책 불변).
const REPORT_LEVEL_KEYS = [
  'session_num', 'date', 'coach', 'team_name', 'founder_name',
  'session_type', 'narrative_summary',
  // 표지/리포트 레벨 메타 (fill 의 report 컨텍스트에서 채움)
  'program_name', 'period_from', 'period_to', 'coach_org',
  'session_count', 'generated_date'
];
const ALLOWED_FIELD_GUESS = STRUCTURED_FIELD_KEYS.concat(REPORT_LEVEL_KEYS);

const SAFETY_BLOCK_NONE = [
  { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
];

// ── 프롬프트 ─────────────────────────────────────────────────────────────
function buildIngestSystemPrompt() {
  return [
    'You are a document-template STRUCTURE analyzer for a Korean startup-coaching report tool.',
    'INPUT is a "document skeleton": the text blocks (docx) or spreadsheet cells (xlsx) of an EMPTY report template a client organization uses to receive coaching reports. Labels are Korean.',
    'GOAL: identify every SLOT (a position where the coach\'s coaching data should be written) and how sessions repeat. You do NOT fill values — you only map structure.',
    '',
    'Definitions:',
    '- slot = a fill-in position: an empty cell/paragraph next to a label, OR a cell/paragraph containing GRAY EXAMPLE text (e.g. "실제 작성 시 삭제", sample sentences). Treat example/placeholder text as a fillable slot — the example is a hint, not a real value.',
    '- label = the nearest Korean header describing what goes there (e.g. "컨설팅 주제", "현재 고민&현황", "다음회차 과제", "진행 일시").',
    '- anchor = WHERE to write. docx → { "block_id": "<the target block_id>" }. xlsx → { "sheet": "<sheet name>", "cell": "<A1 address>" }.',
    '- level = "report" (appears once: 표지·컨설턴트·업체·기간) or "session" (repeats per 회차).',
    '- repeat_group = if the slot repeats per session, the id of its repeat group; else null.',
    '- field_guess = best guess of which coaching field fills it, chosen ONLY from the ALLOWED list given in the user message. If none fits (e.g. 진행 방식 online/offline, 진행 시각, 종합 의견/총평, 진행 사진·이미지, 자가진단 설문), use null. NEVER invent a key outside the ALLOWED list.',
    '- confidence = 0..1, how sure you are this is a real fillable slot.',
    '',
    'Repeat groups:',
    '- docx: sessions usually repeat as a table block. Provide "docx_block_range": ["<first block_id>","<last block_id>"] covering ONE session\'s block.',
    '- xlsx: decide whether sessions(회차) repeat ACROSS COLUMNS (가로/전치 매트릭스) or DOWN ROWS (세로). Set "axis":"col" or "axis":"row" accordingly, and provide the matching pattern:',
    '   · axis="col" (회차1 in cols C-D, 회차2 in E-F, ... labels in a left column): "xlsx_column_pattern": { "sheet":"...", "session_cols":[["C","D"],["E","F"],...], "max_slots": <group count> }. Session slot anchors point at the FIRST session\'s cells.',
    '   · axis="row" (회차 are stacked as rows — 회차1 = row 8, 회차2 = row 9, ... labels in a header row): "xlsx_row_pattern": { "sheet":"...", "session_rows":[[8],[9],[10],...], "max_slots": <row count> }. session_rows are 1-based sheet row numbers (the number in the A1 address, e.g. D8 → 8). Session slot anchors point at the FIRST session\'s row cells.',
    '',
    'OUTPUT: a SINGLE JSON object, no markdown, exactly this shape:',
    '{',
    '  "template_kind": "session_report" | "matrix_sheet" | "single",',
    '  "slots": [ { "id","label","anchor","level","repeat_group","field_guess","confidence" } ],',
    '  "repeat_groups": [ { "id", "docx_block_range"?, "xlsx_column_pattern"?, "max_slots"? } ]',
    '}',
    'Rules: ids are short snake_case and UNIQUE. Include a slot for EVERY fillable position, even ones with no matching field (field_guess null). Do NOT emit slots for pure static boilerplate (document titles, 이행각서, fixed legal/law text, 도장 "(인)").'
  ].join('\n');
}

// 스켈레톤을 프롬프트용 텍스트로 직렬화(길이 상한). B2 출력 shape 를 그대로 계약으로.
function serializeSkeleton(format, skeleton) {
  const MAX = 60000;
  let out = '';
  if (format === 'docx') {
    const blocks = Array.isArray(skeleton.blocks) ? skeleton.blocks : [];
    out += 'FORMAT: docx\nBLOCKS (' + blocks.length + ') — [block_id] (kind) text|<EMPTY>:\n';
    for (const b of blocks) {
      const t = b.empty ? '<EMPTY>' : JSON.stringify(String(b.text || '')).slice(0, 400);
      out += '  [' + b.block_id + '] (' + b.kind + ') ' + t + '\n';
      if (out.length > MAX) { out += '  …(truncated)\n'; break; }
    }
  } else {
    const sheets = Array.isArray(skeleton.sheets) ? skeleton.sheets : [];
    out += 'FORMAT: xlsx\nSHEETS (' + sheets.length + '):\n';
    for (const sh of sheets) {
      out += '\nSHEET "' + (sh.name || '') + '"  merges=' + JSON.stringify(sh.merges || []) + '\n';
      const cells = Array.isArray(sh.cells) ? sh.cells : [];
      let curR = null;
      for (const c of cells) {
        if (c.r !== curR) { out += '\n  R' + c.r + ':'; curR = c.r; }
        const t = c.empty ? '∅' : JSON.stringify(String(c.text || '')).slice(0, 200);
        const mk = c.merge ? ('«' + c.merge + '»') : '';
        out += ' ' + c.cell + mk + '=' + t;
        if (out.length > MAX) { out += '\n  …(truncated)\n'; break; }
      }
      out += '\n';
      if (out.length > MAX) break;
    }
  }
  return out;
}

function buildIngestUserPrompt(format, skeleton, templateName) {
  const lines = [];
  if (templateName) lines.push('Template name: ' + String(templateName));
  lines.push('ALLOWED field_guess keys (use ONLY these, or null): ' + ALLOWED_FIELD_GUESS.join(', '));
  lines.push('');
  lines.push('Coaching field meanings (for matching): main_topic=이번 세션 주제, real_issue=진짜 이슈/병목, next_action=다음 액션/과제, narrative_summary=세션 서술 요약, session_note=코치 메모, watch_next=다음에 주시할 점, last_commitment=지난 약속, metrics=핵심 지표, session_num=회차, date=일시, coach=코치명, team_name=팀/업체, founder_name=대표/참여자, session_type=세션유형.');
  lines.push('Report/cover-level meanings (level="report"): program_name=프로그램/사업명, period_from=컨설팅 기간 시작, period_to=컨설팅 기간 종료, coach_org=컨설턴트/코치 소속, session_count=총 회차 수, generated_date=보고서 작성일. Use these for 표지 메타 slots (프로그램명·기간·소속·작성일). Still NULL for 진행 방식/시각/종합 의견/이미지/자가진단 (no coaching data).');
  lines.push('');
  lines.push('DOCUMENT SKELETON:');
  lines.push(serializeSkeleton(format, skeleton));
  lines.push('');
  lines.push('Analyze the skeleton and output the slot-schema JSON described in the system message.');
  return lines.join('\n');
}

// ── AI 출력 정규화(방어적) — 환각 키 차단·형상 고정 ─────────────────────────
function normalizeSlotSchema(parsed) {
  const p = (parsed && typeof parsed === 'object') ? parsed : {};
  const kinds = ['session_report', 'matrix_sheet', 'single'];
  const template_kind = kinds.indexOf(p.template_kind) !== -1 ? p.template_kind : 'single';

  const rawSlots = Array.isArray(p.slots) ? p.slots : [];
  const slots = [];
  const seen = Object.create(null);
  rawSlots.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    let id = (typeof s.id === 'string' && s.id.trim()) ? s.id.trim() : ('slot_' + (i + 1));
    if (seen[id]) id = id + '_' + (i + 1);
    seen[id] = true;

    let anchor;
    if (s.anchor && typeof s.anchor === 'object') anchor = s.anchor;
    else if (typeof s.anchor === 'string') anchor = { ref: s.anchor };
    else anchor = {};

    const level = (s.level === 'report' || s.level === 'session') ? s.level : 'session';
    const repeat_group = (typeof s.repeat_group === 'string' && s.repeat_group.trim())
      ? s.repeat_group.trim() : null;

    let field_guess = (typeof s.field_guess === 'string' && s.field_guess.trim())
      ? s.field_guess.trim() : null;
    // 환각 방지: 허용 어휘 밖이면 null 로 강등.
    if (field_guess && ALLOWED_FIELD_GUESS.indexOf(field_guess) === -1) field_guess = null;

    let confidence = Number(s.confidence);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));

    slots.push({
      id: id,
      label: typeof s.label === 'string' ? s.label : '',
      anchor: anchor,
      level: level,
      repeat_group: repeat_group,
      field_guess: field_guess,
      confidence: confidence
    });
  });

  const rawGroups = Array.isArray(p.repeat_groups) ? p.repeat_groups : [];
  const repeat_groups = [];
  rawGroups.forEach((g, i) => {
    if (!g || typeof g !== 'object') return;
    const out = { id: (typeof g.id === 'string' && g.id.trim()) ? g.id.trim() : ('group_' + (i + 1)) };
    if (Array.isArray(g.docx_block_range)) out.docx_block_range = g.docx_block_range;
    if (g.xlsx_column_pattern && typeof g.xlsx_column_pattern === 'object') out.xlsx_column_pattern = g.xlsx_column_pattern;
    if (g.xlsx_row_pattern && typeof g.xlsx_row_pattern === 'object') out.xlsx_row_pattern = g.xlsx_row_pattern;
    if (g.axis === 'row' || g.axis === 'col') out.axis = g.axis;
    if (Number.isFinite(Number(g.max_slots))) out.max_slots = Number(g.max_slots);
    repeat_groups.push(out);
  });

  return { template_kind: template_kind, slots: slots, repeat_groups: repeat_groups };
}

// ── ingest 핸들러 ────────────────────────────────────────────────────────
async function handleIngest(req, res, apiKey) {
  const body = req.body || {};
  const fmt = String(body.format || '').toLowerCase();
  if (fmt !== 'docx' && fmt !== 'xlsx') {
    return res.status(400).json({ error: 'format must be "docx" or "xlsx"' });
  }
  const skeleton = body.skeleton;
  if (!skeleton || typeof skeleton !== 'object') {
    return res.status(400).json({ error: 'skeleton (from report-template-parser) is required' });
  }
  if (fmt === 'docx' && !Array.isArray(skeleton.blocks)) {
    return res.status(400).json({ error: 'docx skeleton must have blocks[]' });
  }
  if (fmt === 'xlsx' && !Array.isArray(skeleton.sheets)) {
    return res.status(400).json({ error: 'xlsx skeleton must have sheets[]' });
  }

  const geminiBody = {
    system_instruction: { parts: [{ text: buildIngestSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildIngestUserPrompt(fmt, skeleton, body.template_name) }] }],
    generationConfig: {
      temperature: 0.2,                 // 구조 분석 — 결정론적으로
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 1024 } // pro-safe (extract-session 주석 참조)
    },
    safetySettings: SAFETY_BLOCK_NONE
  };

  const { response, modelUsed } = await callWithFallback(geminiBody, apiKey, false);
  if (!response || !response.ok) {
    const errText = response ? await response.text().catch(() => '') : '';
    return res.status(response ? response.status : 502).json({
      error: errText || 'upstream error', modelTried: modelUsed
    });
  }
  const data = await response.json();
  const raw = extractGeminiText(data);
  if (!raw) return res.status(500).json({ error: 'Model returned no text', modelUsed });
  const parsed = parseJsonFromText(raw);
  if (!parsed) return res.status(500).json({ error: 'Model did not return valid slot-schema JSON', raw, modelUsed });

  const slot_schema = normalizeSlotSchema(parsed);
  return res.status(200).json({
    slot_schema: slot_schema,
    ingest_model: modelUsed,
    ingest_version: INGEST_VERSION,
    usage: data.usageMetadata || null
  });
}

// ════════════════════════════════════════════════════════════════════════
// mode:'fill' (B4) — 슬롯 스키마 + 세션 데이터 → 슬롯별 {value,evidence,confidence}
// ════════════════════════════════════════════════════════════════════════

// 슬롯을 report 레벨 / session 레벨로 분리(level 기준, 기본 session).
function splitSlots(slot_schema) {
  const slots = (slot_schema && Array.isArray(slot_schema.slots)) ? slot_schema.slots : [];
  const report = [], session = [];
  for (const s of slots) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
    if (s.level === 'report') report.push(s); else session.push(s);
  }
  return { report: report, session: session };
}

function _blankEntry() { return { value: '', evidence: '', confidence: 0 }; }

// AI 슬롯 값 → 표준 {value,evidence,confidence}. confidence 클램프[0,1]·문자열 파싱.
// (extract-session.js:541 toFieldEntry 참고. 단 fill 은 confidence 를 숫자 0 기본
//  으로 강제 — UI 낮은신뢰 강조/코치확인 흐름에 numeric 필요.)
function toFillEntry(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    let conf = Number(v.confidence);
    conf = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;
    const val = (v.value === undefined || v.value === null) ? '' : v.value;
    return { value: val, evidence: typeof v.evidence === 'string' ? v.evidence : '', confidence: conf };
  }
  if (v === undefined || v === null) return _blankEntry();
  return { value: v, evidence: '', confidence: 0 }; // primitive → 값만, 근거없음
}

// fill 출력 정규화(방어적):
//   · 스키마에 있는 슬롯 id 만 채움(그 외 AI 키 폐기)
//   · field_guess=null 슬롯(진행방식·시각·종합의견·이미지 등) = 공란 강제(환각 차단)
//   · 누락 슬롯 = 공란(confidence:0)
//   · session 레벨 슬롯은 sessionCount 만큼 sessions[] 반복(입력 세션 순서)
function normalizeFillOutput(parsed, slot_schema, sessionCount) {
  const p = (parsed && typeof parsed === 'object') ? parsed : {};
  const buckets = splitSlots(slot_schema);
  const rSlots = buckets.report, sSlots = buckets.session;
  const n = Math.max(0, Number.isFinite(Number(sessionCount)) ? Number(sessionCount) : 0);
  const isGap = (s) => (s.field_guess === null || s.field_guess === undefined);

  const pr = (p.report && typeof p.report === 'object') ? p.report : {};
  const report = {};
  for (const s of rSlots) {
    report[s.id] = isGap(s) ? _blankEntry() : toFillEntry(pr[s.id]);
  }

  const pSessions = Array.isArray(p.sessions) ? p.sessions : [];
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const src = (pSessions[i] && typeof pSessions[i] === 'object') ? pSessions[i] : {};
    const obj = {};
    for (const s of sSlots) {
      obj[s.id] = isGap(s) ? _blankEntry() : toFillEntry(src[s.id]);
    }
    sessions.push(obj);
  }
  return { report: report, sessions: sessions };
}

function _cap(s, n) { s = String(s); return s.length > n ? (s.slice(0, n) + '…(truncated)') : s; }

function buildFillSystemPrompt() {
  return [
    'You assign a coaching report\'s data to the SLOTS of a client report template. You DO NOT write the final document — you only produce a value for each slot.',
    'INPUT: SLOTS (report-level + session-level, each with id, Korean label, and a field_guess hint) plus SESSIONS data (coaching_logs records) and REPORT context. All Korean.',
    'OUTPUT: a SINGLE JSON object, no markdown:',
    '{ "report": { "<slotId>": {"value","evidence","confidence"}, ... },',
    '  "sessions": [ { "<slotId>": {"value","evidence","confidence"}, ... }, ... ] }',
    'The "sessions" array MUST contain exactly one object per given session, in the SAME ORDER as SESSIONS.',
    '',
    'Hard rules (anti-hallucination):',
    '- Use ONLY the provided SESSIONS/REPORT data as source. NO outside knowledge, NO invented facts, NO guessing beyond the data.',
    '- evidence MUST name the source, e.g. "session#1.main_topic", "session#2.narrative_summary", "report.program_name". If a value cannot be grounded in the given data, set value:"" and confidence:0.',
    '- For any slot whose field_guess is null (no matching coaching field — e.g. 진행 방식 online/offline, 진행 시각, 종합 의견/총평, 진행 사진·이미지, 자가진단 설문), output {"value":"","evidence":"","confidence":0}. Do NOT fabricate these.',
    '- Put report-level slots under "report"; put session-level slots under "sessions"[i] for the i-th session.',
    '- value = concise text fitting the slot label. You may lightly reformat (e.g. join metrics as "이름: 값"), but never add facts not in the data.',
    '- confidence 0..1 = how well the chosen data matches the slot meaning.',
    'Output every slot id given (report + per session). Do NOT add slot ids that were not given.'
  ].join('\n');
}

function buildFillUserPrompt(slot_schema, sessions, report) {
  const buckets = splitSlots(slot_schema);
  const fmtSlot = (s) => '  - id="' + s.id + '" label=' + JSON.stringify(s.label || '') +
    ' field_guess=' + ((s.field_guess === null || s.field_guess === undefined) ? 'null' : s.field_guess);
  const lines = [];
  lines.push('REPORT-LEVEL SLOTS (output each under "report"):');
  lines.push(buckets.report.length ? buckets.report.map(fmtSlot).join('\n') : '  (none)');
  lines.push('');
  lines.push('SESSION-LEVEL SLOTS (output under "sessions"[i] for EACH session, same order):');
  lines.push(buckets.session.length ? buckets.session.map(fmtSlot).join('\n') : '  (none)');
  lines.push('');
  lines.push('SESSIONS (in order, index 0..' + (Array.isArray(sessions) ? sessions.length - 1 : 0) + '):');
  lines.push(_cap(JSON.stringify(sessions || []), 80000));
  lines.push('');
  lines.push('REPORT CONTEXT (fill report-level slots from these — cite as report.<key>):');
  lines.push('  keys: program_name(프로그램/사업명), period_from/period_to(컨설팅 기간), coach(코치명), coach_org(소속), team_name(업체/팀), founder_name(대표/참여자), session_count(총 회차), generated_date(작성일).');
  lines.push(_cap(JSON.stringify(report || {}), 8000));
  lines.push('');
  lines.push('Assign values now. Output ONLY the JSON described in the system message.');
  return lines.join('\n');
}

async function handleFill(req, res, apiKey) {
  const body = req.body || {};
  const slot_schema = body.slot_schema;
  if (!slot_schema || typeof slot_schema !== 'object' || !Array.isArray(slot_schema.slots)) {
    return res.status(400).json({ error: 'slot_schema (from ingest) with slots[] is required' });
  }
  const sessions = Array.isArray(body.sessions) ? body.sessions : null;
  if (!sessions || sessions.length === 0) {
    return res.status(400).json({ error: 'sessions[] (coaching_logs records) required and non-empty' });
  }
  const report = (body.report && typeof body.report === 'object') ? body.report : {};

  const geminiBody = {
    system_instruction: { parts: [{ text: buildFillSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: buildFillUserPrompt(slot_schema, sessions, report) }] }],
    generationConfig: {
      temperature: 0.2,                 // 낮게 — 데이터에 충실하게
      // fill 출력은 N세션 × M슬롯 × {value,evidence,confidence}이고 value 에 긴
      // 내러티브가 들어갈 수 있어 헤드룸 확보. 초과 시 parseJsonFromText 잘림복구.
      maxOutputTokens: 32768,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 1024 } // pro-safe
    },
    safetySettings: SAFETY_BLOCK_NONE
  };

  // 모델: callWithFallback = PRIMARY(pro) 우선 → 지속 503 등에서만 flash 폴백.
  //   fill 은 코칭 텍스트→슬롯 의미매핑이라 품질이 중요하고 호출 빈도(리포트당 1회)가
  //   낮아 pro 우선 유지. 비용이 문제되면 여기서 flash 우선 변형 고려(트레이드오프).
  const { response, modelUsed } = await callWithFallback(geminiBody, apiKey, false);
  if (!response || !response.ok) {
    const errText = response ? await response.text().catch(() => '') : '';
    return res.status(response ? response.status : 502).json({
      error: errText || 'upstream error', modelTried: modelUsed
    });
  }
  const data = await response.json();
  const raw = extractGeminiText(data);
  if (!raw) return res.status(500).json({ error: 'Model returned no text', modelUsed });
  const parsed = parseJsonFromText(raw);
  if (!parsed) return res.status(500).json({ error: 'Model did not return valid fill JSON', raw, modelUsed });

  const filled = normalizeFillOutput(parsed, slot_schema, sessions.length);
  return res.status(200).json({
    filled: filled,
    fill_model: modelUsed,
    fill_version: FILL_VERSION,
    usage: data.usageMetadata || null
  });
}

// ── 핸들러(멀티모드 디스패치) ──────────────────────────────────────────────
async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // 인증 게이트 — Gemini 비용 전에 미인증 차단.
  if (!(await verifyAuth(req))) return res.status(401).json({ error: 'Unauthorized' });

  const apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  const mode = (req.body && req.body.mode) || '';
  try {
    if (mode === 'ingest') return await handleIngest(req, res, apiKey);
    if (mode === 'fill')   return await handleFill(req, res, apiKey);
    return res.status(400).json({ error: 'mode must be "ingest" or "fill"' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
// 테스트/후속 브리프용 순수 헬퍼 노출(Vercel 은 default 함수 export 를 핸들러로 사용).
module.exports.INGEST_VERSION = INGEST_VERSION;
module.exports.FILL_VERSION = FILL_VERSION;
module.exports.ALLOWED_FIELD_GUESS = ALLOWED_FIELD_GUESS;
module.exports.serializeSkeleton = serializeSkeleton;
module.exports.buildIngestUserPrompt = buildIngestUserPrompt;
module.exports.normalizeSlotSchema = normalizeSlotSchema;
module.exports.splitSlots = splitSlots;
module.exports.toFillEntry = toFillEntry;
module.exports.normalizeFillOutput = normalizeFillOutput;
module.exports.buildFillUserPrompt = buildFillUserPrompt;
