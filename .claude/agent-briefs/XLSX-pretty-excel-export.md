# Brief XLSX — 헤더 다운로드를 "예쁜 엑셀(.xlsx)"로 (열너비·헤더 스타일)

> 자급자족 브리프. `../../CLAUDE.md` + `../../AGENTS.md` + `../../docs/glossary.md` 필독.

| 메타 | 값 |
|---|---|
| ID | `XLSX-pretty-excel-export` |
| 작성일 | 2026-06-25 |
| 상태 | 🟡 |
| 우선순위 | P2 |
| 의존 | **UI-A·UI-B 적용·검증 후 실행**(같은 파일 `index.html`). |

## 🎯 Mission
헤더 다운로드 버튼이 지금은 `downloadCsv()`로 **CSV**를 내보낸다. 엑셀에서 열면 **열너비가 전부 동일**해 보기 싫다. 이를 **`.xlsx`(엑셀)로 내보내기**로 바꿔, **열너비 자동맞춤 + 헤더 굵게**로 예쁘게 만든다. **컬럼 구성(트리밍)은 현재와 동일**(CSV1+CSV2 제외 규칙 유지).

## 📋 Context
- 버튼: `#csvDownloadBtn` (L3157~3159, 라벨 "CSV") onclick=`downloadCsv()`.
- `downloadCsv()` (L5322~): `logs`에서 컬럼 수집하되 **excludeKeys Set + `!k.startsWith('metric_')`** 로 제외(CSV1/CSV2). 현재 유지 컬럼 = `date … watch_next` 21개. 이 **트리밍 규칙을 그대로 재사용**한다.
- 기존 CDN 스크립트는 `<head>`에 pizzip·docxtemplater UMD로 로드됨(계약서용). 같은 방식으로 엑셀 라이브러리 추가.

## 🎯 Scope
### CAN touch
- `public/index.html` — ① `<head>`에 엑셀 라이브러리 CDN `<script>` 1개 추가 ② `downloadCsv()` 함수(엑셀 생성으로 교체 또는 그 자리에 `downloadXlsx()` 추가 후 버튼 재연결) ③ 버튼 라벨 "CSV"→"Excel"(L3159 텍스트).
### MUST NOT touch
- 컬럼 트리밍 규칙(제외 목록)·`loadLogs`/쿼리·`renderTeams`/`showDetail`(UI-A/B 영역)·다른 함수·마이그레이션·api.

## 🛠 Tasks
1. **엑셀 라이브러리 CDN 추가**(UMD, 전역 `XLSX` 노출): 셀 스타일(굵게)까지 되는 **`xlsx-js-style`** 권장 (예: `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js`). 로드 확인(전역 `XLSX` 존재).
   - ⚠️ 순정 SheetJS(`xlsx`)는 **열너비(`!cols`)는 되지만 굵은 헤더 스타일은 무료판 미지원** → 헤더 스타일 위해 `xlsx-js-style` 사용. (만약 해당 CDN 로드 불가하면, 순정으로 **최소 열너비라도** 적용하고 "위험 신호"에 보고.)
2. **`downloadXlsx()`**(또는 `downloadCsv` 교체): 
   - 컬럼 = 현재 트리밍과 **동일**(excludeKeys + `!startsWith('metric_')`). 헤더 행 + 데이터 행을 AOA(array-of-arrays)로 구성.
   - `XLSX.utils.aoa_to_sheet(aoa)` → 워크시트.
   - **열너비 자동**: `ws['!cols'] = cols.map(c => ({ wch: clamp(maxLen(c), 8, 50) }))` (해당 열 헤더+값의 최대 글자수 기준, 최소 8·최대 50).
   - **헤더 굵게**: 헤더 셀(`ws[XLSX.utils.encode_cell({r:0,c})]`)에 `.s = { font:{bold:true}, fill:{fgColor:{rgb:'FFF3E0'}} }` 등.
   - 빈 데이터면 토스트 "내보낼 데이터가 없습니다"(기존 동작 유지).
   - 시트명 `코칭일지`, 파일명 `coaching_logs.xlsx`, `XLSX.writeFile(wb, 'coaching_logs.xlsx')`.
3. 버튼이 새 함수를 호출하게 연결 + 라벨 "Excel"로.

## 🔒 Tech Constraints
- 바닐라 JS · CDN UMD. 빌드 없음. CSV는 innerHTML sink 아님(엑셀도 동일) — escape 무관하나, **값은 가공 없이 셀에 넣기**(이스케이프 불필요, HTML 아님).
- 새 전역 최소화. 라이브러리 1개만 추가(이미 있으면 재사용).

## ✔️ Definition of Done
- [ ] 버튼 클릭 → `coaching_logs.xlsx` 다운로드. 엑셀로 열면 **열너비가 내용에 맞고 헤더가 굵게**. 컬럼 = 기존 21개(트리밍 동일).
- [ ] 인라인 `<script>` `node --check` 통과. `XLSX` 전역 로드 확인(코드/CDN URL 명시).
- [ ] 변경 = head 스크립트 1줄 + 다운로드 함수 + 버튼 라벨로 한정.

## 📤 Return Format (5섹션 — 한 일/못한 일/결정/검증/위험)

## 🚫 Do NOT
- 컬럼 트리밍 변경 · 다른 함수 터치 · escape 관련 회귀 · `--no-verify`.

## 💡 Hints
- 열너비 maxLen은 `String(value).length` 기준(한글도 길이로 충분). 50 캡으로 너무 긴 셀 방지.
- `xlsx-js-style`는 SheetJS API 호환(드롭인). `XLSX.utils.aoa_to_sheet` / `XLSX.writeFile` 동일.
- CSV가 더 필요하면 차후 별도 버튼 — 본 브리프는 엑셀로 **교체**.
