// ─────────────────────────────────────────────────────────────────────
// backfill-contract-enc.mjs — coach_contract_info 평문 6필드 → *_enc 백필
// ADR-024 (2026-06-25) · Brief ENC4.
//
// 목적:
//   ENC1 로 *_enc 컬럼만 생기고 ENC2/ENC3 로 신규 쓰기는 암호화된다. 그러나
//   기존 행은 평문만 있다. ENC5(평문 컬럼 제거) 전에 이 일회용 오프라인
//   스크립트로 모든 기존 행의 평문을 암호화해 *_enc 에 채운다(데이터 손실 방지).
//
//   - 멱등: 이미 채워진 *_enc 는 skip. 재실행해도 추가 변경 0.
//   - 롤백 안전: 평문 컬럼은 읽기만(삭제/변경 X). 잘못되면 *_enc 만 비우고 재실행.
//
// 실행 (운영자가 service-role 키로 1회):
//   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  \
//   CONTRACT_ENC_KEYS='{"1":"<base64 32B>"}'  CONTRACT_ENC_KEY_ACTIVE=1  \
//   node scripts/backfill-contract-enc.mjs [--dry-run] [--reencrypt]
//
// 옵션:
//   --dry-run    쓰기 없이 대상 수만 카운트/보고.
//   --reencrypt  로테이션 모드. *_enc 가 이미 있어도 그 v<N> 버전이 ACTIVE 보다
//                낮으면 복호 → ACTIVE 키로 재암호화(키 로테이션 후 옛 데이터 갱신).
//
// 보안 (ADR-024 / AGENTS.md):
//   - service-role 키는 RLS 우회(전체 행 읽기)를 위해 이 오프라인 스크립트에서만
//     사용. 절대 배포/커밋/클라 노출 금지. env 에서만 읽고 절대 로그하지 않음.
//   - 평문/키 값을 로그에 출력하지 않음(행 id 만 출력).
//   - 외부 의존성: @supabase/supabase-js (이미 사용 중) 외 추가 없음.
//     암호 유틸은 CommonJS api/_lib/contractCrypto.js 를 createRequire 로 재사용
//     (ENC2/ENC3 와 동일 형식/키 보장).
// ─────────────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// CommonJS 모듈(contractCrypto.js)을 ESM 에서 동일 형식으로 재사용.
const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const {
  encryptField,
  decryptField,
  _loadKeys,
} = require(join(__dirname, '..', 'api', '_lib', 'contractCrypto.js'));

// PK + ENC2/contract-info.js 와 동일한 민감 6필드. *_enc 컬럼 매핑.
const PK_COLUMN = 'coach_directory_id';
const SENSITIVE_FIELDS = [
  'address',
  'bank_name',
  'account_number',
  'account_holder',
  'business_number',
  'business_name',
];

const TABLE = 'coach_contract_info';

// ── 인자 파싱 ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const REENCRYPT = argv.includes('--reencrypt');
const unknown = argv.filter((a) => a !== '--dry-run' && a !== '--reencrypt');
if (unknown.length) {
  console.error(`알 수 없는 인자: ${unknown.join(', ')}`);
  console.error('사용법: node scripts/backfill-contract-enc.mjs [--dry-run] [--reencrypt]');
  process.exit(2);
}

// ── env 검증 ─────────────────────────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    console.error(`환경변수 ${name} 가 필요합니다 (설정되지 않음).`);
    process.exit(1);
  }
  return v;
}

// 암호문 헤더 v<N>: 의 버전을 파싱. 형식 이상이면 null.
function encVersion(enc) {
  if (typeof enc !== 'string') return null;
  if (enc[0] !== 'v') return null;
  const colon = enc.indexOf(':');
  if (colon < 0) return null;
  const ver = enc.slice(1, colon);
  return ver || null;
}

