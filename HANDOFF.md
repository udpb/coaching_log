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
          ⚠️ 파일만 작성됨 — 라이브 적용(멱등·no-op 예상) + 검증 SQL 실행 필요
  ROUTING 뒤로가기/탭 URL 수정 — pushState 기본화 + #detail/<id> 복원 (B-20260610-routing-history)
          ⚠️ node --check 통과·코드경로 검증 완료, 실브라우저 시나리오 (a)(b)(d) 확인 권장
  ADR     011·013·014·018·019 소급 작성 (docs/decisions/)
  HANDOFF 본 파일 갱신 (06-01 정체 해소)

📌 다음 (우선순위 — AUDIT-2026-06-10 §4):
  1   퀵윈: draft 자동저장(localStorage) · 메모 모드(50자 완화+프롬프트 분기)
      · extraction_version/model DB 기록 · "오늘 체크인할 팀" 뷰 (next_checkin_date 활용)
  1.5 error.message escape 4곳 · editRecord/deleteRecord 진입 가드 · escape 함수 단일화
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

> **Phase Z 라이브 적용+검증 SQL 확인 → 라우팅 실브라우저 시나리오 확인 → 퀵윈 4종(draft 자동저장·메모 모드·extraction_version·체크인 뷰) 브리프 작성 → 위임.**
