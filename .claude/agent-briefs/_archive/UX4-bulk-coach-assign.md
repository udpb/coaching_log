# Brief UX4 — 코치 일괄 배정(이름검색·체크박스) + 미가입 초대 통합

> 자급자족 브리프. 본 파일 + CLAUDE.md + AGENTS.md + docs/glossary.md 외 컨텍스트 불필요.

| 메타 | 값 |
|------|----|
| ID | `UX4-bulk-coach-assign` · P1 · 브랜치 `feat/bulk-coach-assign` |
| 관련 | ADR-013 · 마이그레이션 `20260605_phase_w_project_invites.sql`(머지됨) |

---

## 🎯 Mission
프로젝트 편집 모달의 코치 배정을 **이름·소속 검색 → 체크박스 다중선택 → 일괄 배정**으로 바꾸고, 미가입 코치는 신규 `project_invites` 테이블에 "초대 예약"으로 저장한다. 배정 목록은 **가입 멤버(project_members) + 초대(project_invites)를 합쳐** 표시하고, 미가입 코치가 가입(`linked_user_id` 채워짐)하면 "배정하기" 버튼으로 `promote_invite_to_member` RPC 호출해 승격한다. 빌드 없는 단일 파일이므로 `node --check`(인라인 JS 파싱) 통과 필수.

## 📋 Context
- 현재: 코치를 **한 명씩** 검색(`onMemberSearchInput`)→단일 선택(`pickMemberSuggestion`/`_memberSearchSelected`)→`addProjectMember`. 미가입 코치는 배정 거절 + inline 초대 영역(`#projMemberInvite`)으로 magic link 안내.
- 문제: 일괄 불가 + 미가입자는 가입 완료 전 배정 못함(②) → "메일 보냈는데 등록 안 됨".
- DB(이미 적용 대상): `project_invites(id, project_id, coach_directory_id, role, invited_by, invited_at, UNIQUE(project_id,coach_directory_id))` + RPC `promote_invite_to_member(p_invite_id uuid)`(가입 시 member 승격, 미가입이면 'coach not joined yet' 예외). RLS = `is_admin_or_pm()`.
- `coaches_directory` 행에 `id`(uuid)·`linked_user_id`(가입 시 채워짐)·`name`·`email`·`organization`·`photo_url`. 검색은 클라 캐시 `coachDirectory` 배열(`loadCoachDirectory`) 사용.

## ✅ Prerequisites (STOP)
- [ ] `public/index.html` 에 `onMemberSearchInput`(~5928) · `pickMemberSuggestion`(~5968) · `addProjectMember`(~6082) · `loadAndRenderProjectMembers`(~5867) · `renderProjectMembers`(~5898) · `_memberSearchSelected`(~5925) 존재. 라인 약간 이동 가능 — grep 으로 보정.
- [ ] `#projMemberSection`·`#projMemberList`·`#projMemberSuggestions`·`#projMemberEmail`·`#projMemberRole`·`#projMemberInvite` DOM 존재(~3673-3711).
- [ ] `_projModalState.id`(현재 편집 중 project id) 사용 패턴 확인.
- [ ] coachDirectory 캐시에 `id`·`linked_user_id` 가 실제로 들어오는지 `loadCoachDirectory` select 컬럼 확인. **없으면 select 에 `id, linked_user_id` 추가**(검색·배정에 필수).

## 📖 Read First (이 순서)
1. CLAUDE.md · AGENTS.md · docs/glossary.md
2. `public/index.html`: 3673-3711(배정 UI HTML) · 5865-6010(멤버 로드/렌더/검색/선택) · 6082-6162(addProjectMember·updateRole·remove) · loadCoachDirectory 정의
3. ADR-013: `(coach-finder 레포)docs/decisions/013-bulk-coach-assign-invites.md` (없으면 본 브리프 Context 로 충분)

## 🎯 Scope
### CAN touch
- `public/index.html` (배정 UI HTML 영역 + 관련 JS 함수만)
### MUST NOT touch
- 마이그레이션/스키마 · `project_members` RLS · 다른 화면(dashboard/myinfo/plans 등) · `escHtml`/`escAttr` 헬퍼 · 변경 금지 항목

## 🛠 Tasks
1. **검색 결과 다중선택**: `onMemberSearchInput` 의 결과 항목을 클릭=단일선택 대신 **체크박스(또는 토글) 누적 선택**으로. 선택된 코치들을 배열 `_memberSelected = []`(각 `{id, name, email, linkedUserId, organization}`)에 누적. 이미 선택된 항목은 체크 표시. 검색어 바꿔도 선택 유지.
2. **선택 칩 영역**: 검색창 아래 "선택된 N명" 칩 목록(각 칩에 이름 + × 제거). 비어있으면 숨김.
3. **일괄 배정 버튼**: "선택한 N명 배정"(역할 셀렉트 1개 공통 적용). 클릭 시 각 선택 코치를:
   - `linkedUserId` 있음(가입) → `project_members` INSERT `{project_id, user_id:linkedUserId, role, added_by:currentUser.id}`. 중복(`duplicate|unique`)은 skip(에러 아님).
   - `linkedUserId` 없음(미가입) → `project_invites` INSERT `{project_id, coach_directory_id:id, role, invited_by:currentUser.id}`. 중복 skip.
   - 결과 요약 toast(예: "3명 배정 · 2명 가입대기 예약").
   - 완료 후 `_memberSelected=[]`, 검색창 비우고 목록 새로고침.