async function main() {
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SERVICE_ROLE = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  // 키 설정 즉시 검증(없거나 ACTIVE 불일치면 명확한 Error 로 종료).
  // _loadKeys 는 CONTRACT_ENC_KEYS / CONTRACT_ENC_KEY_ACTIVE 를 읽어 검증한다.
  let activeVer;
  try {
    activeVer = _loadKeys().activeVer;
  } catch (e) {
    console.error(`키 설정 오류: ${e.message}`);
    console.error('CONTRACT_ENC_KEYS / CONTRACT_ENC_KEY_ACTIVE 를 ENC2/ENC3 와 동일하게 설정하세요.');
    process.exit(1);
  }

  console.log('─'.repeat(60));
  console.log(`ENC4 백필 — ${TABLE}`);
  console.log(`모드: ${DRY_RUN ? 'DRY-RUN (쓰기 없음)' : '실행 (쓰기)'}` +
    `${REENCRYPT ? ' · REENCRYPT (로테이션)' : ''}`);
  console.log(`ACTIVE 키 버전: v${activeVer}`);
  console.log('─'.repeat(60));

  // service-role 클라 — RLS 우회로 전체 행 읽기/쓰기. 세션/자동갱신 비활성.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 전체 행 조회. 행 수가 적을 것(코치 수준)이나 안전하게 페이지네이션.
  const PAGE = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order(PK_COLUMN, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`행 조회 실패: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`총 ${rows.length} 행 조회됨.\n`);

  let processedRows = 0;   // 1개 이상 필드를 갱신(또는 dry-run 대상)한 행
  let updatedFields = 0;   // 실제(또는 dry-run 예정) 암호화한 필드 수
  let skippedFields = 0;   // 이미 채워졌거나 평문 null 이라 건너뛴 필드 수
  let failedRows = 0;

  for (const row of rows) {
    const rowId = row[PK_COLUMN];
    const patch = {};      // 변경된 *_enc 컬럼만 담는다(평문 컬럼은 절대 X)
    let rowChanged = false;

    try {
      for (const field of SENSITIVE_FIELDS) {
        const encCol = `${field}_enc`;
        const plain = row[field];
        const existingEnc = row[encCol];

        if (existingEnc != null) {
          // 이미 암호문 있음 → 평시엔 멱등 skip.
          if (REENCRYPT) {
            const ver = encVersion(existingEnc);
            // 버전이 ACTIVE 와 같거나(이미 최신) 알 수 없으면 그대로 둠.
            // 숫자 비교로 "더 낮은 버전"만 재암호화.
            if (ver !== null && Number(ver) < Number(activeVer)) {
              const decrypted = decryptField(existingEnc); // 옛 키로 복호
              patch[encCol] = encryptField(decrypted);     // ACTIVE 키로 재암호화
              rowChanged = true;
              updatedFields++;
              continue;
            }
          }
          skippedFields++;
          continue;
        }

        // 암호문 없음. 평문이 있으면(빈문자/공백은 contractCrypto 가 null 정규화)
        // 암호화해 채운다. encryptField 가 null/"" → null 반환.
        const enc = encryptField(plain);
        if (enc === null) {
          // 평문이 null/빈값 → 암호화할 것 없음 → skip(멱등).
          skippedFields++;
          continue;
        }
        patch[encCol] = enc;
        rowChanged = true;
        updatedFields++;
      }

      if (!rowChanged) continue;
      processedRows++;

      if (DRY_RUN) {
        console.log(`[dry-run] ${rowId}: ${Object.keys(patch).join(', ')} 갱신 예정`);
        continue;
      }

      // 변경된 *_enc 컬럼만 UPDATE. 평문 컬럼은 patch 에 없으므로 무손상.
      const { error: upErr } = await supabase
        .from(TABLE)
        .update(patch)
        .eq(PK_COLUMN, rowId);
      if (upErr) {
        failedRows++;
        processedRows--; // 실패는 처리 카운트에서 제외
        console.error(`[실패] row ${rowId}: ${upErr.message}`);
        continue;
      }
      console.log(`[갱신] ${rowId}: ${Object.keys(patch).join(', ')}`);
    } catch (e) {
      failedRows++;
      // 행 단위 실패는 id 만 출력하고 계속(평문/키 값 미로그).
      console.error(`[실패] row ${rowId}: ${e.message}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`결과 (${DRY_RUN ? 'DRY-RUN' : '실행'})`);
  console.log(`  처리된 행(갱신/예정): ${processedRows}`);
  console.log(`  암호화 필드(갱신/예정): ${updatedFields}`);
  console.log(`  스킵 필드(이미 암호화/평문없음): ${skippedFields}`);
  console.log(`  실패 행: ${failedRows}`);
  console.log('─'.repeat(60));
  if (DRY_RUN) {
    console.log('DRY-RUN — 쓰기 없음. 실제 백필은 --dry-run 없이 재실행.');
  }

  // 실패가 있으면 비정상 종료코드(운영자가 인지).
  process.exit(failedRows > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`치명적 오류: ${e.message}`);
  process.exit(1);
});
