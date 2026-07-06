// =====================================================================
// coaching_log 계정 비밀번호 복구 — 이메일 없이 처리 (무의존성 · fetch만)
//
// Supabase 기본 메일이 안 올 때, service_role 키로 Admin API 직접 호출:
//   (A) link   — recovery 링크 생성해 콘솔에 출력 (메일 발송 없이)
//   (B) setpw  — 비밀번호 즉시 설정 (메일/링크 전부 생략 — 제일 확실)
//
// 이 레포(coaching_log)의 Supabase 프로젝트 = zwvrtxxgctyyctirntzj
// (public/index.html 의 SUPABASE_URL 과 동일). env 로 덮어쓸 수 있음.
//
// 필요 env:
//   SUPABASE_SERVICE_ROLE_KEY   대시보드 > Project Settings > API > service_role (secret)
//   SUPABASE_URL (선택)         기본값 = https://zwvrtxxgctyyctirntzj.supabase.co
//
// 실행 (Node 18+ · 추가 설치 불필요):
//   node --env-file=.env tools/reset-admin-password.mjs link   udpb@udimpact.ai
//   node --env-file=.env tools/reset-admin-password.mjs setpw  udpb@udimpact.ai '새비밀번호'
//
// ⚠️ service_role 키는 모든 RLS를 우회하는 최상위 권한. .env(로컬)에만 두고
//    커밋/공유 금지(.gitignore 에 .env 포함됨). 사용 후 키 로테이션 권장.
// =====================================================================

const URL = (process.env.SUPABASE_URL || "https://zwvrtxxgctyyctirntzj.supabase.co").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("환경변수 누락: SUPABASE_SERVICE_ROLE_KEY (대시보드 > Project Settings > API > service_role)");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`${URL}/auth/v1${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${body.msg || body.error_description || body.error || text}`);
  }
  return body;
}

async function findUserByEmail(email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const data = await api(`/admin/users?page=${page}&per_page=200`);
    const users = data.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function main() {
  const [mode, email, newPassword] = process.argv.slice(2);
  if (!mode || !email) {
    console.error("사용법: node tools/reset-admin-password.mjs <link|setpw|info> <email> [newPassword]");
    process.exit(1);
  }

  if (mode === "link") {
    // 이메일 발송 없이 recovery 링크를 직접 반환
    const data = await api(`/admin/generate_link`, {
      method: "POST",
      body: JSON.stringify({ type: "recovery", email }),
    });
    const link = data.action_link || data.properties?.action_link;
    console.log("\n✅ recovery 링크 (이 링크 열어서 새 비번 설정):\n");
    console.log(link, "\n");
    console.log("※ 링크의 redirect 는 대시보드 Auth > URL Configuration 설정을 따릅니다.");
    return;
  }

  if (mode === "setpw") {
    if (!newPassword) {
      console.error("setpw 모드는 새 비밀번호가 필요합니다.");
      process.exit(1);
    }
    const user = await findUserByEmail(email);
    if (!user) {
      console.error(`\n사용자 없음: ${email}`);
      console.error("→ 이 프로젝트에 계정이 아직 없다는 뜻. 대시보드 Authentication > Users > Add user 로 생성하세요");
      console.error("  (Auto Confirm 체크 · 이 이메일은 트리거가 자동으로 admin 부여).\n");
      process.exit(1);
    }
    await api(`/admin/users/${user.id}`, {
      method: "PUT",
      // email_confirm:true → 이메일 미확인이면 로그인 거부되는 문제까지 함께 해결
      body: JSON.stringify({ password: newPassword, email_confirm: true }),
    });
    console.log(`\n✅ ${email} (id=${user.id}) 비밀번호 설정 + 이메일 확인 완료. 이제 그 비번으로 로그인하세요.\n`);
    return;
  }

  if (mode === "info") {
    const user = await findUserByEmail(email);
    if (!user) {
      console.error(`\n사용자 없음: ${email} — 이 프로젝트에 계정이 없습니다 (Add user 필요).\n`);
      process.exit(1);
    }
    console.log("\n=== 계정 상태 ===");
    console.log("id                :", user.id);
    console.log("email             :", user.email);
    console.log("email_confirmed_at:", user.email_confirmed_at || "❌ 미확인 (로그인 거부 원인!)");
    console.log("banned_until      :", user.banned_until || "-");
    console.log("last_sign_in_at   :", user.last_sign_in_at || "(로그인 이력 없음)");
    console.log("created_at        :", user.created_at);
    console.log("providers         :", (user.app_metadata?.providers || []).join(", ") || "-");
    console.log("");
    return;
  }

  console.error(`알 수 없는 모드: ${mode} (link | setpw)`);
  process.exit(1);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
