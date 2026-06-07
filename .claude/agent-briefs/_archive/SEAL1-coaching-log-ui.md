# Brief SEAL1 — coaching-log 직접생성 UI 봉인 (트랙B 2단계)

> 자급자족 브리프. 본 파일 + CLAUDE.md + AGENTS.md + docs/glossary.md 외 컨텍스트 불필요.

| 메타 | 값 |
|------|----|
| ID | `SEAL1-coaching-log-ui` · **P1·대형** · 브랜치 `feat/seal-coaching-log` |
| 관련 | coach-finder ADR-019 · 마이그레이션 `20260605_phase_y_seal_rls.sql`(원자 동시배포) |

## 🎯 Mission
coaching-log(`public/index.html`)에서 **수주前 자산 직접생성/쓰기 UI를 제거**하고 **읽기·세팅·모니터링은 유지**한다. To-Be: coaching-log=수주後 코치 도구. 빌드 없는 단일 파일 — `node --check`(인라인 JS) 통과 필수.

## 📋 Context (확정 설계)
> coaching-log엔 BP(수주前) 개념 비노출. 프로젝트는 수주 트리거로만 생성(이미 currentProject 선택→세션 연결 구조 존재). 코치 디렉토리는 읽기/검색만(배정용). 코치 본인 self-edit·멤버 배정·세션기록은 유지.

## ✅ Prerequisites (STOP)
- [ ] 아래 제거 대상 함수/요소가 실재하는지 grep 확인(라인 이동 가능).
- [ ] **읽기/세팅/세션 경로가 제거 대상과 분리 가능한지** 확인. 얽혀 있으면(특히 renderBPView가 읽기+쓰기 혼재) 어디가 얽혔는지 STOP 보고.
- [ ] 제거 후 **남은 코드에서 제거된 함수를 호출하는 곳 0**(끊긴 참조 금지).

## 📖 Read First
1. CLAUDE.md · AGENTS.md · docs/glossary.md
2. `public/index.html`: nav(3073-3080) · BP뷰(renderBPView ~10560+·saveBP~11110·transitionBPStatus~11232·deleteBP~11197·BP코치핀 openBPCoachPicker~11304/pinCoachToBP~11392/updateBPCoachStatus~11427/unpinCoachFromBP~11447) · 프로젝트(openProjectCreateModal~5592·saveProjectModal~5643·deleteCurrentProject~5763·버튼 6262/6272/6309) · 코치디렉(openCoachCreateModal~9721·openCoachEditModal~9733·saveCoach~9938·deleteCoach~9967·CSV onCoachCSVFilePicked~10121/showCsvImportPreview~10151/commitCsvImport~10206·버튼 9643/9645) · 모달 HTML(bpModal~3718·bpCoachPickerModal~3762·projModal~3700·coachModal~4006·csvImportModal~3804)

## 🎯 Scope
### CAN touch
- `public/index.html` (아래 제거/수정 대상만)
### MUST NOT touch (유지 — 봉인 금지)
- **세션기록**(form·submitRecord·coaching_logs 전부) · **대시보드/리스트/팀 모니터링**(renderTeams·renderDashboard·renderList)
- **project_members 세팅**: bulkAssignSelected·updateProjectMemberRole·removeProjectMember·promoteProjectInvite·cancelProjectInvite·loadAndRenderProjectMembers (전부 유지)
- **코치 본인 myinfo**: saveMyInfoContract·saveMyInfoProfile·내정보 탭 (유지)
- **코치 디렉토리 읽기/검색**: renderCoachDirBody·_coachDirFiltered·loadCoachDirectory·exportCoachesCSV(읽기) (유지)
- **프로젝트 선택/전환**: currentProject·renderProjectPicker의 "프로젝트 변경"(선택) (유지)
- escHtml/escAttr · 변경 금지 항목

