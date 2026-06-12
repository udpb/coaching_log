# 브리프 R1-20260610-two-hour-recording — 2시간 녹음 청크 전사 (ADR-021)

## 배경 (Why)
docs/decisions/021-two-hour-chunked-transcription.md 필독 — 아키텍처 결정 전문. 요약: 2시간 오디오는 Vercel 본문 4.5MB 하드 리밋 때문에 단일 업로드 불가 → **5분 청크 분할 전사(flash) + 누적 텍스트를 기존 text 추출 경로(pro)로**.

## 산출물
1. `api/extract-session.js` — `task: 'transcribe'` 추가
2. `public/index.html` — 청크 녹음 상태머신 + 업로드 큐 + UI
3. `vercel.json` — maxDuration 60 → 300 (이번 브리프에 한해 수정 허용)

## 스펙

### 1. API — task: 'transcribe'
- body: `{ task: 'transcribe', audio(base64), audioMimeType, chunkIndex?, totalElapsedSec? }` — 인증·CORS·4M base64 한도 기존 그대로.
- 기존 동작(task 미지정 = 추출)은 **바이트 단위 불변**. task==='transcribe' 분기만 추가.
- 모델: `'gemini-2.5-flash'` **고정** (pro 폴백 없음 — 비용/쿼터 보호. retryable 은 기존 backoff 재시도만). generationConfig: temperature 0.2 · maxOutputTokens 16384 · responseMimeType json · **thinkingBudget 0**.
- 프롬프트(전사 전용, 간결): 오디오를 한국어/영어 verbatim 전사. 화자 구분 가능하면 "코치:"/"창업자:" 접두. 요약·해석·메타발언 금지. 무음/잡음만 있으면 빈 문자열. 출력 `{"raw_transcript":"..."}`.
- 응답: 비스트림 JSON `{ raw_transcript, modelUsed }` — 기존 repairAndParse 재사용.
- 길이 검증: audio 필수(>100 chars), transcript 불필요. inputMode/메모 로직과 무관 — 교차 영향 금지.

### 2. 프론트 — 청크 녹음 상태머신
현 구조: `startSttRecording()`(~6945)/`stopSttRecording()` 이 단일 blob → base64 → `runSttExtract({audio})`. 이를 다음으로 교체:

- **청크화**: `STT_CHUNK_MS = 5 * 60 * 1000` 상수. MediaRecorder 를 청크마다 **stop → 새 인스턴스 start** (timeslice 사용 금지 — 후속 청크가 자립형 webm 이 아님). 스트림(getUserMedia)은 유지, recorder 만 교체. `audioBitsPerSecond: 32000` 지정.
- **업로드 큐**: 청크 완료 시 {index, blob} 를 큐에 push. 동시 1개 in-flight 순차 업로드 → `task:'transcribe'` 호출 → 성공 시 `sttTranscript` textarea 에 `\n` 구분 append + `input` 이벤트 dispatch (draft 자동저장 연동). 실패 시 자동 재시도 2회(1s/3s), 그래도 실패면 큐에 보존 + 상태표시 + "재시도" 동작 제공 (blob 유실 금지).
- **타이머/한도**: 녹음 경과 표시(기존 UI 활용 가능). 110분 도달 시 경고 토스트, **120분 자동 종료**(stopSttRecording 호출과 동일 경로).
- **종료 플로우**: stop → 마지막 부분 청크 업로드·전사 완료 대기 → textarea 의 누적 전사가 ≥50자면 기존 `runSttExtract()`(text 모드, pro) 자동 실행 — 현행 "녹음 종료 후 자동 추출" UX 유지. <50자면 메모 모드 규칙 그대로.
- **상태 표시**: setSttStatus 활용 — "녹음 중 MM:SS · 전사 k/n 청크 완료", 실패 시 "청크 n 전사 실패 — 재시도". 신규 문자열은 JS 리터럴(한국어)로, 새 data-i18n 키를 만들면 ko/en/ja 사전에 반드시 추가 (S1 규칙).
- **기존 단일샷 오디오 추출 경로**(runSttExtract({audio}) / 서버 audio+extract): 코드 유지 (호환), 단 **녹음 UI 는 항상 청크 플로우 사용**. 텍스트 붙여넣기 경로 불변.
- 페이지 이탈 가드: 녹음 중 beforeunload 경고 1줄 (기존에 있으면 유지).

### 3. vercel.json
- `maxDuration: 300`. 다른 키 변경 금지.

## CAN touch
- 위 3개 파일만.

## MUST NOT
- 기존 추출(text/audio/memo) 요청·응답 형식 변경 금지. EXTRACTION_VERSION 변경 금지 (추출 프롬프트 불변). field-defs.js 수정 금지. escHtml/escAttr 규칙 (AGENTS.md). git 금지.

## 검증
- node --check 양쪽 + 인라인 추출 체크.
- mock fetch 로 transcribe 핸들러 실호출: (a) 정상 audio → 200 {raw_transcript} (b) audio 누락 → 400 (c) 기존 extract 요청 → 응답 필드 기존과 동일(회귀 0 — Q2/M1 mock 방식 재사용).
- 클라 상태머신: 청크 경계·실패 재시도·자동종료를 코드 경로로 추적 보고 (가능하면 STT_CHUNK_MS 를 짧게 줄인 시뮬레이션 노트 포함).
- 마이크 실녹음은 메인/사용자 몫 — 솔직하게 보류로 보고.
- Return Format 5섹션.
