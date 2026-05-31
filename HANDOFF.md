# HANDOFF — 세션 핸드오버 (라이브 문서 · coaching-log)

> **갱신 룰:** 매 세션 끝, 메인 세션이 전체 덮어쓰기. Git 으로 히스토리 추적.
> **읽는 순서:** 본 파일 → [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md) → [docs/glossary.md](docs/glossary.md) → [docs/AUDIT-2026-06-01.md](docs/AUDIT-2026-06-01.md)

---

## 📍 현재 상태 (2026-06-01)

**Phase:** 운영 인프라(ADR-001) + P0/P1 보안·정리 완료 → **배포 라이브** (SEC1 무인증 401 프로덕션 검증). SEC1·SEC2·D1·DOCS·CLEAN 커밋·푸시 완료.

```
✅ 완료·배포 (메인 검증):
  SEC1  extract-session JWT 인증(401) + CORS allowlist + 클라 토큰 + anon 공개 폴백  (ADR-002) — 라이브 401 확인
  SEC2  coach_applications 페이로드 상한 마이그레이션 (phase_r, NOT VALID×10)  (ADR-003)
  D1    공유 coaches_directory 계약 drift 해소 (ud-ops 4컬럼 parity + 계약 포인터)
  DOCS  README/HANDOVER 정정(모델명·extract-session·마이그레이션29) + 死 GEMINI_KEY 제거
  CLEAN 레거시 로컬 스택 제거 (server.js·lib/*·死 deps, 로컬서빙 npx serve)

다음 (대기 — 결정/대형):
  H1    public/index.html 모듈화 착수 (renderBPDetailBody 940줄부터)  [대형]
  CI    coaches_directory 3사본 일치 검사 (재발 방지)  [크로스레포 방식 결정]
  ADR-004 — coach_applications captcha anti-spam (provider 결정 필요)
  데이터: coaching_logs 114건 적재 확인(최근 5/14·저사용). 로그인 happy-path 실사용 확인 권장.
```

**마이그레이션 드리프트 (2026-06-01 · Journey #3) — 해소 중**: Phase J(`coach_applications`) 가 실DB 미적용이었음(coach-finder `/register`·`/applications` 비동작 원인). Phase L 은 적용돼 있었음(coach_contract_info 컬럼).
- ✅ **Phase J 적용·검증 완료** (2026-06-01) — `20260515_phase_j_*.sql` 실행 성공, service-role 로 coach_applications 테이블+컬럼 생성 확인. PostgREST 인식됨 → /register 동작.
- ⏳ **남은 사용자 액션 1건**: SQL Editor 에서 `supabase/migrations/20260601_phase_r_coach_applications_hardening.sql` 실행(SEC2 페이로드 상한 — 이제 테이블 있으니 적용됨). 검증: `select conname from pg_constraint where conrelid='public.coach_applications'::regclass and conname like '%_chk';` → 10개.

**최근 ADR:** [ADR-002](docs/decisions/002-extract-session-auth.md) Accepted.
**최근 Journey:** [2026-06-01 #2](docs/journey/2026-06-01-p0-security-fixes.md).
**감사 백로그:** [docs/AUDIT-2026-06-01.md](docs/AUDIT-2026-06-01.md).
**공유 계약 (본 레포 원본):** [docs/contracts/coaches-directory.md](docs/contracts/coaches-directory.md).

---

## 활성 브리프
| 브리프 | 상태 |
|--------|------|
| (없음 — SEC1 archive 이동 완료) | — |

---

## 함정 / 알아둘 것

1. 프론트 = **바닐라 JS 단일 `public/index.html` 12,090줄.** 빌드 없음. `escHtml` 의무.
2. **본 레포가 Supabase 스키마 SoT** (`supabase/migrations/`). 적용된 마이그레이션 수정 금지 — 새 파일만.
3. 역할 = `admin`/`pm`/`coach`. ud-ops 6역할과 다름.
4. RLS = 진짜 보안 경계. UI 체크는 보조.
5. 빌드/lint/tsc 없음 — 검증 = 엔드포인트 호출 / SQL / 브라우저 / RLS 매트릭스.
6. 메인은 **코드 직접 구현 금지** — 전부 브리프 → 서브 에이전트.

---

## 사용자 강조 5원칙
1. ✅ 구체적 작업지시  2. ✅ 제대로 검증  3. ✅ 투명한 보고  4. ✅ 모든 기록 보존  5. ✅ 용어/스키마 일관성

---

## 다음 세션 진입 한 줄

> **사용자 GO 확인 → SEC1 브리프 작성 → Agent 호출 → 메인이 엔드포인트 호출+`git diff` 검증 → 5섹션 보고 → ADR-002 작성.**
