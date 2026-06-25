// ─────────────────────────────────────────────────────────────────────
// contractCrypto.js — coach_contract_info 민감 필드 AES-256-GCM 암복호 유틸
// ADR-024 (2026-06-25) · Brief ENC2.
//
// 형식:  v<N>:<iv>.<tag>.<ciphertext>   (iv/tag/ct 각각 base64)
//   v<N>  = 키 버전 태그. 복호 시 CONTRACT_ENC_KEYS 맵에서 N번 키를 라우팅.
//   분리자 '.' 는 base64 알파벳(A-Za-z0-9+/=)에 없으므로 값과 충돌 없음.
//
// 키 (Vercel env · Sensitive · 양 앱 공통 — ADR-024):
//   CONTRACT_ENC_KEYS        = JSON 버전→base64(32B)키 맵, 예 {"1":"<base64 32B>"}
//   CONTRACT_ENC_KEY_ACTIVE  = 새 암호화에 쓸 버전 문자열, 예 "1"
//
// 로테이션은 env만 바꾸면 됨(코드 0): 맵에 새 버전 추가 + ACTIVE 변경 + 배포.
// 옛 암호문은 헤더의 v<N> 으로 옛 키를 계속 조회해 복호된다.
//
// Node 내장 crypto 만 사용(외부 의존성 0). 키/평문은 절대 로그하지 않는다.
// ─────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;   // GCM 권장 96-bit nonce
const TAG_BYTES = 16;  // GCM 인증태그 128-bit
const KEY_BYTES = 32;  // AES-256

// ── 키 로드 (모듈 1회 평가, 결과 캐시) ──────────────────────────────
// 키맵/ACTIVE 를 lazy 로 로드해 "키 없음" 같은 설정 오류를 호출 시점에
// 명확한 Error 로 던진다(모듈 import 만으로 죽지 않음 → 핸들러가 500 매핑).
let _cache = null;

function loadKeys() {
  if (_cache) return _cache;

  const rawMap = process.env.CONTRACT_ENC_KEYS;
  const active = process.env.CONTRACT_ENC_KEY_ACTIVE;

  if (!rawMap || !String(rawMap).trim()) {
    throw new Error('CONTRACT_ENC_KEYS not configured');
  }
  if (!active || !String(active).trim()) {
    throw new Error('CONTRACT_ENC_KEY_ACTIVE not configured');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawMap);
  } catch (_) {
    throw new Error('CONTRACT_ENC_KEYS is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CONTRACT_ENC_KEYS must be a JSON object {version: base64key}');
  }

  const keys = {};
  for (const [ver, b64] of Object.entries(parsed)) {
    if (typeof b64 !== 'string' || !b64.trim()) {
      throw new Error(`CONTRACT_ENC_KEYS["${ver}"] is empty`);
    }
    let buf;
    try {
      buf = Buffer.from(b64, 'base64');
    } catch (_) {
      throw new Error(`CONTRACT_ENC_KEYS["${ver}"] is not valid base64`);
    }
    if (buf.length !== KEY_BYTES) {
      throw new Error(`CONTRACT_ENC_KEYS["${ver}"] must decode to ${KEY_BYTES} bytes (got ${buf.length})`);
    }
    keys[ver] = buf;
  }

  const activeVer = String(active).trim();
  if (!keys[activeVer]) {
    throw new Error(`CONTRACT_ENC_KEY_ACTIVE "${activeVer}" has no matching key in CONTRACT_ENC_KEYS`);
  }

  _cache = { keys, activeVer };
  return _cache;
}

// 테스트 편의: env 를 바꾼 뒤 캐시를 비우고 다시 로드하기 위함.
// (프로덕션 핸들러는 호출하지 않음 — 환경은 프로세스 수명 동안 고정.)
function _resetForTest() {
  _cache = null;
}

// ── 빈값 정책 (ADR 후보) ────────────────────────────────────────────
// "" / 공백만 있는 문자열 → null 로 정규화해 저장한다. 빈 입력과 NULL 을
// 구분 저장할 의미가 없고(둘 다 "값 없음"), 마스킹/계약서에서 동일 취급.
function normalizeEmptyToNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v; // 방어적 — 호출부는 string|null 만 넘김
  return v.trim() === '' ? null : v;
}

// ── 암호화 ──────────────────────────────────────────────────────────
// encryptField(plain: string|null): string|null
//   null / "" → null. 그 외 → "v<ACTIVE>:<iv>.<tag>.<ct>" (base64 각).
function encryptField(plain) {
  const norm = normalizeEmptyToNull(plain);
  if (norm === null) return null;

  const { keys, activeVer } = loadKeys();
  const key = keys[activeVer];

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(norm), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return 'v' + activeVer + ':' +
    iv.toString('base64') + '.' +
    tag.toString('base64') + '.' +
    ct.toString('base64');
}

// ── 복호화 ──────────────────────────────────────────────────────────
// decryptField(enc: string|null): string|null
//   null → null. 형식/버전/태그 이상 → throw.
function decryptField(enc) {
  if (enc === null || enc === undefined) return null;
  if (typeof enc !== 'string') {
    throw new Error('decryptField: expected string|null');
  }

  const colon = enc.indexOf(':');
  if (colon < 0 || enc[0] !== 'v') {
    throw new Error('decryptField: bad format (missing version prefix)');
  }
  const ver = enc.slice(1, colon);
  if (!ver) {
    throw new Error('decryptField: bad format (empty version)');
  }

  const { keys } = loadKeys();
  const key = keys[ver];
  if (!key) {
    throw new Error(`decryptField: unknown key version "${ver}"`);
  }

  const parts = enc.slice(colon + 1).split('.');
  if (parts.length !== 3) {
    throw new Error('decryptField: bad format (expected iv.tag.ct)');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const tag = Buffer.from(parts[1], 'base64');
  const ct = Buffer.from(parts[2], 'base64');
  if (iv.length !== IV_BYTES) {
    throw new Error('decryptField: bad IV length');
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error('decryptField: bad auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // 변조 시 final() 이 throw (GCM 인증 실패).
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// ── 마스킹 헬퍼 (평소 UI 표시용 — 복호 후 서버에서 적용) ─────────────
// maskAccount: 계좌번호 등 — 뒤 4자리만 노출, 나머지는 '*'.
//   "1234567890" → "******7890".  자릿수 보존(길이 정보만 노출).
function maskAccount(s) {
  if (s === null || s === undefined) return null;
  const str = String(s);
  if (str.length === 0) return '';
  if (str.length <= 4) return '*'.repeat(str.length);
  const tail = str.slice(-4);
  return '*'.repeat(str.length - 4) + tail;
}

// maskGeneric: 주소·이름·상호·사업자번호 등 — 앞 일부만 노출하고 나머지 마스킹.
//   길이 ≤ 2 면 전부 '*'. 그 외 앞 1/3(최소1·최대4)만 노출, 나머지 '*'.
//   예) "서울시 강남구 …" → "서울*********".
function maskGeneric(s) {
  if (s === null || s === undefined) return null;
  const str = String(s);
  const len = str.length;
  if (len === 0) return '';
  if (len <= 2) return '*'.repeat(len);
  const reveal = Math.min(4, Math.max(1, Math.floor(len / 3)));
  return str.slice(0, reveal) + '*'.repeat(len - reveal);
}

module.exports = {
  encryptField,
  decryptField,
  maskAccount,
  maskGeneric,
  normalizeEmptyToNull,
  // 내부/테스트용 (프로덕션 핸들러는 사용 안 함)
  _loadKeys: loadKeys,
  _resetForTest,
};
