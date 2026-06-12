# HANDOFF — 세션 핸드오버 (라이브 문서 · coaching-log)

> **갱신 룰:** 매 세션 끝, 메인 세션이 전체 덮어쓰기. Git 으로 히스토리 추적.
> **읽는 순서:** 본 파일 → [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md) → [docs/glossary.md](docs/glossary.md) → [docs/AUDIT-2026-06-10.md](docs/AUDIT-2026-06-10.md)

---

## 📍 현재 상태 (2026-06-10)

**Phase:** To-Be 2단계 봉인까지 배포 라이브 → **고도화 착수.** 2026-06-10 종합 감사([AUDIT-2026-06-10](docs/AUDIT-2026-06-10.md)) 완료, 0단계 위생 + 라우팅 수정 완료.

```
✅ 이번 세션 완료 (2026-06-10):
  AUDIT   종합 감사 — 외부 피드백(06-09) 재검증 + UX/필드모델/파이프라인 탐색 3건
  Phase Z coaching_logs.coach_id SoT 복구 마이그레이션 (20260610_phase_z_coach_id_sot.sql)
          ✅ 라이브 적용 완료 (SQL Editor, "Success. No rows returned") + 검증 SQL 통과:
             컬럼 uuid ✓ · 인덱스 신규 생성 ✓ · FK 신규 추가 validated=true(고아 0) ✓ · NULL행 0 ✓
             → 라이브엔 FK·인덱스가 원래 없었음 — 본 마이그레이션이 무결성·성능 실효 추가
  ROUTING 뒤로가기/탭 URL 수정 — pushState 기본화 + #detail/<id> 복원 (B-20260610-routing-history)
          ✅ 배포 후 실브라우저 검증 통과: 탭 3전환→뒤로 2회 복귀 · 상세 #detail/164 진입/복귀
             · 앞으로가기 재진입 · #detail/<id> 새로고침 복원 · 부트 콘솔 에러 0
  ADR     011·013·014·018·019 소급 작성 (docs/decisions/)
  HANDOFF 본 파일 갱신 (06-01 정체 해소)

✅ 1단계 퀵윈 4종 완료·배포·실브라우저 검증 (2026-06-10 오후, 브리프 Q1~Q4 → _archive):
  Q1  draft 자동저장 — localStorage debounce 1초 + 복원 배너. 라이브 검증: 입력→저장→
      새로고침→배너→[복원] 필드 회복 확인. 후속 핫픽스: #form 해시 직접 복원 경로 배너 평가 (98a55bb)
  Q3  Phase AA extraction_model/version — 마이그레이션 라이브 적용·검증(2컬럼 text).
      메모 추출 시 model=gemini-2.5-pro·ver=2026-06-10.2 프론트 상태 보관 확인
  Q2  메모 모드(20자↑, inputMode=memo, 프롬프트 분기) — 라이브 32자 메모 추출 성공:
      "메모 모드로 분석 중…"→2문장 내러티브·근거 기반 필드·환각 0. EXTRACTION_VERSION 2026-06-10.2
      +보너스: 라이브 폼의 i18n 리터럴 키 노출 12건(stt_*·narrative_*·checkin_*) 발견 → ko/en/ja 보강
  Q4  체크인 예정 카드 — 대시보드 picker+타임라인 양쪽. 라이브 검증: UCA프로젝트 D+19·D+5
      2건 정상 렌더, 클릭→#detail 이동

✅ 1.5단계 보안 소소 (S1, 2026-06-10 저녁): error.message escape 4곳(전수 grep 0건) ·
   edit/delete 진입 가드(본인/admin) · escape 4중 정의 단일화(escAttr 위임, AGENTS.md 규칙 명문화)
   · i18n 전수 점검(누락 0 확인). 배포·라이브 확인 완료.
✅ 2단계 필드 정의 중앙화 (M1, ADR-020): public/field-defs.js UMD 공유 모듈 — 브라우저
   <script src> + API require() 단일 소스. 프롬프트 문자단위 동일 증명(버전 2026-06-10.2 유지),
   프론트 맵 deep-equal, 배포 후 실추출 200 확인 (서버리스 번들 포함 검증됨).
   ⚠️ field-defs.js 의 valueRule 수정 = 프롬프트 변경 → EXTRACTION_VERSION 범프 의무.

✅ R1 2시간 녹음 (ADR-021, 2026-06-10 밤): 5분 청크 분할 전사(flash·thinking 0) →
   텍스트 누적 → 기존 text 추출(pro). 110분 경고/120분 자동종료, 실패 청크 재전사,
   vercel.json maxDuration 300 (배포 통과 확인). 검증: 구/신 4경로 바이트 동일 회귀 0 ·
   상태머신 시뮬 17/17 · 배포 후 오실레이터 webm 으로 인증 전사 E2E 200.
   ⚠️ 잔여: 실제 마이크 녹음 1회(1청크) + 5분 경계 넘는 녹음 1회 — 사용자 확인 필요.
   ⚠️ 동시성: Gemini 무료 티어면 동시 ~10명·~10세션/일 (flash 10 RPM·250 RPD 병목).
      유료 Tier 1 이면 동시 100명+. 확장 전 키 티어 확인/전환 필요 (ADR-021 §동시성).

📌 다음 (우선순위):
  3   템플릿 — 사용자 결정(2026-06-10): 프로젝트별 커스터마이징이 아니라 **어드민이
      템플릿 라이브러리를 늘려가는 방향**. 후순위로 보류. 착수 시 설계 ADR 필요.
      잔여 하드코딩 참고: gatherFormData · applyExtractedFields setText · hydrateFormFromRecord
  4   ADR 필요 결정: RAG/embedding 거취 · 죽은 컬럼 11개 처분 · 문서 드리프트 잔여
      (README 死파일 참조, phase4e OpenAI 주석 — CLAUDE.md 는 06-10 정정됨)
```

