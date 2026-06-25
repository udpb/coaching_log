# Brief XLSX2 — 엑셀 헤더를 폼 라벨과 일치 + 날짜순 정렬

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` 필독.

| ID | `XLSX2-form-label-headers-and-sort` · 2026-06-25 · P2 |

## 🎯 Mission
`downloadXlsx()` 의 ① **헤더를 "새 세션 작성 폼"의 필드 라벨과 100% 일치**(폼 i18n 키를 `t()`로) ② **데이터 행을 날짜(date) 오름차순** 정렬.

## 📋 Context
- `downloadXlsx()` (~L5416): 현재 헤더는 `HEADER_KO`(임의 한글맵, L5440~5448)로 표시, 행은 `for (const r of logs)` 순서(=created_at 생성순). 컬럼 트리밍(excludeKeys + `!startsWith('metric_')`)은 유지.
- 폼 라벨은 i18n `t(key)` 로 렌더됨(예: `t('what_to_do')`='무엇을'). export 컬럼 ↔ 폼 i18n 키 매핑은 아래 표.
- `t(key)` 헬퍼는 현재 언어의 라벨 반환(기존 함수, 재사용).

## 🎯 Scope
### CAN touch
- `public/index.html` — `downloadXlsx()` 내부만 (헤더 라벨 소스 교체 + 행 정렬 추가).
### MUST NOT touch
- 컬럼 트리밍 규칙 · 데이터 셀 조회(`r[k]` 영문 키) · 시트명/파일명 · 굵게 스타일 · 다른 함수 · 전역 `logs`(복사본 정렬, in-place 금지).

## 🛠 Tasks
1. **헤더 = 폼 라벨**: `HEADER_KO` 를 **export키 → 폼 i18n 키** 맵으로 교체하고 `headerLabel(k)=t(formKey)` 로:
   ```js
   const HEADER_FORMKEY = {
     date:'date', coach:'coach', team_name:'team_name', founder_name:'founder_name',
     session_type:'session_type', session_num:'session_num', stage:'impact_stage', stage_detail:'stage_detail',
     main_topic:'main_topic', last_commitment:'last_commitment', last_done:'done_status', last_result:'what_learned',
     real_issue:'real_issue', blocker_type:'blocker_type', ai_used:'ai_used',
     next_action:'what_to_do', next_deadline:'when_deadline', next_evidence:'evidence',
     next_checkin:'checkin_memo', session_note:'one_line_summary', watch_next:'must_check_next'
   };
   const headerLabel = (k) => { const fk = HEADER_FORMKEY[k]; return fk ? t(fk) : k; };
   ```
   - 헤더 행: `allKeys.map(headerLabel)` (이미 그렇게 쓰는 중이면 맵만 교체). 열너비 maxLen 시드도 `headerLabel(key).length` 유지.
   - ⚠️ 위 폼 키들이 실제 i18n `ko` 사전에 존재하는지 확인(Explore 기준: date·coach·team_name·founder_name·session_type·session_num·impact_stage·stage_detail·main_topic·last_commitment·done_status·what_learned·real_issue·blocker_type·ai_used·what_to_do·when_deadline·evidence·checkin_memo·one_line_summary·must_check_next). 없는 키 있으면 그 컬럼만 기존 한글/키 폴백 + "위험 신호"에 보고.
2. **날짜순 정렬**: 행 빌드 전에 `logs` **복사본**을 date 오름차순 정렬해서 사용:
   ```js
   const rows = [...logs].sort((a,b)=> String(a.date||'').localeCompare(String(b.date||'')));
   ```
   그리고 `for (const r of rows) aoa.push(...)` (전역 `logs` in-place 정렬 금지).

## 🔒 Constraints
- 바닐라 JS. 엑셀 셀은 HTML sink 아님(escape 불필요). 새 전역/라이브러리 금지. `t()` 재사용.

## ✔️ DoD
- [ ] 엑셀 헤더가 작성 폼 라벨과 동일(`무엇을`·`언제까지`·`AI를 활용했음`·`무엇을 배웠나` 등). 데이터는 영문 키로 정상 조회.
- [ ] 데이터 행 = date 오름차순(여러 팀이 날짜순으로). 전역 logs 순서 불변.
- [ ] 인라인 `<script>` `node --check` 통과. 변경 = downloadXlsx 내부 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check + i18n키 존재확인)/위험

## 🚫 Do NOT
- 컬럼 트리밍 변경 · 전역 logs in-place 정렬 · 다른 함수 터치 · `--no-verify`.
