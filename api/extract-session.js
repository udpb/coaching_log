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
//     inputMode?: 'memo' | 'transcript',   // default 'transcript'. 'memo' accepts
//                                          // short notes (≥20 chars) and switches the
//                                          // prompt to a conservative short-memo mode.
//     context?: { date, coach, team_name, founder_name, session_num, session_type, prev?: {...} },
//     stream?: boolean }
//
// Response (Phase-1 shape, unchanged):
//   {
//     narrative_summary: "...",
//     fields: { stage: { value, evidence, confidence }, ..., metrics: {...} },
//     low_confidence: [...],
//     raw: "...",
//     usage: {...},
//     modelUsed: "gemini-2.5-pro",
//     extraction_version: "2026-06-10.1"
//   }
//
// Streaming response (when `stream: true`):
//   data: { type: "delta", text, accumulated } ...
//   event: done
//   data: { narrative_summary, fields, low_confidence, raw, usage, modelUsed, extraction_version }

// ADR-020 (2026-06-10): 22필드 정의 단일 진실원본 — public/field-defs.js 를
// 프론트(window.UD_FIELD_DEFS)와 공유한다. @vercel/nft 가 require 를 추적하므로
// 서버리스 번들에 자동 포함된다 (vercel.json 수정 불필요).
const { STRUCTURED_FIELD_KEYS, VALUE_RULES_LINES } = require('../public/field-defs.js');

// PRIMARY model — env override allowed. Don't use bare 'gemini-3.1-pro' (404
// in v1beta); preview IDs need a dated suffix.
const PRIMARY_MODEL  = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-pro';
// FALLBACK model — used automatically when PRIMARY exhausts retries on a
// retryable status (typically 503 high-demand). Flash has bigger capacity
// and is ~10× faster; quality is close enough for STT extraction.
const FALLBACK_MODEL = process.env.GEMINI_CHAT_FALLBACK_MODEL || 'gemini-2.5-flash';
// ADR-021 (2026-06-12): chunked transcription model — flash FIXED, no pro
// fallback. Transcription doesn't need pro reasoning, and a 2-hour session
// fires up to 24 transcribe calls, so we protect pro cost/quota. Transient
// failures still get the normal fetchWithRetry backoff (1s/3s/7s).
const TRANSCRIBE_MODEL = 'gemini-2.5-flash';
// Backoff schedule for retries. 4 fetches total per model
// (initial + 3 retries) — worst case ~11s per model before falling back.
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const API_BASE     = 'https://generativelanguage.googleapis.com/v1beta';

// Phase AA (2026-06-10): extraction prompt/schema version, persisted to
// coaching_logs.extraction_version by the client. Bump on every change that
// alters the MEANING of the output (prompt body, field semantics, schema) —
// format: 'YYYY-MM-DD.<serial>' (serial increments for same-day changes).
const EXTRACTION_VERSION = '2026-06-10.2';

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

// Supabase public project URL (same value as public/index.html:5106).
// URL is public; the anon key must come from env (SUPABASE_ANON_KEY).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zwvrtxxgctyyctirntzj.supabase.co';
// anon key is public (same as public/index.html SUPABASE_KEY); env overrides if set.
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dnJ0eHhnY3R5eWN0aXJudHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTYzNTQsImV4cCI6MjA5MTYzMjM1NH0.VGjjnvR12xBZ68GN1cXIFwqU_1tWLff3fWkOIselb1g';

