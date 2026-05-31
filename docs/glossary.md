# 글로서리 — 단일 진실 용어집 (coaching-log)

> 코드 · 문서 · 브리프 · 사용자 가시 라벨 모두 본 파일을 따른다.
> 새 자료 흡수 시: 신규 용어 → 충돌 검사 → 충돌 시 STOP → ADR → 글로서리 → 코드 일괄.
> 작성: 2026-06-01 · 메인 세션 유지.

---

## 작성 / 변경 룰
1. 추가 — 출처 · 사용처 · 한국어 라벨.  2. 변경 — ADR + ~~취소선~~ + "Supersedes".  3. 삭제 — silent 금지.  4. alias 명시, 코드는 표준만.

---

## 1. 제품 · 역할

| 표준 | 한국어 | 비고 |
|------|--------|------|
| **coaching-log** | 코칭 로그 | 코치 세션 기록·성과 추적. **Supabase 스키마 SoT** |
| **coach-finder** | 코치 파인더 | 자매 제품 (PM 섭외 결정). Supabase 공유 |
| **ud-ops** | UD-Ops | 제안서 자동화. `coaches_directory` 소비자 (별도 Neon) |

### 역할 모델 (⚠️ 앱마다 다름)
| 표준 | 범위 | 비고 |
|------|------|------|
| **`admin` / `pm` / `coach`** | 본 제품 + coach-finder (Supabase `profiles.role`) | `handle_new_user()` 가 이메일 도메인으로 자동 부여. admin = `udpb@udimpact.ai`/`udpb@underdogs.co.kr` |
| ~~PM/DIRECTOR/CM/FM/COACH/ADMIN~~ | ud-ops (NextAuth) 전용 | **공유 안 됨** |

---

## 2. 세션 · 로그 (핵심)

| 용어 | 의미 | 비고 |
|------|------|------|
| **coaching_log** | 1회 코칭 세션 기록 행 (`coaching_logs`) | bigint PK. 24필드 (UCA 18 + ACTBot 5 Wave 6) |
| **transcript** | STT 원문 (또는 녹음) | extract 입력 |
| **extract-session** | Gemini 구조화 추출 | 3-pass: 전사 → 내러티브 → 22 구조화 필드 (각 `{value, evidence, confidence}`) |
| **narrative / evidence / confidence** | 내러티브 + 근거 + 신뢰도 | `20260421_phase15` |
| **stage (I/M/P/A/C/T)** | IMPACT 단계 | extract 가 분류 |
| **commitment / next_action / next_checkin** | 커밋먼트·다음 액션·체크인 | 대시보드 추적 |

---

## 3. 사업 · 프로젝트 (⚠️ 함정)

| 용어 | 의미 | 비고 |
|------|------|------|
| **business_plan** | 사업 기획 (coach-finder 가 주 생성) | status 이중 lifecycle |
| **수주 / won** | `business_plans.status='won'` | `bp_on_won` 트리거 → `projects` + `project_members` 자동 생성 (accepted 코치 복사) |
| **project (`projects`)** | 수주 후 코칭 진행 단위 | 본 제품 대시보드의 팀 |
| **project_members** | 프로젝트 배정 (코치/PM) | `is_project_member()` RLS 기준 |

> ⚠️ business_plans.status 두 lifecycle 공존 (draft/proposed/won/lost/cancelled + planning/active/completed). 트리거는 `won` 에서만 발동 → coach-finder 의 planning→active 경로는 미발동 (Gap 2).

---

## 4. RLS

| 헬퍼 (SECURITY DEFINER · 변경 금지) | 의미 |
|------|------|
| `is_admin()` / `is_pm()` / `is_admin_or_pm()` | 역할 판정 |
| `is_project_member()` / `is_pm_of_project()` | 프로젝트 멤버십 (PM 격리 phase_d3 — PM 은 본인/멤버 프로젝트만) |

---

## 5. 공유 계약
- `coaches_directory` 계약 = [docs/contracts/coaches-directory.md](contracts/coaches-directory.md) (**본 레포가 원본**). 변경은 세 앱 동시 + ADR. 임베딩 1536 (Gemini · 주석은 OpenAI 오기 — 정정 대상).