**최근 ADR:** 011·013·014·018·019 (소급, 06-10). ADR-004(captcha) 는 여전히 미작성·대기.
**감사:** [docs/AUDIT-2026-06-10.md](docs/AUDIT-2026-06-10.md) (최신) · [docs/AUDIT-2026-06-01.md](docs/AUDIT-2026-06-01.md)
**공유 계약 (본 레포 원본):** [docs/contracts/coaches-directory.md](docs/contracts/coaches-directory.md)

---

## 활성 브리프
| 브리프 | 상태 |
|--------|------|
| B-20260610-coach-id-sot | ✅ 완료 → _archive |
| B-20260610-routing-history | ✅ 완료 → _archive (실브라우저 확인 잔여) |

---

## 함정 / 알아둘 것

1. 프론트 = **바닐라 JS 단일 `public/index.html` 9,330줄** (06-10 기준 — 문서 곳곳의 12,090줄은 stale). 빌드 없음. `escHtml` 의무.
2. **본 레포가 Supabase 스키마 SoT** (`supabase/migrations/` 37파일). 적용된 파일 수정 금지 — 새 파일만.
   ⚠️ **재현성 한계:** 빈 DB 시간순 재생은 phase4a(coach_id 참조)가 Phase Z(coach_id 추가)보다 먼저라 실패 — Phase Z 헤더 주석 참조.
3. 역할 = `admin`/`pm`/`coach`. RLS = 진짜 보안 경계, UI 체크는 보조.
4. 빌드/lint/tsc 없음 — 검증 = 엔드포인트 호출 / SQL / 브라우저 / RLS 매트릭스. (CLAUDE.md 의 "node server.js" 지침은 stale — server.js 는 삭제됨)
5. 메인은 **코드 직접 구현 금지** — 전부 브리프 → 서브 에이전트.
6. To-Be 봉인 후: 프로젝트는 coach-finder 수주(bp_on_won)에서만 생성. coaching-log 의 BP/프로젝트 직접생성/코치쓰기 없음 (ADR-019).
7. 라우팅(06-10 이후): `switchView` 는 pushState 기본. 게이트 리다이렉트·부트 초기화는 `{ replaceHistory: true }`. 상세는 `#detail/<id>`.

---

## 사용자 강조 5원칙
1. ✅ 구체적 작업지시  2. ✅ 제대로 검증  3. ✅ 투명한 보고  4. ✅ 모든 기록 보존  5. ✅ 용어/스키마 일관성

---

## 다음 세션 진입 한 줄

> **R1 실녹음 확인(마이크 1청크 + 5분 경계) → Gemini 키 티어 확인 → 템플릿(어드민 라이브러리 방향)은 보류 중, 사용자 신호 대기. (0~2단계 + R1 전부 배포·검증 완료)**
