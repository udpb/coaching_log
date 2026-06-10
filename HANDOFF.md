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

📌 다음 (우선순위 — AUDIT-2026-06-10 §4):
  1.5 error.message escape 4곳 · editRecord/deleteRecord 진입 가드 · escape 함수 단일화
      · (신규) i18n 사전 부재 키 전수 점검 — 12건은 보강했으나 다른 뷰에 잔존 가능
  2   필드 메타데이터 중앙화 (22필드 5곳 하드코딩 → 단일 config) — 템플릿화 선행조건
  3   프로젝트별 템플릿 (projects.template_config — 코어 고정 + 섹션 토글 + 커스텀 jsonb)
  4   ADR 필요 결정: RAG/embedding 거취 · 죽은 컬럼 11개 처분 · 문서 드리프트 일괄 정정
      (CLAUDE.md 줄수/마이그레이션 수/데드레이어/검증지침, README 死파일, phase4e "OpenAI" 주석)
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

> **1.5단계 보안 소소(escape 4곳·진입 가드·escape 단일화·i18n 잔여 키) 브리프 → 위임, 또는 2단계 필드 메타데이터 중앙화 설계 착수. (0단계 위생 + 1단계 퀵윈 4종 전부 배포·라이브 검증 완료)**
