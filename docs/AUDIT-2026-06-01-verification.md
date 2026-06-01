# 독립 재검증 + 전체 실행 백로그 — 2026-06-01 (v2)

> **목적:** 오늘자 1차 감사(`docs/AUDIT-2026-06-01.md`)와 이전 세션의 "완료" 보고를 **코드와 직접 대조해 재검증**하고, "다 진행"하기 위한 **단일 실행 백로그**를 남긴다.
> **검증 방식:** 4개 서브 에이전트가 두 레포를 영역별(프론트 / 백엔드·보안 / coaching-log / 공유DB·문서)로 정독 + 메인이 보안 핵심 파일 직접 재확인.
> **기록 보존:** 1차 감사 원문은 수정하지 않는다. 본 문서가 그 위의 **정정·재검증 레이어**다. coach-finder 레포에도 동일 사본 존재(원본).
> **대상:** coach-finder · coaching-log · 공유 Supabase. ud-ops 는 디스크 부재 → UNVERIFIABLE 표기.

---

## 0. 한 줄 결론

1차본의 골격(인증 핸드셰이크 · RLS 설계 · AI 추출 파이프라인)은 전문가급. **그러나 coach-finder 측 "보안 P0 전부 완료"는 사실이 아니다** — `/api/coaches` **PII 노출이 아직 라이브**(주석은 거짓 "고쳤다"). coaching-log 자체는 1차 감사 프레이밍보다 양호(死 deps·死 GEMINI_KEY 등은 이미 없거나 실재 안 했음). 단 **위험한 死 DDL 함수**와 `.or()` 필터 인젝션, 문서 drift 잔존.

---

## 1. ⛔ 이전 세션 "완료" 보고 정정

| 이전 보고 | 실제 | 근거 |
|---|---|---|
| ✅ "보안 P0 **전부**" 완료 | ❌ 과장 (coach-finder) | extract-session 인증은 진짜 됨. 그러나 coach-finder `/api/coaches` PII 마스킹 미구현·라이브, CORS A2 미적용 |
| ✅ 死 `GEMINI_KEY` 제거 | ⚠️ 실재 안 함 | `GEMINI_KEY=''` grep 0건 — 1차 감사 오탐. (live `GEMINI_KEY` 는 `tools/embed-coaches.js:26` 에 정상 존재) |
| ✅ 死코드/死 deps 제거 | ✅ 사실 | `server.js`·`lib/*` 파일 부재, devDep = supabase 하나뿐 확인 |
| ✅ 문서 정정 (README·HANDOVER) | 🟨 부분 | 모델명·마이그레이션29 일부 반영. 단 `README.md:41,79` 없는 `match-coaches`·`lib/`·`server.js` 참조 잔존, `ARCHITECTURE.md` "Gemini 3.1 Pro" 오기 잔존 |
| ✅ Phase J 드리프트 복구 | ✅ 정확 | 적용·검증 기록 일치 |
| 🟨 SEC2 페이로드 상한 | ✅ 정확 | phase_r CHECK 적용 확인. anti-spam(captcha) 잔존 |
| "평가 Gap 3 = 두 앱 **다른 스키마**" | ❌ 틀림 | DB 단일 스키마, 양 앱 동일 6컬럼 기록(`index.html:10813,10985-10988` vs coach-finder `ProjectContext.tsx:864-875`). glossary:66 동일 오류 |

---

## 2. ✅ 진짜로 검증된 "완료" (coaching-log)

- **`extract-session.js` 인증 + CORS allowlist** — `verifyAuth` 100-118, Gemini 비용 전 차단 137-140, CORS allowlist 123-132. 라이브 401 확인.
- **3-pass Gemini 프롬프트(493-591) + 잘림복구 파서(629-696) + Pro→Flash 폴백(41-89)** — 고품질, 유지.
- **`escHtml`/`escAttr` 87개 innerHTML sink 일관 적용** — 스토어드 XSS 미발견.
- **`coach_applications` RLS + phase_j/phase_r 적용·검증.**
- **마이그레이션 idempotent + `SECURITY DEFINER` RLS 헬퍼** — 15개 테이블 전부 RLS ENABLE.
- **死 deps/server.js/lib 제거** 확인.

---

## 3. 🔴 P0 (coach-finder 측 — 본 레포 무관하나 공유 영향)
- `/api/coaches` PII 마스킹(SEC2) · CORS A2 · rate-limit A1 — 상세는 coach-finder AUDIT v2.

## 4. 🟠 P1 (coaching-log)
- **`.or()` 필터 인젝션** `public/index.html:11403` — 사용자 `query` raw 보간(`name.ilike.%${query}%,...`). `,()*` 스트립. RLS 가 행 가시성은 막지만 정정 권장. **(신규)**
- **위험한 死 DDL 삭제** `index.html:5159-5197` `getCreateTableSQL()` — 실 RLS 와 정반대인 `CREATE POLICY "Allow all access" USING(true)` 반환. console.log(5149)만 호출. 즉시 삭제.
- **공유:** S2 CI 일치검사 · S4 `created_by IS NULL` 백필(phase_d3 진단쿼리 활용) · S1 `bp_on_won` 비로그인 코치 누락(`20260428_phase5b:128-135`).

## 5. 🟡 P2 (coaching-log)
- 문서 정정: `README.md:41,79`(없는 파일/엔드포인트 참조) · `ARCHITECTURE.md` "Gemini 3.1 Pro" → 2.5 Pro · 마이그레이션 `phase4e:11-13` "OpenAI text-embedding-3-small" 주석 → Gemini 1536(차원 정확).
- anon `coach_applications` rate-limit/captcha (ADR-004).
- 4× `${error.message}` 미escape innerHTML(7970·8113·8157·8208) → `escHtml` 일관 적용.

## 6. 대형 / 결정
- **H1: `public/index.html` 12,095줄 모듈화** — `<script type="module">` 분리, `renderBPDetailBody`(940줄)부터. ADR 게이트.
- 평가 통합(Gap 3 정정 선행) / 평가→tier 자동 트리거(Gap 4) / 코치 사진 Firebase→Supabase 이전.
- 테스트 0건 → auth 401 smoke + RLS role 매트릭스 우선.

---

## 7. 진행 순서
1. **즉시 삭제:** 위험 死 DDL(`getCreateTableSQL`).
2. **보안:** `.or()` 인젝션 정정 + (coach-finder 와 협응) anon rate-limit.
3. **문서 정정:** README · ARCHITECTURE · glossary:66 · phase4e 주석.
4. **구조:** S2 CI · S4 백필 · S1 문서화.
5. **대형:** index.html 모듈화(H1).

> 각 항목 브리프 → 서브 에이전트 → 메인 검증(엔드포인트/SQL/RLS 매트릭스, 빌드 없음) → 5섹션 보고. 적용된 마이그레이션 수정 금지(새 파일만).
