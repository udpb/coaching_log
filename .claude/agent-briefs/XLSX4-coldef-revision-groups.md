# Brief XLSX4 — 엑셀 COLDEF 개정 (그룹 말머리·컬럼 추가·완료여부 값)

> 자급자족 브리프. `../../AGENTS.md` 필독.

| ID | `XLSX4-coldef-revision-groups` · 2026-06-25 · P1 · 의존: XLSX3 후 |

## 🎯 Mission
`downloadXlsx()` 의 `COLDEF` 를 아래 **24열 정의로 교체**하고, `last_done` **값 변환(완료/부분 완료/미완료)** 추가. 그 외(헤더 빌드·정렬·너비·스타일·기존 값변환)는 유지.

## 📋 Context
- 현재 `downloadXlsx()`(~L5454~): `COLDEF`(22열, XLSX3) + `headerLabel(c)=c.prefix?(prefix+' - '+t(fk)):t(fk)` + `cellFor(c,r)`(sessionType/aiUsed/checkinChannel/else cellStr) + 날짜 **내림차순** 정렬.
- 추가 i18n(존재 확인됨, ko): `result_numbers`='결과 숫자', `checkin_date`='체크인 날짜', `done_yes`='완료'·`done_partial`='부분 완료'·`done_no`='미완료'.
- DB 값: `last_done` ∈ {done, partial, not_done, ''}; `last_number`(텍스트, 데이터 있음); `next_checkin_date`(날짜, 데이터 있음).

## 🎯 Scope
### CAN touch
- `public/index.html` — `downloadXlsx()` 내부의 `COLDEF` 배열 + `cellFor`(doneStatus 분기 + `DONE_I18N` 맵) 만.
### MUST NOT touch
- headerLabel 로직·정렬(내림차순 유지)·너비/스타일·다른 값변환(sessionType/aiUsed/checkinChannel)·다른 함수·쿼리·마이그레이션.

## 🛠 Tasks
1. **`COLDEF` 를 아래로 교체** (24열, 이 순서·이 prefix·이 val):
   ```js
   const COLDEF = [
     { k:'date',                 fk:'date' },
     { k:'coach',                fk:'coach' },
     { k:'founder_name',         fk:'founder_name' },
     { k:'team_name',            fk:'team_name' },
     { k:'session_type',         fk:'session_type',      val:'sessionType' },
     { k:'session_num',          fk:'session_num' },
     { k:'stage',                fk:'impact_stage' },
     { k:'stage_detail',         fk:'stage_detail' },
     { k:'main_topic',           fk:'main_topic' },
     { k:'last_commitment',      fk:'last_commitment' },
     { k:'last_done',            fk:'done_status',     prefix:'지난 약속',     val:'doneStatus' },
     { k:'last_number',          fk:'result_numbers',  prefix:'지난 약속' },
     { k:'last_result',          fk:'what_learned',    prefix:'지난 약속' },
     { k:'real_issue',           fk:'real_issue',      prefix:'오늘 파악한 것' },
     { k:'blocker_type',         fk:'blocker_type',    prefix:'오늘 파악한 것' },
     { k:'ai_used',              fk:'ai_used',         prefix:'오늘 파악한 것', val:'aiUsed' },
     { k:'next_action',          fk:'what_to_do',      prefix:'다음 실행 약속' },
     { k:'next_deadline',        fk:'when_deadline',   prefix:'다음 실행 약속' },
     { k:'next_evidence',        fk:'evidence',        prefix:'다음 실행 약속' },
     { k:'next_checkin_date',    fk:'checkin_date',    prefix:'다음 실행 약속' },
     { k:'next_checkin_channel', fk:'checkin_channel', prefix:'다음 실행 약속', val:'checkinChannel' },
     { k:'next_checkin',         fk:'checkin_memo',    prefix:'다음 실행 약속' },
     { k:'session_note',         fk:'one_line_summary', prefix:'코치 메모' },
     { k:'watch_next',           fk:'must_check_next',  prefix:'코치 메모' },
   ];
   ```
2. **`cellFor` 에 doneStatus 분기 추가** (다른 분기 위/아래 무관):
   ```js
   const DONE_I18N = { done:'done_yes', partial:'done_partial', not_done:'done_no' };
   // cellFor 안:
   if (c.val === 'doneStatus'){ const v = r.last_done; return (v && DONE_I18N[v]) ? t(DONE_I18N[v]) : ''; }
   ```
3. 그 외 로직(headerLabel·정렬 내림차순·`ws['!cols']` 너비·헤더 굵게·시트/파일명·빈데이터 토스트) **그대로**. COLDEF.length(24) 기반 루프 자동 반영.

## ✔️ DoD
- [ ] 24열, 순서/헤더가 위 정의대로. 특히: 지난약속 그룹(완료여부·결과숫자·무엇을배웠나) · 오늘 파악한 것(진짜이슈·방해요소·AI) · 다음 실행 약속(무엇을·언제까지·증거결과물·체크인날짜·체크인방식·체크인메모) · 코치 메모(한줄요약·다음에꼭확인).
- [ ] `last_done` 값 = 완료/부분 완료/미완료(''→공란). 기존 sessionType·aiUsed·checkinChannel 변환 유지.
- [ ] 인라인 `<script>` `node --check` 통과. 변경 = COLDEF + cellFor doneStatus 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check + 헤더·값 샘플)/위험

## 🚫 Do NOT
- headerLabel/정렬/너비/다른 함수 변경 · `--no-verify`.

## 💡 Hints
- i18n 키 전부 존재 확인됨(result_numbers·checkin_date·done_yes/partial/no). `t()` 그대로 사용.
- `next_checkin_channel` 도 이제 `prefix:'다음 실행 약속'` (헤더='다음 실행 약속 - 체크인 방식'), 값변환 checkinChannel 유지.
