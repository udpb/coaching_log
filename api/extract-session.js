// Vercel Serverless Function — STT transcript → structured coaching log
// POST /api/extract-session
//
// Backend: Google Gemini (PRIMARY: gemini-2.5-pro by default, FALLBACK: gemini-2.5-flash)
//          Auto-retry on 429/5xx (1s/3s/7s backoff), then auto-fallback to flash
//          if PRIMARY exhausts retries on retryable status. Set GEMINI_CHAT_MODEL
//          and/or GEMINI_CHAT_FALLBACK_MODEL env vars to override.
// Auth:    GEMINI_API_KEY env var (server-side only)
//
// Body:
//   { transcript: string,
//     context?: { date, coach, team_name, founder_name, session_num, session_type, prev?: {...} },
//     stream?: boolean }
//
// Response (Phase-1 shape, unchanged):
//   {
//     narrative_summary: "...",
//     fields: { stage: { value, evidence, confidence }, ..., metrics: {...} },
//     low_confidence: [...],
//     raw: "...",
//     usage: {...}
//   }
//
// Streaming response (when `stream: true`):
//   data: { type: "delta", text, accumulated } ...
//   event: done
//   data: { narrative_summary, fields, low_confidence, raw, usage }

const GEMINI_KEY   = '';   // resolved at request time from env
// PRIMARY model — env override allowed. Don't use bare 'gemini-3.1-pro' (404
// in v1beta); preview IDs need a dated suffix.
const PRIMARY_MODEL  = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-pro';
// FALLBACK model — used automatically when PRIMARY exhausts retries on a
// retryable status (typically 503 high-demand). Flash has bigger capacity
// and is ~10× faster; quality is close enough for STT extraction.
const FALLBACK_MODEL = process.env.GEMINI_CHAT_FALLBACK_MODEL || 'gemini-2.5-flash';
// Backoff schedule for retries. 4 fetches total per model
// (initial + 3 retries) — worst case ~11s per model before falling back.
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta';

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// Single-model fetch with retry on transient failures (429/5xx/network).
// Returns the final fetch Response object (caller decides what to do).
async function fetchWithRetry(model, body, apiKey, isStream) {
  const op = isStream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:${op}key=${encodeURIComponent(apiKey)}`;
  let lastResponse = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (err) {
      // Network-level error — treat as retryable.
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
    if (response.ok) return response;
    if (!isRetryableStatus(response.status)) return response;
    lastResponse = response;
    if (attempt < RETRY_DELAYS_MS.length) {
      try { await response.text(); } catch (_) { /* drain */ }
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  return lastResponse;
}

// Try PRIMARY (with retries); on persistent retryable failure, try FALLBACK
// (also with retries). Returns { response, modelUsed }.
async function callWithFallback(body, apiKey, isStream) {
  let response = await fetchWithRetry(PRIMARY_MODEL, body, apiKey, isStream);
  let modelUsed = PRIMARY_MODEL;
  if (!response.ok && isRetryableStatus(response.status)) {
    try { await response.text(); } catch (_) { /* drain */ }
    response = await fetchWithRetry(FALLBACK_MODEL, body, apiKey, isStream);
    modelUsed = FALLBACK_MODEL;
  }
  return { response, modelUsed };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  let apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  try {
    const { transcript, context, stream: wantStream } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 50) {
      return res.status(400).json({ error: 'transcript must be a non-empty string of meaningful length' });
    }
    if (transcript.length > 120000) {
      return res.status(413).json({ error: 'transcript too long (max 120k chars)' });
    }

    const ctx = context || {};
    const prev = ctx.prev || null;
    const isFirst = !prev;

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(transcript, ctx, prev, isFirst);

    // Gemini request body:
    //  - `system_instruction`: single message-like object holding the system prompt
    //  - `contents`: multi-turn array; for one-shot we send a single user turn
    //  - `generationConfig.responseMimeType: 'application/json'` forces clean JSON
    //    out of the model (no markdown fences in happy path)
    //  - `streamGenerateContent?alt=sse` for SSE streaming (handled below)
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.4,
        // gemini-2.5-pro uses thinking tokens by default (~1500-3000 hidden
        // reasoning tokens before the visible answer). Our JSON output alone
        // is ~5000-8000 tokens with KO+EN mixed. The previous limit of 5120
        // was sized for gemini-3.1-pro which had no thinking — under 2.5-pro
        // the answer was being truncated mid-JSON, parseJsonFromText returned
        // null, and fields ended up {} (UI silently skipped applying anything,
        // surfacing only the metrics-shape warning).
        // Bumping to 16384 gives ~3x headroom: thinking + full answer + buffer.
        maxOutputTokens: 16384,
        responseMimeType: 'application/json'
      },
      // Block none — we trust the input is a coaching transcript, not adversarial.
      // Adjust if false-positive safety blocks become an issue.
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' }
      ]
    };

    if (wantStream) {
      return handleStream(res, body, apiKey, prev);
    }

    // Non-stream — auto-retry + fallback flash on persistent 503/etc.
    const { response, modelUsed } = await callWithFallback(body, apiKey, false);
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText, modelTried: modelUsed });
    }
    const data = await response.json();
    const raw = extractGeminiText(data);
    if (!raw) {
      return res.status(500).json({ error: 'Model returned no text', detail: data, modelUsed });
    }
    const parsed = parseJsonFromText(raw);
    if (!parsed) {
      return res.status(500).json({ error: 'Model did not return valid JSON', raw, modelUsed });
    }
    const normalized = normalizeModelOutput(parsed, prev);
    return res.status(200).json(Object.assign({}, normalized, {
      raw,
      usage: data.usageMetadata || null,
      modelUsed
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// -----------------------------------------------------------------------
// Streaming proxy: forward Gemini SSE deltas to the client as our own SSE,
// then emit a final 'done' event with the parsed payload.
// -----------------------------------------------------------------------
async function handleStream(res, body, apiKey, prev) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeEvent = (eventName, data) => {
    if (eventName) res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let upstream;
  let modelUsed;
  try {
    const result = await callWithFallback(body, apiKey, true);
    upstream = result.response;
    modelUsed = result.modelUsed;
  } catch (err) {
    writeEvent('error', { error: 'upstream fetch failed: ' + err.message });
    return res.end();
  }
  if (!upstream.ok || !upstream.body) {
    const errTxt = await upstream.text().catch(() => '');
    writeEvent('error', { error: errTxt || `upstream status ${upstream.status}`, modelTried: modelUsed });
    return res.end();
  }

  let fullText = '';
  let usage = null;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  // Gemini SSE format: each event is `data: {<JSON>}\n\n` where the JSON
  // contains a `candidates[0].content.parts[*].text` chunk and (on the last
  // event) `usageMetadata` + `finishReason`.
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();

    for (const evt of parts) {
      let dataLine = '';
      for (const line of evt.split('\n')) {
        if (line.startsWith('data: ')) dataLine += line.slice(6);
      }
      if (!dataLine) continue;
      let payload;
      try { payload = JSON.parse(dataLine); } catch { continue; }

      const text = extractGeminiText(payload);
      if (text) {
        fullText += text;
        writeEvent(null, { type: 'delta', text, accumulated: fullText });
      }
      if (payload.usageMetadata) usage = payload.usageMetadata;
    }
  }

  const parsed = parseJsonFromText(fullText);
  const normalized = parsed
    ? normalizeModelOutput(parsed, prev)
    : { narrative_summary: '', fields: {}, low_confidence: [] };
  writeEvent('done', Object.assign({}, normalized, { raw: fullText, usage, modelUsed }));
  return res.end();
}

// Pull the text payload out of a Gemini response (or stream chunk).
// Tolerates: missing candidates, empty parts, multiple parts.
function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) return '';
  const c = data.candidates[0];
  if (!c.content || !Array.isArray(c.content.parts)) return '';
  return c.content.parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('');
}

// -----------------------------------------------------------------------
// Output normalization → canonical { narrative_summary, fields, low_confidence }
// -----------------------------------------------------------------------
const STRUCTURED_FIELD_KEYS = [
  'stage', 'stage_detail', 'main_topic',
  'last_commitment', 'last_done', 'last_number', 'last_result',
  'last_done_numerator', 'last_done_denominator', 'last_done_rate',
  'real_issue', 'blocker_type', 'ai_used',
  'next_action', 'next_deadline', 'next_evidence',
  'next_checkin', 'next_checkin_date', 'next_checkin_channel',
  'session_note', 'watch_next', 'energy', 'metrics'
];

function toFieldEntry(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('value' in v || 'evidence' in v)) {
    return {
      value: v.value !== undefined ? v.value : '',
      evidence: typeof v.evidence === 'string' ? v.evidence : '',
      confidence: typeof v.confidence === 'number' ? v.confidence : null
    };
  }
  return { value: v === undefined ? '' : v, evidence: '', confidence: null };
}

function normalizeModelOutput(parsed, prev) {
  const narrative = typeof parsed.narrative_summary === 'string' ? parsed.narrative_summary : '';
  const lowConf = Array.isArray(parsed.low_confidence) ? parsed.low_confidence : [];

  let srcFields;
  if (parsed.fields && typeof parsed.fields === 'object') {
    srcFields = parsed.fields;
  } else {
    const { narrative_summary, low_confidence, ...rest } = parsed;
    srcFields = rest;
  }

  const fields = {};
  for (const k of STRUCTURED_FIELD_KEYS) {
    if (k in srcFields) fields[k] = toFieldEntry(srcFields[k]);
  }

  // Carry over prev.next_action into last_commitment if model omitted it
  if (prev && prev.next_action) {
    const lc = fields.last_commitment;
    if (!lc || !String(lc.value || '').trim()) {
      fields.last_commitment = { value: prev.next_action, evidence: '(prev session)', confidence: 1.0 };
    }
  }

  // Auto-derive last_done_rate from numerator/denominator
  const num = Number(fields.last_done_numerator && fields.last_done_numerator.value);
  const den = Number(fields.last_done_denominator && fields.last_done_denominator.value);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
    const rate = Math.max(0, Math.min(1, num / den));
    fields.last_done_rate = {
      value: Number(rate.toFixed(3)),
      evidence: `자동 계산: ${num}/${den}`,
      confidence: 1.0
    };
  }

  // Normalize date fields to single ISO YYYY-MM-DD
  for (const key of ['next_deadline', 'next_checkin_date']) {
    const entry = fields[key];
    if (entry && entry.value !== undefined && entry.value !== null) {
      const iso = extractLatestIsoDate(String(entry.value));
      if (iso && iso !== entry.value) {
        fields[key] = Object.assign({}, entry, { value: iso });
      }
    }
  }

  return { narrative_summary: narrative, fields, low_confidence: lowConf };
}

function extractLatestIsoDate(s) {
  if (!s) return '';
  const re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  const hits = [];
  let m;
  while ((m = re.exec(s))) hits.push(`${m[1]}-${m[2]}-${m[3]}`);
  if (hits.length === 0) return '';
  hits.sort();
  return hits[hits.length - 1];
}

function buildSystemPrompt() {
  return [
    'You are an assistant that extracts structured coaching session data from raw Speech-to-Text (STT) transcripts.',
    'The transcript is a 1:1 startup coaching session between a coach and a founder (may be in Korean, English, or mixed).',
    '',
    'YOUR JOB has two passes:',
    '',
    'PASS 1 — NARRATIVE SUMMARY (narrative_summary)',
    '  Write an 8-15 sentence rich prose summary of the session in the dominant language of the transcript.',
    '  Capture: what was discussed, what the founder committed to last time and how it went, the real root-cause insight that emerged, any pivot/decision, the founder\'s emotional state and energy, what the coach will watch for next.',
    '  This is the COACH\'S MEMORY of the session — it must preserve nuance, specifics, and the arc of the conversation, not just keywords.',
    '  Prefer concrete details ("7 out of 10 interviews completed, 2 pilot candidates secured") over vague summaries ("made progress").',
    '',
    'PASS 2 — STRUCTURED FIELDS (fields.*)',
    '  Based on the narrative you just wrote AND the raw transcript, fill each structured field.',
    '  Each field MUST be an object: { "value": ..., "evidence": "<direct quote or tight paraphrase from the transcript that justifies this value>", "confidence": 0.0-1.0 }.',
    '  - value: the extracted value per the enum/rules below. Use "" (or 0 / [] / false) if not discussed.',
    '  - evidence: 1-3 sentences lifted directly from the transcript (or tight paraphrase if the coach\'s question + founder\'s answer span multiple turns). Required for every non-empty value. Leave "" only if value is also empty.',
    '  - confidence: your self-assessed confidence that the value is correct, 0.0 to 1.0.',
    '  List every field with confidence < 0.7 in the top-level "low_confidence" array so the UI highlights it.',
    '',
    'VALUE RULES:',
    '  - stage: "I" (Ideation) | "M" (Market) | "P" (Product/Prototype) | "A" (Acquisition) | "C" (Commercialization) | "T" (Traction) | "".',
    '  - stage_detail: short phrase describing the founder\'s specific position within the stage.',
    '  - main_topic: the SURFACE topic — what the session nominally discussed.',
    '  - last_commitment: what the founder committed to last session. "" on first session.',
    '  - last_done: "done" | "partial" | "not_done" | "". Only for non-first sessions.',
    '  - last_number: concrete numeric outcome of last commitment (e.g. "7 interviews out of 10").',
    '  - last_done_numerator: the completed count (number, e.g. 7). Same source as last_number but isolated for aggregation. "" if not quantifiable.',
    '  - last_done_denominator: the target count (number, e.g. 10). "" if the commitment wasn\'t numeric (e.g. "finish the deck") or if not given.',
    '  - last_result: what was learned from last commitment — the insight, not just the fact.',
    '  - real_issue: the ROOT-CAUSE issue discovered today. Must differ from main_topic. If the session stayed at surface level, leave "".',
    '  - blocker_type: one of "모르겠음" | "뭘 해야 할지 모름" | "방법을 모름" | "두려움/회피" | "시간/자원 부족" | "방향이 틀림" | "팀 내부 갈등", or "" if unclear.',
    '  - ai_used: boolean — did the founder or coach discuss using AI tools during execution?',
    '  - next_action: WHAT the founder commits to do next.',
    '  - next_deadline: WHEN — MUST be a single ISO date in YYYY-MM-DD format.',
    '      · Use the session "date" from context as today\'s reference when resolving natural-language dates ("다음주 금요일", "next Friday", "이번주까지").',
    '      · If the transcript only gives a range (e.g. "월-수요일 사이에", "이번주 내로", "Monday to Wednesday"), pick the LAST day of the range — this is the conservative deadline that locks in the commitment.',
    '      · If the transcript says "before next session" or similar relative-to-session phrasing and no concrete date is given, leave "" and flag low_confidence.',
    '      · NEVER return natural language like "다음주 금요일" or a range like "2026-04-21 ~ 2026-04-24" — always a single YYYY-MM-DD.',
    '  - next_evidence: HOW to verify completion (concrete artifact/number).',
    '  - next_checkin: free-text natural-language summary ("목요일에 메시지로 점검"). Keep this as a human-readable sentence.',
    '  - next_checkin_date: same check-in as above but as a single YYYY-MM-DD. Range → latest day. "" if no specific date given.',
    '  - next_checkin_channel: how the coach will check in. One of: "message" | "call" | "video" | "email" | "inperson" | "other" | "". Pick the best match; leave "" only if truly ambiguous.',
    '  - session_note: the coach\'s reflection / takeaway on this session.',
    '  - watch_next: what the coach will specifically watch for next session.',
    '  - energy: integer 1-5 for founder\'s emotional state, or 0 if not inferable.',
    '  - metrics: array of { "name": snake_case, "value": "..." } for numeric business metrics mentioned (customers, revenue, conversions). value is the object\'s `value` field (the outer metrics.value is this array).',
    '',
    'IMPORTANT:',
    '  1. Output a single valid JSON object — nothing else. No prose before/after, no markdown fences. The response MIME is set to application/json.',
    '  2. Do NOT invent content. If not in the transcript, use "" / 0 / [] / false with confidence ≤ 0.3.',
    '  3. Preserve the dominant language of the transcript in free-text fields.',
    '  4. Emit keys in the schema order so partial streams are usable early (narrative_summary FIRST, then fields in schema order, then low_confidence).',
    '',
    'EXAMPLE (Korean session → Korean output):',
    '{',
    '  "narrative_summary": "이번 3회차 세션에서 창업자는 지난번 약속했던 잠재고객 10명 인터뷰 중 7명을 완료했고 3명은 일정 문제로 미뤄졌다고 보고했다. 인터뷰 결과 중 2명이 파일럿을 원한다는 긍정적 반응이 있었다. 더 중요한 것은, 원래 가설했던 타겟팅 문제보다 데이터 정합성 문제가 고객들에게 더 시급하다는 점을 발견했고 이를 바탕으로 MVP 방향을 전환하기로 결정했다. 코치는 다음주까지 파일럿 2곳 중 최소 1곳과 계약서에 사인받는 것을 commitment로 확정했고 증빙은 계약서 PDF로 합의했다. 창업자는 인터뷰 결과에 기반한 피벗 결정에 자신감을 보였으며 에너지 수준은 양호했다. 코치는 피벗 방향이 실제 계약 전환으로 이어지는지를 다음 세션 전까지 지켜볼 예정이며 중간에 메시지로 한 번 확인하기로 했다.",',
    '  "fields": {',
    '    "stage": { "value": "M", "evidence": "잠재고객 인터뷰를 통해 시장 문제를 재정의하고 있음", "confidence": 0.85 },',
    '    "stage_detail": { "value": "잠재고객 인터뷰 완료 후 문제 재정의 단계", "evidence": "인터뷰 7건 완료, 타겟팅→데이터 정합성으로 문제 피벗", "confidence": 0.8 },',
    '    "main_topic": { "value": "인터뷰 결과 공유 및 MVP 방향 전환", "evidence": "오늘 세션의 핵심 흐름", "confidence": 0.9 },',
    '    "last_commitment": { "value": "잠재고객 10명 인터뷰", "evidence": "코치: 지난번에 잠재고객 10명 인터뷰하기로 하셨는데 어떻게 되셨어요?", "confidence": 1.0 },',
    '    "last_done": { "value": "partial", "evidence": "창업자: 사실 7명까지 했어요. 나머지 3명은 일정이 안 맞아서요.", "confidence": 1.0 },',
    '    "last_number": { "value": "7명 인터뷰 완료 / 파일럿 의향 2명", "evidence": "창업자: 인터뷰한 분들 중 2명이 파일럿 써보겠다고 하셨어요.", "confidence": 0.95 },',
    '    "last_done_numerator": { "value": 7, "evidence": "7명까지 했어요", "confidence": 1.0 },',
    '    "last_done_denominator": { "value": 10, "evidence": "지난번에 잠재고객 10명 인터뷰하기로 하셨잖아요", "confidence": 1.0 },',
    '    "last_result": { "value": "원래 가설한 타겟팅 문제보다 데이터 정합성이 더 시급함을 발견", "evidence": "창업자: 저희가 원래 타겟했던 문제보다는 데이터 정합성 쪽이 더 시급한 문제 같더라고요.", "confidence": 0.95 },',
    '    "real_issue": { "value": "초기 문제 가설과 실제 고객 우선순위의 불일치", "evidence": "코치: 그럼 지금 진짜 풀어야 하는 문제는 타겟팅이 아니라 데이터 정합성 쪽이라고 보시는 거죠?", "confidence": 0.85 },',
    '    "blocker_type": { "value": "방향이 틀림", "evidence": "초기 타겟팅 가설이 실제 고객 pain point와 불일치", "confidence": 0.75 },',
    '    "ai_used": { "value": false, "evidence": "", "confidence": 0.5 },',
    '    "next_action": { "value": "파일럿 2곳 중 최소 1곳 계약서 사인", "evidence": "코치: 파일럿 2곳 중 최소 1곳 계약서까지 사인받는 걸 목표로 해볼까요?", "confidence": 1.0 },',
    '    "next_deadline": { "value": "2026-04-24", "evidence": "창업자: 다음주 금요일까지요. (세션 날짜 2026-04-17 기준 다음주 금요일)", "confidence": 0.9 },',
    '    "next_evidence": { "value": "계약서 PDF", "evidence": "코치: 증빙은 계약서 PDF로 할게요.", "confidence": 1.0 },',
    '    "next_checkin": { "value": "다음 세션 전 중간에 메시지로 한 번 확인", "evidence": "코치: 다음 세션 전까지 제가 중간에 한번 메시지로 확인할게요.", "confidence": 1.0 },',
    '    "next_checkin_date": { "value": "2026-04-21", "evidence": "다음 세션 전 — 세션 주기 감안 약 4일 후", "confidence": 0.5 },',
    '    "next_checkin_channel": { "value": "message", "evidence": "코치: 메시지로 확인할게요", "confidence": 1.0 },',
    '    "session_note": { "value": "인터뷰 결과 기반 피벗 결정이 건강함. 2명 파일럿 의향은 실제 계약으로 전환시키는 게 관건.", "evidence": "세션 전반", "confidence": 0.7 },',
    '    "watch_next": { "value": "피벗 방향(데이터 정합성)이 실제 계약 체결로 이어지는지", "evidence": "피벗 결정 직후 validation 단계 진입", "confidence": 0.8 },',
    '    "energy": { "value": 4, "evidence": "인터뷰 결과에 기반한 피벗 결정에 자신감, 주도적 태도", "confidence": 0.6 },',
    '    "metrics": { "value": [{ "name": "인터뷰_완료", "value": "7" }, { "name": "파일럿_의향_고객", "value": "2" }], "evidence": "창업자: 7명까지 했고, 2명이 파일럿 써보겠다고 하셨어요.", "confidence": 0.95 }',
    '  },',
    '  "low_confidence": ["ai_used", "session_note", "energy"]',
    '}'
  ].join('\n');
}

function buildUserPrompt(transcript, ctx, prev, isFirst) {
  const header = [
    '## Session context (provided by coach app)',
    `- date: ${ctx.date || '(unknown)'}`,
    `- coach: ${ctx.coach || '(unknown)'}`,
    `- team_name: ${ctx.team_name || '(unknown)'}`,
    `- founder_name: ${ctx.founder_name || '(unknown)'}`,
    `- session_num: ${ctx.session_num || '(unknown)'}`,
    `- expected session_type: ${isFirst ? 'first' : 'regular (continuing)'}`,
    ''
  ];

  if (prev) {
    header.push('## Previous session (for continuity)');
    header.push(`- prev.next_action: ${prev.next_action || ''}`);
    header.push(`- prev.next_deadline: ${prev.next_deadline || ''}`);
    header.push(`- prev.next_evidence: ${prev.next_evidence || ''}`);
    header.push(`- prev.stage: ${prev.stage || ''}`);
    header.push(`- prev.watch_next: ${prev.watch_next || ''}`);
    header.push('');
  }

  const tail = [
    '## Transcript',
    transcript.trim(),
    '',
    'Produce the JSON per the schema in your system prompt. Narrative first, then structured fields, then low_confidence. Output a single JSON object only.'
  ];

  return header.concat(tail).join('\n');
}

// -----------------------------------------------------------------------
// JSON parsing (tolerates fenced code blocks even though Gemini's JSON mode
// shouldn't emit them — defensive).  Falls through to a brace-slice repair.
// -----------------------------------------------------------------------
function parseJsonFromText(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let candidate = (fence ? fence[1] : text).trim();

  try { return JSON.parse(candidate); } catch (_) { /* keep trying */ }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch (_) { /* fall through */ }
  }

  return repairAndParse(candidate);
}

function repairAndParse(text) {
  const src = text;
  let inStr = false, escape = false;
  let lastCompleteValueEnd = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inStr = false; lastCompleteValueEnd = i; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[' || c === ',' || c === ' ' || c === '\n' || c === '\r' || c === '\t') continue;
    if (c === '}' || c === ']') { lastCompleteValueEnd = i; continue; }
    if (!'0123456789tfn-'.includes(c)) continue;
    while (i + 1 < src.length && !',}]\n\r\t '.includes(src[i+1])) i++;
    lastCompleteValueEnd = i;
  }

  let repaired = src;
  if (lastCompleteValueEnd >= 0 && lastCompleteValueEnd < src.length - 1) {
    repaired = src.slice(0, lastCompleteValueEnd + 1);
  }
  repaired = repaired.replace(/,\s*$/, '').replace(/:\s*$/, '').replace(/"[^"]*$/, '');

  const scan = (s) => {
    const st = []; let ins = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (ins) {
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { ins = false; st.pop(); }
        continue;
      }
      if (c === '"') { ins = true; st.push('"'); continue; }
      if (c === '{' || c === '[') { st.push(c); continue; }
      if (c === '}') { if (st[st.length-1] === '{') st.pop(); continue; }
      if (c === ']') { if (st[st.length-1] === '[') st.pop(); continue; }
    }
    return st;
  };
  const remaining = scan(repaired);
  while (remaining.length) {
    const top = remaining.pop();
    if (top === '{') repaired += '}';
    else if (top === '[') repaired += ']';
    else if (top === '"') repaired += '"';
  }
  try { return JSON.parse(repaired); } catch (_) { return null; }
}
