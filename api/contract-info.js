// ─────────────────────────────────────────────────────────────────────
// Vercel Serverless Function — coach_contract_info 암복호 경유 엔드포인트
// ADR-024 / Brief ENC2 (2026-06-25).
//
// 목적:
//   브라우저가 coach_contract_info 의 민감 6필드를 평문으로 직접 다루지 않게,
//   서버가 사용자 Supabase JWT 로 RLS 경계를 유지한 채 암복호만 추가한다.
//   브라우저는 행을 직접 읽어도 암호문만 보고, 평문은 이 엔드포인트로만 받는다.
//
// 인증:
//   Authorization: Bearer <supabase access token> 필수.
//   anon 키 + 사용자 JWT 로 Supabase 클라 생성 → RLS(cci_*) 가 인가 결정.
//   ⚠️ service-role 절대 미사용 (RLS 가 보안 경계).
//
// GET  /api/contract-info?coachId=<uuid>&reveal=0|1
//   - 1행 조회(RLS). 6 *_enc 필드 복호.
//   - reveal!=1 → 마스킹 값. reveal=1 → 평문(계약서 생성용).
//   - 비민감(is_business, tax_type, updated_at) 그대로 통과.
//
// POST /api/contract-info   body = 평문 객체
//   - business_number 형식검증(^[0-9\-]{10,15}$, null 허용) — 평문 CHECK 가
//     ENC5 에서 사라지므로 여기서 검증.
//   - 6필드 암호화 → *_enc 컬럼으로 UPSERT(RLS WITH CHECK). 비민감도 저장.
// ─────────────────────────────────────────────────────────────────────

const { createClient } = require('@supabase/supabase-js');
const {
  encryptField,
  decryptField,
  maskAccount,
  maskGeneric,
  normalizeEmptyToNull,
} = require('./_lib/contractCrypto.js');

// Supabase project URL/anon — extract-session.js 와 동일 값(공개). env 우선.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zwvrtxxgctyyctirntzj.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3dnJ0eHhnY3R5eWN0aXJudHpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNTYzNTQsImV4cCI6MjA5MTYzMjM1NH0.VGjjnvR12xBZ68GN1cXIFwqU_1tWLff3fWkOIselb1g';

// PK 컬럼. 민감 6필드(평문 키) ↔ *_enc 컬럼 매핑.
const PK_COLUMN = 'coach_directory_id';
const SENSITIVE_FIELDS = [
  'address',
  'bank_name',
  'account_number',
  'account_holder',
  'business_number',
  'business_name',
];
// 비민감 통과 필드. is_business 는 D5 스키마에 없으나(Phase L 추가 가능성)
// 존재 시 통과시키기 위해 화이트리스트에 포함 — 없으면 단순 무시.
const PASSTHROUGH_READ = ['is_business', 'tax_type', 'updated_at'];
const PASSTHROUGH_WRITE = ['is_business', 'tax_type'];

const BUSINESS_NUMBER_RE = /^[0-9\-]{10,15}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 사용자 JWT 추출. 없으면 null.
function extractBearer(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  const jwt = match[1].trim();
  return jwt || null;
}

// 사용자 토큰으로 RLS 적용 Supabase 클라 생성.
// global.headers.Authorization 로 PostgREST 요청에 사용자 JWT 가 실려
// auth.uid()/RLS 가 그 사용자로 평가된다. service-role 미사용.
function userClient(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// 마스킹: 계좌번호는 maskAccount, 나머지는 maskGeneric.
function maskField(key, plain) {
  if (key === 'account_number') return maskAccount(plain);
  return maskGeneric(plain);
}

module.exports = async function handler(req, res) {
  // CORS — 알려진 앱 오리진 화이트리스트 (와일드카드 금지, extract-session.js 관례).
  const allow = [
    'https://coaching-log-lemon.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ];
  if (process.env.APP_ORIGIN) allow.push(process.env.APP_ORIGIN);
  const origin = req.headers.origin;
  if (allow.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 인증 게이트 — 무인증 거부.
  const jwt = extractBearer(req);
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });
  if (!SUPABASE_ANON) {
    return res.status(503).json({ error: 'Auth not configured on server' });
  }

  const supabase = userClient(jwt);

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res, supabase);
    }
    return await handlePost(req, res, supabase);
  } catch (err) {
    // crypto/설정 오류(키 미설정 등)·예기치 못한 예외 → 500. 시크릿 미로그.
    return res.status(500).json({ error: err.message });
  }
};