4. **배정 목록 통합 렌더**(`loadAndRenderProjectMembers`+`renderProjectMembers`):
   - members(기존) + `project_invites`(project_id=현재) 둘 다 fetch. invites 는 `coach_directory_id` 로 `coaches_directory`(name·email·linked_user_id) 조인.
   - 한 목록에 표시: 멤버 = "✅ 배정됨" + 역할 셀렉트 + ×(해제). invite = "⏳ 가입대기" 배지 + ×(invite 취소, project_invites DELETE). 단 invite 의 코치가 **가입 완료(linked_user_id 채워짐)** 면 "✅ 가입함 — 배정하기" 버튼 표시 → 클릭 시 `supabaseClient.rpc('promote_invite_to_member',{p_invite_id})` → 성공 시 목록 새로고침.
5. **기존 단일 흐름 정리**: `addProjectMember`/`pickMemberSuggestion`/`_memberSearchSelected`/inline `#projMemberInvite`(magic link) 는 — 일괄 흐름으로 대체되면 제거하거나, magic link 발송(`sendInviteMagicLink`)은 **남겨서** invite 행 옆 "초대 메일" 액션으로 재활용해도 됨(판단 후 "결정한 것"에). 단 죽은 함수는 남기지 말 것.
6. 검증: 인라인 JS `node --check` 통과(아래 방법). 배정 UI HTML 의 중괄호/태그 균형. (DB 적용은 사용자 몫 — 코드만.)

## 🔒 Tech Constraints
- 빌드/tsc 없음 — 검증 = `node --check`(인라인 script 추출 파싱) + 육안. XSS: 모든 사용자/DB 텍스트는 `escHtml`/`escAttr` 필수(인라인 onclick 인자는 escAttr + 따옴표 주의 — 가능하면 data-* + addEventListener 권장).
- Supabase JS v2 패턴(기존 `supabaseClient.from().insert/select/delete`, `.rpc()`). 파괴적 git·`--no-verify` 금지.
- 브랜드: 기존 코드 톤(인라인 스타일·var(--orange) 등) 유지. 새 색 도입 금지.

### node --check 방법
```
python3 -c "import re;src=open('public/index.html',encoding='utf-8').read();s=re.findall(r'<script(?![^>]*src=)[^>]*>(.*?)</script>',src,re.S);open('_chk.js','w',encoding='utf-8').write('\n;\n'.join(s))"
node --check _chk.js && echo OK
rm -f _chk.js
```

## ✔️ Definition of Done
- [ ] 이름·소속 검색 → 체크박스 다중선택(누적) + 선택 칩 + "N명 배정" 버튼
- [ ] 가입자→project_members / 미가입→project_invites 분기 INSERT(중복 skip) + 요약 toast
- [ ] 배정 목록 = members(✅)+invites(⏳) 통합, invite 코치 가입 시 "배정하기"(promote RPC)
- [ ] 죽은 함수 없음, `node --check` OK, HTML 균형
- [ ] `git diff --name-only` = public/index.html 만

## 📤 Return Format
```
## ✅ 한 일  (함수/HTML 단위 — 다중선택·일괄배정·통합목록·승격)
## ❌ 못한 일 / 보류
## 🤔 결정한 것  (magic link 재활용 여부·칩 UI·onclick vs addEventListener)
## 🔬 검증  (node --check 결과 · 수동 시나리오 점검)
## ⚠️ 위험 신호 / 다음 (없으면 "없음")
```

## 🚫 Do NOT
- 마이그레이션/RLS 수정 · 다른 화면 · escHtml 우회 · 죽은 함수 잔존 · 새 색/라이브러리 · hook 우회

## 💡 Hints
- coachDirectory 캐시에 `id`·`linked_user_id` 가 없으면 검색·배정이 안 됨 → `loadCoachDirectory` select 에 추가가 1순위.
- invite 의 "가입 완료" 판정 = 조인한 `coaches_directory.linked_user_id != null`. 그때만 "배정하기" 노출.
- promote RPC 는 미가입 시 예외 던짐 → "배정하기" 는 가입 확인된 행에만 보이므로 정상 경로에선 예외 안 남. catch 로 toast 처리.
- 중복 INSERT 는 UNIQUE 제약 → error.message 에 duplicate/unique → 조용히 skip(이미 배정/예약됨).

## 🏁 Final Note
부수 발견은 "위험 신호"에만. 본 브리프는 코치 배정 UI(일괄+invite)만. magic link 메일 자체 로직은 기존 유지.
