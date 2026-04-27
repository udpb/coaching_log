// Generate / refresh Gemini embeddings for rows in coaches_directory.
// Safe to re-run: skips rows whose profile text hash matches a previously-stored
// embedding_source_hash (i.e. profile unchanged since last embed).
//
// Uses Google's `gemini-embedding-001` at outputDimensionality=1536, which
// matches the existing pgvector(1536) column. taskType=RETRIEVAL_DOCUMENT
// optimizes the vectors for being indexed (vs. queried).
//
// Usage (PowerShell):
//   cd C:\Users\USER\underdogs-coaching-log
//   $env:SUPABASE_SERVICE_ROLE = "<service_role key>"
//   $env:GEMINI_API_KEY        = "<your-gemini-api-key>"
//   node tools/embed-coaches.js [--force]       # --force re-embeds everything
//
// Usage (Git Bash):
//   SUPABASE_SERVICE_ROLE="<key>" GEMINI_API_KEY="<key>" \
//     node tools/embed-coaches.js
//
// Get a Gemini API key (free): https://aistudio.google.com/apikey

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL  = 'https://zwvrtxxgctyyctirntzj.supabase.co';
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE;
const GEMINI_KEY    = process.env.GEMINI_API_KEY;
const MODEL         = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const OUTPUT_DIM    = parseInt(process.env.GEMINI_EMBED_DIM || '1536', 10);
const FORCE         = process.argv.includes('--force');

if (!SERVICE_ROLE) { console.error('Missing SUPABASE_SERVICE_ROLE env var.'); process.exit(1); }
if (!GEMINI_KEY)   { console.error('Missing GEMINI_API_KEY env var. (Get one free at https://aistudio.google.com/apikey)'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ---------- Source-text construction ----------
function buildSourceText(c) {
  const parts = [];
  if (c.name) parts.push(`이름: ${c.name}`);
  if (c.organization || c.position) {
    parts.push(`소속: ${[c.organization, c.position].filter(Boolean).join(' · ')}`);
  }
  if (Array.isArray(c.industries) && c.industries.length) parts.push(`산업: ${c.industries.join(', ')}`);
  if (Array.isArray(c.expertise)  && c.expertise.length)  parts.push(`전문: ${c.expertise.join(', ')}`);
  if (Array.isArray(c.roles)      && c.roles.length)      parts.push(`역할: ${c.roles.join(', ')}`);
  if (Array.isArray(c.regions)    && c.regions.length)    parts.push(`지역: ${c.regions.join(', ')}`);
  if (Array.isArray(c.tags)       && c.tags.length)       parts.push(`태그: ${c.tags.join(', ')}`);
  if (c.tier) parts.push(`Tier: ${c.tier}`);
  if (c.career_years_raw || c.career_years) parts.push(`경력 연수: ${c.career_years_raw || c.career_years}`);
  if (c.intro) parts.push(`소개: ${c.intro}`);
  if (c.career_history)    parts.push(`경력: ${c.career_history}`);
  if (c.current_work)      parts.push(`현재: ${c.current_work}`);
  if (c.underdogs_history) parts.push(`언더독스 활동: ${c.underdogs_history}`);
  if (c.tools_skills)      parts.push(`스킬: ${c.tools_skills}`);
  return parts.join('\n');
}

function hashText(s) {
  return crypto.createHash('sha256').update(s || '', 'utf-8').digest('hex');
}

// ---------- Gemini batch embed ----------
// Endpoint: batchEmbedContents — accepts up to 100 requests per call.
async function embedBatch(texts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents?key=${encodeURIComponent(GEMINI_KEY)}`;
  const body = {
    requests: texts.map(t => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text: t }] },
      taskType: 'RETRIEVAL_DOCUMENT',
      outputDimensionality: OUTPUT_DIM
    }))
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!Array.isArray(json.embeddings)) {
    throw new Error('Unexpected Gemini response shape: ' + JSON.stringify(json).slice(0, 300));
  }
  return json.embeddings.map(e => e.values);
}

async function main() {
  console.log(`Model: ${MODEL} · Dim: ${OUTPUT_DIM} · Force: ${FORCE}`);

  const COLUMNS = 'id,name,organization,position,intro,career_history,current_work,' +
    'underdogs_history,tools_skills,industries,expertise,roles,regions,tags,tier,' +
    'career_years,career_years_raw,embedding_source_hash,status';

  const { data: coaches, error } = await supabase
    .from('coaches_directory').select(COLUMNS)
    .in('status', ['active', 'draft'])
    .order('name');
  if (error) { console.error('fetch failed:', error.message); process.exit(1); }
  console.log(`Candidates: ${coaches.length}`);

  const todo = [];
  for (const c of coaches) {
    const src = buildSourceText(c);
    if (!src.trim()) continue;
    const h = hashText(src);
    if (!FORCE && c.embedding_source_hash === h) continue;
    todo.push({ id: c.id, src, hash: h });
  }
  console.log(`Need embedding: ${todo.length}`);
  if (todo.length === 0) { console.log('모두 최신 상태입니다. 할 일 없음.'); return; }

  // Gemini batchEmbedContents accepts up to 100 per call; keep 50 to be safe.
  const BATCH = 50;
  const nowIso = new Date().toISOString();
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    let embeddings;
    try {
      embeddings = await embedBatch(slice.map(r => r.src));
    } catch (e) {
      console.error(`\nBatch ${Math.floor(i / BATCH) + 1} Gemini call failed:`, e.message);
      // Throttle on rate-limit (HTTP 429): wait + retry once
      if (/\b429\b|rate/i.test(e.message)) {
        console.error('   → rate limit, 60초 대기 후 재시도');
        await new Promise(r => setTimeout(r, 60000));
        try { embeddings = await embedBatch(slice.map(r => r.src)); }
        catch (e2) { console.error(`재시도 실패:`, e2.message); process.exit(1); }
      } else { process.exit(1); }
    }
    if (embeddings.length !== slice.length) {
      console.error(`\n응답 개수 불일치: 요청 ${slice.length}, 응답 ${embeddings.length}`);
      process.exit(1);
    }
    const updates = slice.map((r, j) =>
      supabase.from('coaches_directory').update({
        embedding: embeddings[j],
        embedding_source_hash: r.hash,
        embedding_updated_at: nowIso,
        embedding_model: MODEL
      }).eq('id', r.id)
    );
    const results = await Promise.all(updates);
    for (const res of results) {
      if (res.error) { console.error(`\n  update failed:`, res.error.message); process.exit(1); }
    }
    done += slice.length;
    process.stdout.write(`\r  ${done}/${todo.length}`);
  }
  console.log('\n\n완료.');
}

main().catch(err => { console.error(err); process.exit(1); });
