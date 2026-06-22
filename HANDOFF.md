# HANDOFF — 세션 핸드오버 (라이브 문서 · coaching-log)

> **갱신 룰:** 매 세션 끝, 메인 세션이 전체 덮어쓰기. Git 으로 히스토리 추적.
> **읽는 순서:** 본 파일 → [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md) → [docs/glossary.md](docs/glossary.md) → [docs/AUDIT-2026-06-20.md](docs/AUDIT-2026-06-20.md)

---

## 📍 현재 상태 (2026-06-20)

**Phase:** **운영자 핸드오프 정리 완료** (두 제품 coaching-log + coach-finder).
- ADR-023 status 단일 라이프사이클(1~5단계) · K1b(KPI 한국어 추출) · 컬럼버그 전부 배포.
- **ADR-024**: coaches_directory 의 embedding/inferred_skills/roles/ud_programs 는 죽은 게 아니라
  **coach-finder 실사용** → 보존, 소유=coach-finder 문서화(계약 v2). 드롭 안 함.
- **문서 정리**: 양 레포 현행 정본만 표면, 과거 기록은 `docs/history/` 로. PRD-v2(.md/.html) 현행화.
  coach-finder README·PARTNERS(협력사 도메인) 신규.
- **코드 정리**: coaching-log dead CSS 제거. coach-finder const.ts 제거 + 자격증명 .gitignore 보호.
- ⚠️ **보류(의도적)**: `_esc`/`escapeHtml`→`escAttr` 통일은 **회귀 위험으로 보류** — 둘은 `String(s)`
  변환 후 escAttr 호출이라 falsy 값(`0`/`false`)에서 `escAttr` 직접호출과 결과가 다름(`_esc(0)`="0" vs
  `escAttr(0)`=""). 단순 치환 시 대시보드/리포트의 `0` 지표가 빈칸 되는 회귀. 이미 XSS-안전이라 순수 컨벤션
  문제 — 향후 컨텍스트별(텍스트/속성) 정밀 작업 필요.
- 🔷 **사용자 실행 대기**: AUDIT-2026-06-20 §ⓒ 라이브 검증 SQL 5종.

