# 브리프 B-20260610-coach-id-sot — coaching_logs.coach_id 마이그레이션 SoT 복구

## 배경 (Why)
- 라이브 DB의 `coaching_logs` 테이블에는 `coach_id uuid` 컬럼이 **존재**한다 (프론트가 insert 시 `dbRecord.coach_id = currentUser.id` 로 쓰고, RLS 4개 정책이 `coach_id = auth.uid()` 를 참조하며 앱이 정상 동작 중).
- 그러나 `supabase/migrations/` 36개 파일 어디에도 이 컬럼을 **추가하는 DDL이 없다** — 과거에 수동 SQL로 추가된 것. "마이그레이션 = 스키마 SoT" 원칙이 깨진 상태.
- 목적: 새 마이그레이션 파일로 라이브 DB와 마이그레이션 체인을 **일치**시킨다 (라이브 DB에는 no-op, 신규 재구축 시 컬럼 생성).

## 산출물
새 파일 1개: `supabase/migrations/20260610_phase_z_coach_id_sot.sql`

## 스펙
1. `ALTER TABLE public.coaching_logs ADD COLUMN IF NOT EXISTS coach_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;`
   - 라이브 DB에 이미 있으므로 **반드시 IF NOT EXISTS** (멱등). FK 가 라이브에 이미 있을 수 있으니 FK 는 DO 블록으로 조건부 추가하거나, 컬럼과 분리해 `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS` 가 불가한 Postgres 특성을 감안해 `DO $$ ... IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = ...) $$` 패턴 사용.
   - ⚠️ 라이브 컬럼의 실제 FK 존재 여부를 모르므로, FK 추가는 **NOT VALID 후 VALIDATE** 또는 조건부로 — 실패해도 컬럼 추가가 롤백되지 않게 FK 와 컬럼을 별도 문장으로.
2. 인덱스: `CREATE INDEX IF NOT EXISTS coaching_logs_coach_id_idx ON public.coaching_logs (coach_id);`
3. 백필은 **하지 않는다** (coach 는 자유 텍스트 이름이라 auth.users 매핑 불가 — 주석으로 명시).
4. 파일 헤더 주석에 반드시 기록:
   - 이 컬럼이 마이그레이션 밖에서 수동 추가됐던 경위 (SoT 복구 목적, 2026-06-10 감사에서 발견)
   - ⚠️ **재현성 한계**: 빈 DB 에서 시간순 재생 시 `20260421_phase4a_roles_rls.sql` 이 본 파일보다 먼저 실행되어 coach_id 참조로 실패한다. 적용된 파일 수정 금지 원칙 때문에 본 파일은 "라이브 패리티" 용이며, 제로베이스 재구축 절차는 별도 문서 필요하다는 사실.
5. 파일 끝에 `-- 검증` 섹션: information_schema 로 컬럼 존재·타입 확인 SQL + pg_indexes 로 인덱스 확인 SQL.

## CAN touch
- `supabase/migrations/20260610_phase_z_coach_id_sot.sql` (신규 1개만)

## MUST NOT
- 기존 마이그레이션 파일 수정 절대 금지
- RLS 정책 변경 금지 (이미 coach_id 를 참조하는 정책들 그대로)
- 다른 파일 일절 수정 금지

## 검증
- SQL 문법을 정독으로 검증 (로컬 DB 없음). 멱등성(두 번 실행해도 안전) 자체 점검.
- Return Format 5섹션 필수 (AGENTS.md).
