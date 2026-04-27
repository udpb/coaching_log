// One-time seed: coaches_db.json → Supabase coaches_directory.
// Re-runs safely (upserts on external_id).
//
// Uses the service_role key. This is the clean approach for admin batch
// operations: (1) works regardless of the admin's auth method (email/password,
// GitHub OAuth, SSO, etc.), and (2) bypasses RLS which is exactly what a
// controlled seed script should do.
//
// Security: service_role key MUST NEVER be committed or shipped to the client.
// It lives only in your shell environment while you run this script.
//
// Usage (PowerShell):
//   cd C:\Users\USER\underdogs-coaching-log
//   $env:SUPABASE_SERVICE_ROLE = '<service_role key>'
//   node tools/import-coaches.js
//   Remove-Item Env:SUPABASE_SERVICE_ROLE    # optional cleanup
//
// Usage (Git Bash):
//   cd /c/Users/USER/underdogs-coaching-log
//   SUPABASE_SERVICE_ROLE='<service_role key>' node tools/import-coaches.js
//
// Where to find the service_role key:
//   Supabase Dashboard → Project Settings → API →
//   Project API keys → service_role → "Reveal" → copy

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://zwvrtxxgctyyctirntzj.supabase.co';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SERVICE_ROLE) {
  console.error('');
  console.error('service_role 키가 필요합니다.');
  console.error('  1. Supabase Dashboard → Project Settings → API');
  console.error('  2. "service_role" 키 "Reveal" → 복사');
  console.error('  3. 환경변수로 전달:');
  console.error('');
  console.error('     PowerShell:  $env:SUPABASE_SERVICE_ROLE = "<키>"');
  console.error('     Git Bash  :  SUPABASE_SERVICE_ROLE="<키>"');
  console.error('');
  console.error('  4. 다시 실행:');
  console.error('     node tools/import-coaches.js');
  console.error('');
  process.exit(1);
}

const DEFAULT_JSON = path.join(__dirname, '..', '..', 'underdogs-coach-finder', 'python-service', 'coaches_db.json');
const jsonPath = process.argv[2] || DEFAULT_JSON;

if (!fs.existsSync(jsonPath)) {
  console.error(`coaches_db.json 파일을 찾지 못했습니다: ${jsonPath}`);
  console.error('인수로 경로를 직접 주거나, underdogs-coach-finder를 sibling 폴더에 두세요.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
console.log(`원본 JSON: ${raw.length}명`);

function asArray(v)  { return Array.isArray(v) ? v.filter(x => x != null && x !== '') : []; }
function nonEmpty(v) { return (typeof v === 'string' && v.trim() !== '') ? v.trim() : null; }
function num(v)      { const n = Number(v); return Number.isFinite(n) ? n : null; }

function mapCoach(c) {
  return {
    external_id:       String(c.id),
    name:              nonEmpty(c.name) || '(이름 미기재)',
    email:             c.email ? String(c.email).toLowerCase().trim() : null,
    phone:             nonEmpty(c.phone),
    gender:            nonEmpty(c.gender),
    location:          nonEmpty(c.location),
    country:           nonEmpty(c.country),
    regions:           asArray(c.regions),
    organization:      nonEmpty(c.organization),
    position:          nonEmpty(c.position),
    industries:        asArray(c.industries),
    expertise:         asArray(c.expertise),
    roles:             asArray(c.roles),
    language:          nonEmpty(c.language),
    tags:              [],
    overseas:          !!c.overseas,
    overseas_detail:   nonEmpty(c.overseas_detail),
    intro:             nonEmpty(c.intro),
    career_history:    nonEmpty(c.career_history),
    education:         nonEmpty(c.education),
    underdogs_history: nonEmpty(c.underdogs_history),
    current_work:      nonEmpty(c.current_work),
    tools_skills:      nonEmpty(c.tools_skills),
    career_years:      num(c.career_years),
    career_years_raw:  nonEmpty(c.career_years_raw),
    photo_url:         nonEmpty(c.photo_url),
    photo_filename:    nonEmpty(c.photo),
    tier:              nonEmpty(c.tier),
    category:          nonEmpty(c.category),
    business_type:     nonEmpty(c.business_type),
    status:            'active',
    availability_status: 'available',
    last_synced_at:    new Date().toISOString(),
  };
}

async function main() {
  // De-duplicate within source
  const seen = new Set();
  const mapped = [];
  for (const c of raw) {
    const eid = String(c.id);
    if (seen.has(eid)) continue;
    seen.add(eid);
    mapped.push(mapCoach(c));
  }

  console.log(`upsert 대상: ${mapped.length}명\n`);

  const batchSize = 50;
  let processed = 0;
  for (let i = 0; i < mapped.length; i += batchSize) {
    const batch = mapped.slice(i, i + batchSize);
    const { error } = await supabase
      .from('coaches_directory')
      .upsert(batch, { onConflict: 'external_id' });
    if (error) {
      console.error(`\n배치 ${Math.floor(i / batchSize) + 1} 실패:`, error.message);
      console.error('전체 응답:', JSON.stringify(error, null, 2));
      process.exit(1);
    }
    processed += batch.length;
    process.stdout.write(`\r  ${processed}/${mapped.length}`);
  }
  console.log('\n\n완료.');

  const { count } = await supabase
    .from('coaches_directory').select('*', { count: 'exact', head: true });
  console.log(`coaches_directory 총 ${count}행.`);
}

main().catch(err => { console.error(err); process.exit(1); });