```
✅ 2026-06-15 — 컬럼 버그 · 프로젝트별 KPI · status 단일 라이프사이클:
  B1/B2   "내 참여/배정 사업" 탭 컬럼 버그 — projects 조회가 없는 컬럼(target_start_date·
          joined_at)을 써서 깨지던 것. 실컬럼(start_date·added_at) 별칭 매핑. projects/
          project_members/project_invites 조회 전수 점검(추가 불일치 0). 배포 완료.
  K1a     프로젝트별 필수 KPI (ADR-022 1단계) — projects.required_kpis jsonb(phase_ab 라이브) +
          프로젝트 관리 모달 KPI 편집(admin/pm) + 폼 prefill.
  K1b     KPI 추출 연동 (ADR-022 2단계, 06-20) — 추출 한국어 이름 반환 + required_kpis verbatim
          매칭. 영어 라벨/중복 완전 해결. 3파일(field-defs·extract-session·index.html) 배포.
  ADR-023 사업 status 단일 라이프사이클 (coach-finder=SoT) — 5단계 전부 완료:
    1 트리거 won·active 호환(phase_ac) ✅라이브  ·  2 coach-finder active 저장(별도 레포
      udpb/coach-finder main 배포, ADR-020) ✅  ·  3 데이터 변환 won→active + 연성테스트
      복구(phase_ad) ✅라이브  ·  4 트리거 active 전용 + CHECK 4값 + completed/cancelled→
      projects 동기화(phase_ae) ✅라이브  ·  5 문서 정본화(CLAUDE/AGENTS/glossary) ✅
    어휘: planning(기획)→active(진행중)→completed(종료)/cancelled(취소). won·bp_on_won 폐지.
    트리거: bp_lifecycle_sync_ins/_upd(생성)·bp_status_propagate_upd(동기화). 함수
      handle_business_plan_won()·handle_business_plan_terminal().
    검증(라이브): CHECK 4값 ✓ · 트리거 3개 ✓ · status 전부 active ✓ · 연성테스트
      active_without_project=0(복구됨) ✓.
    ⚠️ 잔여: ① 연성테스트 화면 표시 사용자 확인됨 ② coach-finder status 4파일
      (ProjectContext/ProjectsPage/project.ts/PartnerAssignModal)이 main 에 있음 —
      PM finder 브랜치 머지 시 흡수(충돌 없음 확인).

✅ 데이터 정리 (2026-06-15, 라이브 직접 — 마이그레이션 아님, 일회성 운영):
  - 세션0 고아 projects 8건 삭제 (1·uca4·underdogs test2·중기부[구버전]·풀무원·하이로컬·
    K-Cross 등). 수주된 5건(연성테스트 등)·세션 있는 projects 는 보존. 전체 projects 17→9.
  - 미지정 coaching_logs(project_id NULL) 109건 정리: 완전빈 20건 삭제 + 내용있는 89건
    (부분작성 83 + nar/trans有 6) → UCA프로젝트(91de8cbd…) 이동. 미지정 0.
  - ⚠️ 사용자 직접 SQL 실행 완료(Supabase 대시보드 frozen 으로 메인 브라우저 검증 미완 —
    사용자 "전부 완료" 보고 기준). bp_id NULL 이지만 세션 있는 projects 4건은 잔존(미처리).
    ※ 라이브 직접 DELETE/UPDATE 는 가이드상 비권장 — 향후 데이터 정리는 마이그레이션/백업 선행 권장.

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
   ✅ 동시성 확정 (06-12): Gemini 키 = Tier 2 실측 (flash 2,000 RPM·3M TPM·100k RPD ·
      pro 1,000 RPM·5M TPM·50k RPD) + Vercel Pro → 동시 ~500명·~1,600세션/일.
      사실상 제약 없음 (ADR-021 Addendum 2).
   ✅ 413 핫픽스 (06-12): audioBitsPerSecond 힌트 무시 시 5분 청크가 4.5MB 초과
      → 시간∥용량(2MB) 이중 회전 + 안전판. 배포·라이브 확인. (웹훅 유실 1회 — 빈 커밋 재트리거)
      ⚠️ 잔여: 실녹음 재테스트 (몇 분 연속 발화 — 콘솔 [stt] rotate 로그 확인)

📌 다음 (우선순위):
  ✅ KPI K1b (06-20 완료·배포) — 추출이 지표 이름을 **한국어**로 반환 + required_kpis verbatim 매칭.
      "핵심 숫자 영어 라벨/중복" 완전 해결. 3파일: field-defs.js(metrics valueRule 한국어화) ·
      api/extract-session.js(buildUserPrompt 에 Required KPIs 컨텍스트 주입 + 예시 정정 +
      EXTRACTION_VERSION 2026-06-10.2→2026-06-20.1) · index.html(ctx.required_kpis 전달 +
      병합부 정규화·표시라벨 양면 매칭 → 중복 push 차단). 브리프 _archive/K1b-20260620.
      ⚠️ 배포 후 실측 미완: required_kpis 설정 프로젝트 실추출에서 한국어 이름·중복0 육안 확인 남음.
  ✅ 종합 정리 audit (06-20) — 산출물 **docs/AUDIT-2026-06-20.md** (4차원 병렬조사+메인 교차검증).
      ⓑ 데드코드: 런타임 구 status 어휘 0(깨끗). **dead CSS 제거 완료**(bp-status-*/bp-trans- 23줄,
         CLEAN-20260620). `is_pm_of_project()` 는 **생존**(RLS 6곳 — HANDOFF 구 가설 정정). `_esc` 45곳은
         컨벤션 드리프트(후순위). ⓒ 스키마 **정합·모순0**, 제로베이스 한계는 phase_z 문서화.
      ⓓ 문서 갱신 완료: CLAUDE(38→42·줄수)·README(18→22)·HISTORY(28→42·줄수)·AGENTS(줄수) 수치 정정 +
         HANDOVER/PRD-v2(.md/.html)/INTEGRATED 에 ADR-023 주석 배너(과거 기록 보존).
      ✅ ⓐ **해결(ADR-024)**: embedding(4)·inferred_skills(3)·roles_capable·roles_active_2026·ud_programs
         는 죽은 게 아니라 **coach-finder 실사용**(추천 엔진 RPC·코치 카드 — coach-finder 코드 확인). → **보존**,
         계약문서 v2 에 소유=coach-finder(🔵) 명문화. 드롭/물리분리 안 함(진짜 분리는 핸드오프 후 별건).
      🔷 ⓒ **라이브 검증 SQL 5종**(AUDIT-2026-06-20 §ⓒ) 사용자 Supabase 실행 대기 — 특히 bp없는 projects.
  1   R1 실녹음(마이크 1청크+5분경계) · ADR-004(captcha). (메모모드 영어라벨 → K1b 로 해소됨.)
```

**최근 ADR:** 020(field-defs)·021(2h녹음)·022(KPI)·023(status 단일 라이프사이클, coach-finder=SoT). ADR-004(captcha) 미작성·대기.
**감사:** [docs/AUDIT-2026-06-20.md](docs/AUDIT-2026-06-20.md) (최신·핸드오프) · 과거: [docs/history/AUDIT-2026-06-10.md](docs/history/AUDIT-2026-06-10.md) · [docs/history/AUDIT-2026-06-01.md](docs/history/AUDIT-2026-06-01.md)
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

> **ADR-023 status 단일 라이프사이클 1~5단계 라이브 완료 → 데이터 정리 완료 → KPI K1b(추출 한국어 매칭) 배포 완료 → 다음: 종합 정리 audit(AUDIT-2026-06-15). (status·KPI·컬럼버그 전부 배포. coach-finder=사업 status SoT.)**