## 🛠 Tasks
1. **'사업기획'(plans) 탭 제거**: nav 버튼(`:3079` navPlans) 제거 + `switchView`의 'plans' 분기 + renderBPView 및 BP 전용 함수(saveBP·openBPCreateModal·openBPEditModal·transitionBPStatus·deleteBP·deleteBPFromDetail) + BP 코치핀 함수(openBPCoachPicker·pinCoachToBP·updateBPCoachStatus·unpinCoachFromBP) + 모달 HTML(bpModal·bpCoachPickerModal) 제거. nav 게이트(4987-88 navPlans) 정리.
2. **프로젝트 직접생성 제거**: openProjectCreateModal·saveProjectModal의 **create 분기**·deleteCurrentProject + "+새 프로젝트" 버튼 3곳(6262/6272/6309). **프로젝트 편집 모달은 멤버 배정 UI만 남기고** name/기간/상태 입력은 비활성(readonly/disabled) 또는 제거. projModal에서 멤버 섹션(projMemberSection)은 **유지**.
   - ⚠️ saveProjectModal이 create+edit 혼재 → edit(멤버 외 메타수정)도 제거하되 멤버 배정 경로는 별도 유지. 멤버 배정이 projModal 의존이면 모달은 남기되 메타 입력만 봉인.
3. **코치 디렉토리 쓰기 제거**: openCoachCreateModal·openCoachEditModal·saveCoach·deleteCoach + CSV(onCoachCSVFilePicked·showCsvImportPreview·commitCsvImport) + 모달(coachModal·csvImportModal) + 버튼("새 코치" 9645·"CSV 가져오기" 9643). **renderCoachDirBody 읽기/검색/필터/CSV내보내기(읽기)는 유지.** 탭은 유지.
4. **안내**: 제거된 자리에 필요시 "사업 기획·코치 등록은 coach-finder에서" 한 줄(기존 톤). 프로젝트 피커에 "프로젝트는 coach-finder 수주 시 자동 생성" 안내.
5. **죽은 참조 0**: 제거 함수명 grep → 0(주석 제외). i18n 키(nav_plans 등) 잔재 정리.
6. 검증: `node --check`(인라인 JS) 통과. HTML 균형. 제거함수 grep 0.

## 🔒 Tech Constraints
- 빌드 없음 — 검증 = node --check + HTML 균형 육안. escHtml 유지. 파괴적 git·`--no-verify` 금지.
- **유지 대상을 실수로 건드리면 안 됨** — 특히 멤버 배정(bulkAssign 등)·세션기록·myinfo. 의심되면 STOP.

### node --check
```
python3 -c "import re;src=open('public/index.html',encoding='utf-8').read();s=re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>',src,re.S);open('_chk.js','w',encoding='utf-8').write(chr(10)+';'+chr(10).join(s))"
node --check _chk.js && echo OK; rm -f _chk.js
```

## ✔️ Definition of Done
- [ ] plans 탭·BP 함수·모달 제거 / 프로젝트 직접생성 제거(편집 메타 봉인, 멤버배정 유지) / 코치디렉 쓰기·CSV 제거(읽기 유지)
- [ ] 유지 대상(세션·대시보드·멤버배정·myinfo·코치검색·프로젝트선택) 전부 동작
- [ ] 제거 함수 grep 0 · node --check OK · HTML 균형
- [ ] `git diff --name-only` = public/index.html 만

## 📤 Return Format
```
## ✅ 한 일  (제거 항목 file:line 단위 + 유지 보존 근거)
## ❌ 못한 일 / 보류
## 🤔 결정한 것  (projModal 메타봉인 방식·BP뷰 분리법·안내문구·얽힌 코드)
## 🔬 검증  (node --check · 제거함수 grep 0 · 유지경로 동작 점검)
## ⚠️ 위험 신호 / 다음 (없으면 "없음")
```

## 🚫 Do NOT
- 세션기록·멤버배정·myinfo·코치검색·프로젝트선택 봉인(유지 대상) · 스키마/RLS(별도 Phase Y) · escHtml 우회 · 죽은 함수 잔존 · hook 우회
- 한 번에 다 지우고 검증 생략 — 단계적으로(탭 제거→함수 제거→모달 제거) node --check 자주.

## 💡 Hints
- renderBPView가 읽기+쓰기 혼재면: BP 탭 자체를 제거하므로 renderBPView 통째 제거 가능(읽기도 coaching-log엔 불필요 — BP는 coach-finder 영역).
- projModal은 멤버 배정의 컨테이너라 **모달 자체는 유지**, 내부 메타입력(name/날짜/상태/삭제)만 봉인. 멤버 섹션(projMemberSection) 보존.
- 프로젝트 편집 진입점(openProjectManageModal 류)은 멤버 관리용이라 유지하되 create 진입(openProjectCreateModal)만 제거.

## 🏁 Final Note
부수 발견은 "위험 신호"에만. 본 브리프는 직접생성/쓰기 봉인 + 읽기/세팅 유지만. RLS(Phase Y)는 메인이 별도 적용.
