// api/_lib/geminiClient.js
// 공용 Gemini 호출 + Supabase JWT 인증 + JSON 파싱 인프라 (신규 · B3).
//
// 배경: api/extract-session.js 는 검증된 Gemini/인증/파싱 헬퍼를 인라인으로
//   갖고 있으나 `module.exports = handler` 라 그 헬퍼들을 밖에서 require 할 수
//   없다. 신규 엔드포인트(api/template-ai.js 의 ingest/fill 등)가 같은 인프라를
//   재사용하도록, 그 헬퍼들을 자체완결 공용 모듈로 옮겨 담는다.
//   · extract-session.js 는 **수정하지 않음**(인라인 사본 그대로 유지).
//   · ⚠️ 중복 주의: 로직은 extract-session.js 인라인 사본과 동일. 향후 리팩터에서
//     extract-session 도 본 모듈을 참조하도록 일원화 가능(별도 브리프 TODO).
//
// 출처 대응(api/extract-session.js): PRIMARY/FALLBACK(41,45) · RETRY(53) ·
//   isRetryableStatus(62) · fetchWithRetry(68) · callWithFallback(101) ·
//   verifyAuth(121) · CORS(144-153) · extractGeminiText(528) ·
//   parseJsonFromText(772) · repairAndParse(788).
'use strict';

// ── 모델 상수 (extract-session.js:41,45 동일) ──────────────────────────
const PRIMARY_MODEL  = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-pro';
const FALLBACK_MODEL = process.env.GEMINI_CHAT_FALLBACK_MODEL || 'gemini-2.5-flash';
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ── Supabase (public 값 — anon 키는 공개 설계, env 로 덮어쓰기 가능) ─────
const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://zwvrtxxgctyyctirntzj.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dnJ0eHhnY3R5eWN0aXJudHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTYzNTQsImV4cCI6MjA5MTYzMjM1NH0.VGjjnvR12xBZ68GN1cXIFwqU_1tWLff3fWkOIselb1g';

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

// 단일 모델 fetch + 일시 실패(429/5xx/네트워크) 재시도. 최종 Response 반환.
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

// PRIMARY(재시도) → 지속 실패 시 FALLBACK(재시도). { response, modelUsed } 반환.
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

// 호출자의 Supabase 로그인 JWT 검증(Auth REST). 유효·미만료 토큰만 true.
// fail-closed: 헤더 없음/anon 없음 → false.
async function verifyAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return false;
  const jwt = match[1].trim();
  if (!jwt) return false;
  if (!SUPABASE_ANON) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: SUPABASE_ANON }
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

// Gemini 응답(또는 스트림 청크)에서 텍스트 페이로드 추출.
function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates) || data.candidates.length === 0) return '';
  const c = data.candidates[0];
  if (!c.content || !Array.isArray(c.content.parts)) return '';
  return c.content.parts.map(p => (typeof p.text === 'string' ? p.text : '')).join('');
}

// 텍스트에서 JSON 파싱. 코드펜스 제거 → 직접 파싱 → 중괄호 슬라이스 → 잘림복구.
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

// 잘린(truncated) JSON 을 마지막 완성 값까지 자르고 미닫힘 괄호/따옴표를 닫아 파싱.
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
    while (i + 1 < src.length && !',}]\n\r\t '.includes(src[i + 1])) i++;
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
      if (c === '}') { if (st[st.length - 1] === '{') st.pop(); continue; }
      if (c === ']') { if (st[st.length - 1] === '[') st.pop(); continue; }
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

// CORS allowlist (extract-session.js:144-153 동형). 헤더만 세팅 — OPTIONS/메서드
// 분기는 호출자가 처리. 프리플라이트가 아니면 same-origin 요청은 Origin 없음.
function applyCors(req, res) {
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
}

module.exports = {
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  API_BASE,
  isRetryableStatus,
  fetchWithRetry,
  callWithFallback,
  verifyAuth,
  extractGeminiText,
  parseJsonFromText,
  repairAndParse,
  applyCors
};
