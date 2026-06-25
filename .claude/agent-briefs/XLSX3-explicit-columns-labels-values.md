# Brief XLSX3 — 엑셀: 명시적 컬럼 순서/말머리 헤더/값 변환

> 자급자족 브리프. `../../AGENTS.md` 필독.

| ID | `XLSX3-explicit-columns-labels-values` · 2026-06-25 · P1 · 의존: XLSX2 후 |

## 🎯 Mission
`downloadXlsx()` 의 컬럼 구성을 **명시적 정의(COLDEF)** 로 교체: ① 순서(대표자↔팀이름 교환, 체크인 방식 추가) ② 그룹 말머리 헤더 ③ 값 변환(세션유형 라벨·ai_used O/X·체크인 방식 라벨). 날짜순 정렬·열너비 자동·헤더 굵게는 유지.

## 📋 Context
- 현재 `downloadXlsx()` (~L5416): `excludeKeys`+`!startsWith('metric_')`로 동적 컬럼 수집(allKeys), `HEADER_FORMKEY`로 헤더, `[...logs].sort(date)`로 행. → 이 동적 수집/HEADER_FORMKEY를 **명시 COLDEF로 대체**.
- 폼 라벨은 `t(key)`. DB 실측: `session_type` ∈ {first, regular, emergency, milestone, graduation, ''}; `next_checkin_channel` ∈ {message, call, video, email, inperson, other, null}; `ai_used` ∈ {true,false}.
- 세션유형 i18n 키: `session_first`='첫 세션'·`session_regular`='정기 코칭'·`session_emergency`='긴급 세션'·`session_milestone`='마일스톤 리뷰'·`session_graduation`='졸업 세션'.

## 🎯 Scope
### CAN touch
- `public/index.html` — `downloadXlsx()` 내부만(컬럼/헤더/값/너비 빌드). `excludeKeys`·`HEADER_FORMKEY`·`allKeys` 로직 제거하고 COLDEF로 대체.
### MUST NOT touch
- 다른 함수·쿼리·마이그레이션·다른 뷰. 시트명/파일명/굵게 스타일/날짜 정렬 동작 유지. `t()`/`cellStr` 재사용.

## 🛠 Tasks
1. **명시적 컬럼 정의** (이 순서·이 헤더):
   ```js
   const COLDEF = [
     { k:'date',                fk:'date' },
     { k:'coach',               fk:'coach' },
     { k:'founder_name',        fk:'founder_name' },   // 3번째 = 대표자
     { k:'team_name',           fk:'team_name' },      // 4번째 = 팀 이름
     { k:'session_type',        fk:'session_type',     val:'sessionType' },
     { k:'session_num',         fk:'session_num' },
     { k:'stage',               fk:'impact_stage' },
     { k:'stage_detail',        fk:'stage_detail' },
     { k:'main_topic',          fk:'main_topic' },
     { k:'last_commitment',     fk:'last_commitment' },
     { k:'last_done',           fk:'done_status',   prefix:'지난 약속' },
     { k:'last_result',         fk:'what_learned',  prefix:'지난 약속' },
     { k:'real_issue',          fk:'real_issue' },
     { k:'blocker_type',        fk:'blocker_type' },
     { k:'ai_used',             fk:'ai_used',          val:'aiUsed' },
     { k:'next_action',         fk:'what_to_do',    prefix:'다음 실행 약속' },
     { k:'next_deadline',       fk:'when_deadline', prefix:'다음 실행 약속' },
     { k:'next_evidence',       fk:'evidence',      prefix:'다음 실행 약속' },
     { k:'next_checkin',        fk:'checkin_memo' },
     { k:'next_checkin_channel',fk:'checkin_channel',  val:'checkinChannel' },  // 체크인 방식 추가
     { k:'session_note',        fk:'one_line_summary' },
     { k:'watch_next',          fk:'must_check_next' },
   ];
   ```
2. **헤더**: `COLDEF.map(c => c.prefix ? (c.prefix + ' - ' + t(c.fk)) : t(c.fk))`.
3. **값 변환** 헬퍼:
   ```js
   const SESSION_TYPE_I18N = { first:'session_first', regular:'session_regular', emergency:'session_emergency', milestone:'session_milestone', graduation:'session_graduation' };
   const CHANNEL_LABEL = { message:'메시지', call:'전화', video:'화상', email:'이메일', inperson:'대면', other:'기타' };
   function cellFor(c, r){
     if (c.val === 'sessionType'){ const v=r.session_type; return (v && SESSION_TYPE_I18N[v]) ? t(SESSION_TYPE_I18N[v]) : ''; }
     if (c.val === 'aiUsed'){ return r.ai_used === true ? 'O' : (r.ai_used === false ? 'X' : ''); }
     if (c.val === 'checkinChannel'){ const v=r.next_checkin_channel; return (v && CHANNEL_LABEL[v]) ? CHANNEL_LABEL[v] : ''; }
     return cellStr(r[c.k]);
   }
   ```
4. **AOA**: `const rows=[...logs].sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));` (유지) → header 행 = 위 헤더, 데이터 행 = `rows.map(r => COLDEF.map(c => cellFor(c,r)))`.
5. **열너비**: COLDEF 각 열에 대해 `max(헤더라벨 길이, 모든 행 cellFor 값 길이)` → `clamp(8,50)`. **변환된 값 기준**(원본 r[k] 아님).
6. **헤더 굵게**: 기존 스타일 루프 유지(헤더 컬럼 수 = COLDEF.length).

## 🔒 Constraints
- 바닐라 JS. 엑셀 셀=HTML 아님(escape 불필요). 새 라이브러리/전역 금지. `t()`/`cellStr` 재사용. 시트명 `코칭일지`·파일명 `coaching_logs.xlsx` 유지. 빈데이터 토스트 유지.

## ✔️ DoD
- [ ] 컬럼 순서·헤더가 위 COLDEF대로(대표자 3·팀이름 4·체크인 방식 포함·지난 약속/다음 실행 약속 말머리).
- [ ] 값: 세션유형=한글 라벨, ai_used=O/X, 체크인 방식=한글, 빈 enum=공란.
- [ ] 날짜순 정렬·열너비 자동(변환값 기준)·헤더 굵게 유지. 전역 logs 불변.
- [ ] 인라인 `<script>` `node --check` 통과. 변경 = downloadXlsx 내부 한정.

## 📤 Report (5섹션): 한 일/못한 일/결정/검증(node --check + 헤더·값 샘플)/위험

## 🚫 Do NOT
- 다른 함수 터치 · 전역 logs in-place 정렬 · 새 라이브러리 · `--no-verify`.

## 💡 Hints
- `t(SESSION_TYPE_I18N[v])` 로 세션유형은 현재 언어 라벨(폼과 일치). 체크인 방식은 폼 select가 하드코딩 옵션이라 `CHANNEL_LABEL` 하드코딩으로 맞춤.
- COLDEF.length 만큼만 헤더/너비/스타일 루프 — 기존 allKeys 기반 루프를 COLDEF 기반으로 교체.