// Verify the caller's Supabase login JWT via the Auth REST endpoint.
// Returns true only on a valid, non-expired access token. fail-closed:
// missing header → false; missing anon key → caller handled as 503 below.
async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return false;
  const jwt = match[1].trim();
  if (!jwt) return false;

  const anon = SUPABASE_ANON;
  if (!anon) return false; // fail-closed; caller maps to 503 (auth not configured)

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: anon }
    });
    return r.ok; // 200 = valid token, 401 = invalid/expired
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  // CORS — allowlist of known app origins (no wildcard). same-origin requests
  // don't send an Origin header / don't preflight, so this won't break them.
  const allow = [
    'https://coaching-log-lemon.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
  ];
  if (process.env.APP_ORIGIN) allow.push(process.env.APP_ORIGIN);
  const origin = req.headers.origin;
  if (allow.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Auth gate — reject unauthenticated/invalid callers before any Gemini cost.
  if (!(await verifyAuth(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let apiKey = (process.env.GEMINI_API_KEY || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  try {
    // ADR-021 (2026-06-12): task:'transcribe' — transcribe-only path for the
    // 5-minute audio chunks produced by the client's chunked recorder.
    // Existing extraction requests never send `task`, so this branch is inert
    // for them — request/response bytes of the text/audio/memo extraction
    // paths are unchanged (verified by mock byte-diff against HEAD).
    if (req.body && req.body.task === 'transcribe') {
      return await handleTranscribe(req, res, apiKey);
    }

    const { transcript, audio, audioMimeType, context, stream: wantStream, inputMode } = req.body || {};

    // Phase D2 (2026-05-03): two input modes — transcript text OR audio file.
    //   - transcript mode (legacy): caller pasted STT text. Must be ≥50 chars.
    //   - audio mode (new): caller recorded with MediaRecorder. Gemini 2.5 Pro
    //     accepts inline_data audio and will (a) implicitly transcribe in its
    //     reasoning, (b) emit the same structured JSON in one round-trip.
    //     Saves the user the "external STT → paste" step on mobile.
    // At least one is required. If both are present, audio wins (richer signal).
    //
    // Q2 (2026-06-10): memo mode — body.inputMode === 'memo' relaxes the text
    // minimum to 20 chars and switches the prompt to a conservative short-memo
    // variant (2-4 sentence narrative, no speculation, empty fields are normal,
    // confidence ≤ 0.7). Default stays 'transcript' (≥50 chars, unchanged).
    const wantMemo = inputMode === 'memo';
    const minTranscriptLen = wantMemo ? 20 : 50;
    const hasAudio = typeof audio === 'string' && audio.length > 100;
    const hasTranscript = typeof transcript === 'string' && transcript.trim().length >= minTranscriptLen;
    // Memo prompt only applies to text input; if audio is attached, audio wins
    // (full-signal path stays exactly as before).
    const isMemo = wantMemo && !hasAudio;

    if (!hasAudio && !hasTranscript) {
      return res.status(400).json({
        error: 'Provide `transcript` (≥50 chars; or ≥20 chars with inputMode:"memo") or `audio` (base64 inline_data).'
      });
    }
    if (hasTranscript && transcript.length > 120000) {
      return res.status(413).json({ error: 'transcript too long (max 120k chars)' });
    }
    if (hasAudio) {
      // Vercel Node Function request body hard limit is 4.5MB. base64 inflates
      // raw bytes by ~33%, so we cap at 4_000_000 chars ≈ 3MB raw audio.
      // At 64kbps Opus that's ~6-7 min; at 96kbps ~4-5 min. The client's
      // 15-min auto-stop is the secondary guard but most coaching sessions
      // exceed 4MB anyway, so the realistic ceiling is closer to 7 min.
      // Future: upload to Supabase Storage and pass a signed URL instead.
      if (audio.length > 4_000_000) {
        return res.status(413).json({
          error: 'audio too long. 약 7분 이하로 녹음하거나 외부 STT 도구로 transcript를 만들어 붙여넣어 주세요.'
        });
      }
    }

    const ctx = context || {};
    const prev = ctx.prev || null;
    const isFirst = !prev;

    const systemPrompt = buildSystemPrompt(isMemo);
    // In audio-only mode we pass an empty transcript placeholder; the model
    // gets the real transcript from the audio part below.
    const userPrompt = buildUserPrompt(
      hasTranscript ? transcript : '(아래 첨부된 음성 녹음을 듣고 직접 transcript를 추출하여 분석하세요. 한국어·영어 혼용 가능.)',
      ctx, prev, isFirst, isMemo
    );

    // Gemini request body:
    //  - `system_instruction`: single message-like object holding the system prompt
    //  - `contents`: multi-turn array; for one-shot we send a single user turn
    //  - `generationConfig.responseMimeType: 'application/json'` forces clean JSON
    //    out of the model (no markdown fences in happy path)
    //  - `streamGenerateContent?alt=sse` for SSE streaming (handled below)
    // Build the parts array. Text always first (it has the schema + context),
    // audio inline_data appended when in audio mode. Gemini 2.5 Pro/Flash both
    // support audio/* inline_data up to ~9 hours; we cap at ~15min via the
    // body size check above.
    const userParts = [{ text: userPrompt }];
    if (hasAudio) {
      userParts.push({
        inline_data: {
          mime_type: audioMimeType || 'audio/webm',
          data: audio,
        }
      });
    }

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        temperature: 0.4,
        // Token budget for thinking + answer combined. gemini-2.5-pro uses
        // hidden reasoning tokens before emitting the JSON answer. The
        // previous 5120 (sized for gemini-3.1-pro which had no thinking)
        // was too tight; bumping to 16384 gives ~3x headroom.
        // 16384 → 24576: audio 모드일 때 raw_transcript 도 함께 출력하므로 헤드룸 확보.
        // 7분 audio (~7-10k char Korean) + narrative + fields ≈ 18-20k char ≈ 9-10k tokens.
        maxOutputTokens: 24576,
        // Force JSON output so parseJsonFromText doesn't have to deal with
        // markdown fences in the happy path.
        responseMimeType: 'application/json',
        // CRITICAL for gemini-2.5-pro: cap thinking explicitly. Without this
        // the model's default unbounded thinking + responseMimeType:json
        // sometimes finishes thinking and emits zero visible text, returning
        // an empty stream. A modest 1024 budget covers schema-anchored
        // structured extraction; the real reasoning happens in the prompt.
        // (gemini-2.5-flash accepts 0 to disable thinking entirely; 1024
        //  works for both PRIMARY and FALLBACK without per-model branching.)
        thinkingConfig: { thinkingBudget: 1024 }
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
      modelUsed,
      extraction_version: EXTRACTION_VERSION
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// -----------------------------------------------------------------------
// ADR-021 (2026-06-12): transcribe-only handler for 5-min audio chunks.
//   body: { task:'transcribe', audio(base64), audioMimeType,
//           chunkIndex?, totalElapsedSec? }
//   resp: 200 { raw_transcript, modelUsed } — non-stream JSON.
// Model is TRANSCRIBE_MODEL (flash) fixed — no pro fallback. thinking 0.
// Shares only fetchWithRetry / extractGeminiText / parseJsonFromText with the
// extraction path; the extraction prompt (EXTRACTION_VERSION) is untouched —
// changing this prompt does NOT bump EXTRACTION_VERSION (no extraction-
// semantics change).
// -----------------------------------------------------------------------
function buildTranscribePrompt() {
  return [
    'You are a verbatim transcription engine for a 1:1 startup coaching session audio chunk (Korean/English, possibly mixed).',
    'Transcribe the attached audio EXACTLY as spoken:',
    '- Preserve filler words, false starts, and mixed-language switches.',
    '- If speakers are distinguishable, prefix lines with "코치: " or "창업자: ". If unsure, omit prefixes.',
    '- Do NOT summarize, interpret, translate, or add any meta commentary.',
    '- If the audio contains only silence or noise, output an empty string for raw_transcript.',
    'Output a single valid JSON object and nothing else: {"raw_transcript": "..."}'
  ].join('\n');
}

async function handleTranscribe(req, res, apiKey) {
  const { audio, audioMimeType, chunkIndex, totalElapsedSec } = req.body || {};
  // audio is the only required input — no transcript/inputMode/memo logic here.
  const hasAudio = typeof audio === 'string' && audio.length > 100;
  if (!hasAudio) {
    return res.status(400).json({ error: 'task "transcribe" requires `audio` (base64 inline_data).' });
  }
  // Same Vercel 4.5MB body guard as the extraction path (4M base64 chars ≈ 3MB raw).
  // A 5-min 32kbps chunk is ~1.6M base64 chars — well under the cap.
  if (audio.length > 4_000_000) {
    return res.status(413).json({ error: 'audio chunk too large (max 4M base64 chars ≈ 3MB raw)' });
  }

  const userLines = ['Transcribe this coaching-session audio chunk verbatim. Output {"raw_transcript":"..."} only.'];
  if (Number.isFinite(Number(chunkIndex))) {
    const elapsedNote = Number.isFinite(Number(totalElapsedSec))
      ? `, ~${Math.round(Number(totalElapsedSec) / 60)} min into the session`
      : '';
    userLines.push(`(This is chunk #${Number(chunkIndex) + 1} of an ongoing recording${elapsedNote}. It may start/end mid-sentence — transcribe it as-is.)`);
  }

  const body = {
    system_instruction: { parts: [{ text: buildTranscribePrompt() }] },
    contents: [{
      role: 'user',
      parts: [
        { text: userLines.join('\n') },
        { inline_data: { mime_type: audioMimeType || 'audio/webm', data: audio } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      // 5-min Korean speech ≈ 1-2k chars; 16384 covers fast English speech too.
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      // flash accepts 0 — transcription needs no reasoning; minimizes latency.
      thinkingConfig: { thinkingBudget: 0 }
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  const response = await fetchWithRetry(TRANSCRIBE_MODEL, body, apiKey, false);
  if (!response || !response.ok) {
    const errText = response ? await response.text().catch(() => '') : 'no upstream response';
    return res.status(response ? response.status : 502).json({ error: errText, modelTried: TRANSCRIBE_MODEL });
  }
  const data = await response.json();
  const raw = extractGeminiText(data);
  // Silence-only chunks still produce raw = '{"raw_transcript":""}' — raw
  // itself being empty means the model emitted nothing at all.
  if (!raw) {
    return res.status(500).json({ error: 'Model returned no text', modelUsed: TRANSCRIBE_MODEL });
  }
  const parsed = parseJsonFromText(raw); // includes repairAndParse (reused as-is)
  if (!parsed || typeof parsed.raw_transcript !== 'string') {
    return res.status(500).json({ error: 'Model did not return valid transcription JSON', raw, modelUsed: TRANSCRIBE_MODEL });
  }
  return res.status(200).json({ raw_transcript: parsed.raw_transcript, modelUsed: TRANSCRIBE_MODEL });
}

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
  let lastFinishReason = null;
  let chunkCount = 0;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  // Gemini SSE format: each event is `data: {<JSON>}\n\n` (or `\r\n\r\n`
  // depending on Google's HTTP layer; gemini-2.5 uses CRLF so we normalize).
  // Each JSON contains a `candidates[0].content.parts[*].text` chunk and
  // (on the last event) `usageMetadata` + `finishReason`.
  //
  // Helper: drains every complete `data: {...}` event from a string buffer,
  // returning the partial leftover. CRLF-tolerant.
  const processBuffer = (rawBuf, onPayload) => {
    // Normalize CRLF → LF first so the rest of the parser can stay simple.
    const normalized = rawBuf.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    const leftover = parts.pop();
    for (const evt of parts) {
      let dataLine = '';
      for (const line of evt.split('\n')) {
        if (line.startsWith('data: ')) dataLine += line.slice(6);
      }
      if (!dataLine) continue;
      let payload;
      try { payload = JSON.parse(dataLine); } catch { continue; }
      onPayload(payload);
    }
    return leftover;
  };

  const handlePayload = (payload) => {
    chunkCount++;
    const text = extractGeminiText(payload);
    if (text) {
      fullText += text;
      writeEvent(null, { type: 'delta', text, accumulated: fullText });
    }
    if (payload.usageMetadata) usage = payload.usageMetadata;
    if (payload.candidates && payload.candidates[0] && payload.candidates[0].finishReason) {
      lastFinishReason = payload.candidates[0].finishReason;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = processBuffer(buf, handlePayload);
  }

  // Drain any final event the upstream forgot to terminate with `\n\n`
  // (Gemini occasionally closes the stream without a trailing blank line).
  if (buf && /^\s*data:/.test(buf.replace(/\r\n/g, '\n'))) {
    processBuffer(buf + '\n\n', handlePayload);
  }

  // Diagnostic: log to Vercel function logs when the answer comes back empty.
  // (Visible at Vercel → coaching-log → Functions → /api/extract-session → Logs.)
  if (!fullText || fullText.length < 50) {
    try {
      console.warn('[extract-session] empty/short response from upstream', {
        modelUsed,
        chunkCount,
        fullTextLength: fullText.length,
        lastFinishReason,
        usage,
        firstChunkBuf: buf.slice(0, 500)
      });
    } catch (_) {}
  }

  const parsed = parseJsonFromText(fullText);
  const normalized = parsed
    ? normalizeModelOutput(parsed, prev)
    : { narrative_summary: '', fields: {}, low_confidence: [], raw_transcript: '' };
  writeEvent('done', Object.assign({}, normalized, {
    raw: fullText,
    usage,
    modelUsed,
    extraction_version: EXTRACTION_VERSION,
    finishReason: lastFinishReason,
    chunkCount
  }));
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
// STRUCTURED_FIELD_KEYS 는 public/field-defs.js 에서 가져온다 (ADR-020) —
// 키 집합·순서는 기존 하드코딩과 동일 (23키, metrics 포함).
// -----------------------------------------------------------------------

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
  // Phase #4 (2026-05-03): audio 모드일 때 Gemini 가 첫 패스에서 만드는 verbatim transcript.
  const rawTranscript = typeof parsed.raw_transcript === 'string' ? parsed.raw_transcript : '';

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

  return { narrative_summary: narrative, fields, low_confidence: lowConf, raw_transcript: rawTranscript };
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

// Q2 (2026-06-10): isMemo=true switches PASS 1 to a 2-4 sentence facts-only
// narrative and prepends conservative memo rules before VALUE RULES. The 22
// field definitions (STRUCTURED_FIELD_KEYS) and output schema are identical
// in both modes.
function buildSystemPrompt(isMemo) {
  const pass1 = isMemo
    ? [
        'PASS 1 — NARRATIVE SUMMARY (narrative_summary)',
        '  The input is a SHORT MEMO the coach wrote after the session — NOT a full transcript.',
        '  Write a 2-4 sentence summary using ONLY facts explicitly stated in the memo.',
        '  Do NOT speculate, embellish, or add details that are not in the memo. No guessing.',
      ]
    : [
        'PASS 1 — NARRATIVE SUMMARY (narrative_summary)',
        '  Write an 8-15 sentence rich prose summary of the session in the dominant language of the transcript.',
        '  Capture: what was discussed, what the founder committed to last time and how it went, the real root-cause insight that emerged, any pivot/decision, the founder\'s emotional state and energy, what the coach will watch for next.',
        '  This is the COACH\'S MEMORY of the session — it must preserve nuance, specifics, and the arc of the conversation, not just keywords.',
        '  Prefer concrete details ("7 out of 10 interviews completed, 2 pilot candidates secured") over vague summaries ("made progress").',
      ];

  const memoRules = isMemo
    ? [
        'MEMO MODE — CONSERVATIVE EXTRACTION:',
        '  The input is a short memo, so MOST fields being empty is the NORMAL, expected outcome.',
        '  Fill a field ONLY if the memo gives direct evidence for it. Any field without direct',
        '  grounding in the memo MUST be left empty ("" / 0 / [] / false).',
        '  For every field you do fill, set confidence ≤ 0.7 (be conservative).',
        '',
      ]
    : [];

  return [
    'You are an assistant that extracts structured coaching session data from raw Speech-to-Text (STT) transcripts.',
    'The transcript is a 1:1 startup coaching session between a coach and a founder (may be in Korean, English, or mixed).',
    '',
    'YOUR JOB has two passes (THREE when the user attaches audio):',
    '',
    'PASS 0 — RAW TRANSCRIPT (raw_transcript, audio-mode only)',
    '  IF the user-turn contains audio inline_data (not just text), you MUST first',
    '  transcribe the audio verbatim into the top-level "raw_transcript" string.',
    '  - Speaker labels are optional but encouraged: "코치: ..." / "창업자: ..."',
    '  - Preserve filler words, false starts, mixed-language switches — this is the',
    '    literal evidence trail the coach will verify or hand-edit.',
    '  - When the input is text-only (no audio), set "raw_transcript" to "" and skip this pass.',
    '  After producing the transcript, treat it AS IF it were the user-provided text',
    '  for PASS 1 & 2 below.',
    '',
    ...pass1,
    '',
    'PASS 2 — STRUCTURED FIELDS (fields.*)',
    '  Based on the narrative you just wrote AND the raw transcript, fill each structured field.',
    '  Each field MUST be an object: { "value": ..., "evidence": "<direct quote or tight paraphrase from the transcript that justifies this value>", "confidence": 0.0-1.0 }.',
    '  - value: the extracted value per the enum/rules below. Use "" (or 0 / [] / false) if not discussed.',
    '  - evidence: 1-3 sentences lifted directly from the transcript (or tight paraphrase if the coach\'s question + founder\'s answer span multiple turns). Required for every non-empty value. Leave "" only if value is also empty.',
    '  - confidence: your self-assessed confidence that the value is correct, 0.0 to 1.0.',
    '  List every field with confidence < 0.7 in the top-level "low_confidence" array so the UI highlights it.',
    '',
    ...memoRules,
    'VALUE RULES:',
    // ADR-020: 필드별 규칙 줄은 public/field-defs.js 의 valueRule 에서 생성.
    // 기존 하드코딩 26줄과 문자 단위 동일 (M1 브리프에서 diff 0 검증).
    ...VALUE_RULES_LINES,
    '',
    'IMPORTANT:',
    '  1. Output a single valid JSON object — nothing else. No prose before/after, no markdown fences. The response MIME is set to application/json.',
    '  2. Do NOT invent content. If not in the transcript, use "" / 0 / [] / false with confidence ≤ 0.3.',
    '  3. Preserve the dominant language of the transcript in free-text fields.',
    '  4. Emit keys in the schema order so partial streams are usable early:',
    '     raw_transcript (if audio) → narrative_summary → fields → low_confidence.',
    '     raw_transcript MUST appear first when audio is present so the coach can see',
    '     it streaming in early while the rest of the analysis is still being produced.',
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

function buildUserPrompt(transcript, ctx, prev, isFirst, isMemo) {
  const header = [
    '## Session context (provided by coach app)',
    `- date: ${ctx.date || '(unknown)'}`,
    `- coach: ${ctx.coach || '(unknown)'}`,
    `- team_name: ${ctx.team_name || '(unknown)'}`,
    `- founder_name: ${ctx.founder_name || '(unknown)'}`,
    `- session_num: ${ctx.session_num || '(unknown)'}`,
    `- expected session_type: ${isFirst ? 'first' : 'regular (continuing)'}`,
  ];
  // Q2 (2026-06-10): memo mode marker — one line only, schema untouched.
  if (isMemo) header.push('- input type: short memo (not a full transcript)');
  header.push('');

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
