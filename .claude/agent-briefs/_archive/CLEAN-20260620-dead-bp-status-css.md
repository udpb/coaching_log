# 브리프 CLEAN-20260620-dead-bp-status-css — 사용 안 되는 사업 status 배지 CSS 제거

## 배경 (Why)
AUDIT-2026-06-20 ⓑ 발견. coaching-log 는 사업(business_plan) status 배지를 **렌더하지 않는다**
(그건 coach-finder UI). public/index.html 의 `.bp-status-*` 색상 변형과 `.bp-trans-*` 버튼 변형
CSS 가 **정의만 있고 마크업 할당 0** 인 dead CSS. 게다가 변형 이름이 구 status 어휘(draft/proposed/
won/lost — ADR-023 폐지)라 혼선만 준다. 사용자 승인(2026-06-20) → 제거.

## 산출물 (CAN touch — 이 1개 파일만)
- `public/index.html` — dead CSS 선택자 제거 (CSS `<style>` 블록만, JS 본문 무관)

## 스펙 — 제거 대상 (각 선택자 **마크업 참조 0 재확인 후** 제거)
현재 라인(±이동 가능, 패턴으로 찾을 것):
1. `.bp-status-draft` / `.bp-status-proposed` / `.bp-status-won` / `.bp-status-lost` /
   `.bp-status-cancelled` 색상 변형 5줄 (~1290-1294).
2. `.bp-detail-trans button.bp-trans-won { … }` 블록 + `.bp-trans-won:hover` +
   `.bp-detail-trans button.bp-trans-lost, .bp-detail-trans button.bp-trans-cancelled { … }` 블록 (~1362-1369).
3. **베이스 `.bp-status` 배지 클래스**(~1281-1289, font-size/padding/uppercase 등) — **마크업에서
   `bp-status` 가 단 한 번도 안 쓰이면** 함께 제거. 한 곳이라도 쓰이면 베이스는 남길 것.

## 검증 절차 (제거 전 필수)
- 각 클래스에 대해 `class="...bp-status..."` · `className` · 템플릿 문자열(`bp-status`/`bp-trans`)
  할당을 grep. **할당 0 인 것만 제거.** (현재 `bp-status-`/`bp-trans-` grep 총 9건이 전부 CSS
  정의부였음 — 재확인하라.)
- ⚠️ **남길 것 (사용 중):** `.bp-empty*` · `.bp-detail-wrap/back/head/title/client/actions/grid/card*`
  · `.bp-detail-trans`(컨테이너) · `.bp-detail-trans button`(베이스) · `.bp-detail-trans button:hover`
  · `.bp-coach-list` 등 그 외 모든 `.bp-*`. **오직 status 색상 변형 + trans 색상 변형 + (미사용 시)
  bp-status 베이스만** 제거.

## MUST NOT
- 위 1파일 외 변경 금지. JS 본문·기능 변경 금지. 사용 중인 `.bp-*` 선택자 제거 금지.
- git 금지(메인이 커밋). `--no-verify` 금지.

## 검증 (증거 첨부)
- 제거 후 `grep -n "bp-status\|bp-trans" public/index.html` 결과 첨부 — 남은 게 있으면 그게
  "사용 중이라 남긴 것"임을 설명.
- 제거한 정확한 선택자 목록 + 각 "마크업 참조 0" 근거(grep 결과).
- 인라인 스크립트 무관(CSS만)이나, 혹시 실수로 JS/마크업 건드렸는지 `git diff` 로 확인.
- `git diff --stat` (1파일, CSS 라인만 삭제) 첨부.

## Return Format (5섹션 필수)
한 일(제거 선택자:라인) / 못한 일 / 결정 / 검증(grep 근거) / 위험 신호.