async function handleGet(req, res, supabase) {
  const coachId = (req.query && req.query.coachId) || '';
  const reveal = String((req.query && req.query.reveal) || '0') === '1';

  if (!coachId || !UUID_RE.test(String(coachId))) {
    return res.status(400).json({ error: 'coachId (uuid) required' });
  }

  // RLS 가 인가 결정. 접근 불가/없음 → maybeSingle() null.
  const { data, error } = await supabase
    .from('coach_contract_info')
    .select('*')
    .eq(PK_COLUMN, coachId)
    .maybeSingle();

  if (error) {
    // RLS 거부는 보통 0행(→ data null, error null). 진짜 에러만 여기로.
    return res.status(403).json({ error: 'Access denied or query failed', detail: error.message });
  }
  if (!data) {
    // RLS 로 안 보이거나 행이 없음 — 둘 다 빈 객체로(존재 여부 노출 최소화).
    return res.status(200).json({ coachId, found: false, fields: {} });
  }

  const fields = {};
  for (const key of SENSITIVE_FIELDS) {
    const enc = data[`${key}_enc`];
    let plain = null;
    try {
      plain = decryptField(enc);
    } catch (e) {
      // 변조/버전불명/형식오류 — 해당 필드만 에러 표시, 전체는 계속.
      fields[key] = reveal ? null : null;
      fields[`${key}_error`] = 'decrypt_failed';
      continue;
    }
    fields[key] = reveal ? plain : maskField(key, plain);
  }

  const passthrough = {};
  for (const k of PASSTHROUGH_READ) {
    if (k in data) passthrough[k] = data[k];
  }

  return res.status(200).json({ coachId, found: true, reveal, fields, ...passthrough });
}

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const coachId = body.coachId || body[PK_COLUMN] || '';

  if (!coachId || !UUID_RE.test(String(coachId))) {
    return res.status(400).json({ error: 'coachId (uuid) required in body' });
  }

  // business_number 형식검증 (평문 CHECK 가 ENC5 에서 제거되므로 서버 검증).
  // null/빈값 허용. 값이 있으면 ^[0-9\-]{10,15}$.
  const bn = normalizeEmptyToNull(body.business_number);
  if (bn !== null && !BUSINESS_NUMBER_RE.test(String(bn))) {
    return res.status(400).json({
      error: 'business_number must match ^[0-9\\-]{10,15}$ or be empty',
    });
  }

  // 6필드 암호화 → *_enc 컬럼. 평문 컬럼은 절대 쓰지 않는다.
  const row = { [PK_COLUMN]: coachId };
  for (const key of SENSITIVE_FIELDS) {
    row[`${key}_enc`] = encryptField(body[key]);
  }
  // 비민감 통과 필드 — 본문에 존재할 때만 저장.
  for (const k of PASSTHROUGH_WRITE) {
    if (k in body) row[k] = body[k];
  }

  // UPSERT — PK 충돌 시 갱신. RLS WITH CHECK(cci_insert/cci_update) 가 인가 게이트.
  const { data, error } = await supabase
    .from('coach_contract_info')
    .upsert(row, { onConflict: PK_COLUMN })
    .select(PK_COLUMN)
    .maybeSingle();

  if (error) {
    // RLS WITH CHECK 위반 → PostgREST 42501. 인가 실패는 403.
    const status = /row-level security|permission|42501/i.test(error.message || '') ? 403 : 400;
    return res.status(status).json({ error: 'Upsert denied or failed', detail: error.message });
  }

  return res.status(200).json({ coachId, saved: true, written: !!data });
}
