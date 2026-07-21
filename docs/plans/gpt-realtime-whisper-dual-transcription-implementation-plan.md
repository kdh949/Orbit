# GPT-Realtime-Whisper 발표 제어·습관어 이중 전사 구현 계획

## 상태

- 상태: 구현 대기
- 작성일: 2026-07-21
- 대상 브랜치: `codex/realtime-whisper-spike-calibration`
- 선행 검증: `gpt-realtime-whisper` 독립 spike의 연결·적응형 VAD·수동 commit 계측
- 관련 문서:
  - `docs/contracts.md`
  - `docs/specs/live-stt-keyword-control.md`
  - `docs/specs/rehearsal-speech-evidence-dto-contract.md`
  - `docs/conventions/environment.md`
  - `docs/conventions/logging.md`

## 1. 목적

ORBIT의 발표 제어 경로를 `gpt-realtime-whisper`로 전환하면서 다음 두 목표를 서로 독립적으로 달성한다.

1. 실시간 발표 제어
   - partial transcript를 이용해 대본 포커스와 스크롤을 빠르게 이동한다.
   - E5, keyword, command, animation, slide progression이 기존 계약에 맞게 동작한다.
   - `xhigh`를 기본 정확도 설정으로 사용한다.
2. 축어 기반 리허설 coaching
   - `음`, `어` 같은 습관어, 반복, 말더듬, 문장 재시작을 별도 전사 경로에서 보존한다.
   - 모델은 축어 전사만 수행하고, filler 판정과 집계는 deterministic local classifier가 담당한다.

`gpt-realtime-whisper`의 `xhigh`는 정확도 지향 설정이지만 filler 보존을 보장하는 계약으로 간주하지 않는다. 공식 Realtime transcription 설정은 `gpt-realtime-whisper`에 model, language, delay, manual commit을 제공하지만 prompt 입력은 제공하지 않는다. 반면 일반 Transcriptions API는 `gpt-4o-transcribe`와 `gpt-4o-mini-transcribe`에서 filler 예시를 prompt에 넣는 방식을 권장한다.

- [Realtime transcription session fields](https://developers.openai.com/api/docs/guides/realtime-transcription#session-fields)
- [Speech-to-text prompting](https://developers.openai.com/api/docs/guides/speech-to-text#prompting)
- [Realtime out-of-band transcription](https://developers.openai.com/cookbook/examples/realtime_out_of_band_transcription)

## 2. 범위

### 포함

- `gpt-realtime-whisper`와 `xhigh`를 Live STT 기본값으로 통일
- spike에서 검증한 session 설정 확인, noise calibration, adaptive VAD, silence commit을 제품 포트에 적용
- partial 기반 provisional sentence focus와 final 기반 확정 진행의 분리
- E5 prewarm 및 final-only semantic evidence 처리
- presenter remote auto-follow와 수동 스크롤 중지·복귀
- keyword, command, animation의 exactly-once 처리
- Realtime partial과 audio onset을 이용한 provisional filler 후보
- 발화 완료 오디오의 `gpt-4o-mini-transcribe` prompted 전사
- 선택적 Realtime OOB 정밀 전사
- deterministic filler·반복·말더듬 분류와 coaching report 연결
- 실패·timeout 시 coaching만 degraded 처리하는 격리
- 관련 단위·계약·통합 회귀 테스트

### 제외

- `gpt-realtime-whisper`에 지원되지 않는 prompt를 추가하는 시도
- 모델 fine-tuning
- 청중 화면에 transcript 또는 발표자 script 노출
- 자동 provider/delay downgrade
- 별도의 개인정보 전용 자동화 테스트
- 배포, 원격 환경변수 변경, 원격 push

개인정보 전용 테스트는 이번 계획에서 제외하지만, 기존의 transcript·script·raw audio·secret 로그 금지와 private storage 권한 계약은 구현 불변식으로 유지한다.

## 3. 확정 아키텍처

```text
마이크 + 공통 adaptive VAD
│
├─ 실시간 발표 제어 — 항상 활성
│  └─ gpt-realtime-whisper / xhigh
│     ├─ partial → displaySentenceId → 대본 포커스·스크롤
│     ├─ stable partial/final → keyword·cue 후보
│     └─ final/exactly-once gate → E5·command·animation·slide
│
├─ provisional coaching — browser-local
│  ├─ partial의 독립된 filler token
│  └─ audio onset + pause + lexical evidence 부재
│     → 머뭇거림 가능성 임시 이벤트
│
└─ 최종 coaching — 발표 제어와 비동기 분리
   ├─ 기본 모드
   │  └─ 발화별 audio clip
   │     → gpt-4o-mini-transcribe
   │     → korean-filler-verbatim-v1
   │
   └─ 정밀 모드
      └─ 별도 Realtime session의 최신 audio item
         → response.create / conversation: none
         → korean-filler-verbatim-oob-v1

축어 전사
→ deterministic filler/disfluency classifier
→ 최종 통계·리허설 coaching
```

세 경로의 소유권을 다음처럼 고정한다.

| 경로 | 입력 | 출력 | 사용처 | 실패 영향 |
| --- | --- | --- | --- | --- |
| Live control | Realtime partial/final | sentence·command·cue evidence | 스크롤, E5, keyword, animation | 기존 manual control 유지, 명시적 STT 오류 |
| Provisional coaching | partial + local VAD | 임시 filler/hesitation 후보 | 발표 중 비확정 안내 | 후보 retract 또는 표시 생략 |
| Verbatim coaching | utterance audio | 축어 transcript와 확정 occurrence | 최종 리포트·coaching | coaching만 `degraded` 또는 `unavailable` |

Verbatim coaching 결과는 Live control의 tracker, E5, channel publisher, renderer 입력으로 역류하지 않는다.

## 4. 현재 구현에서 해결할 핵심 문제

### 4.1 Report filler 원천이 Realtime transcript로 덮어써짐

현재 `apps/worker/src/rehearsal-stt.processor.ts`의 `applyLiveTranscriptFillerAnalysis()`는 report STT 분석 뒤 filler 결과를 `liveTranscript`와 `slideTranscriptSnapshots`로 다시 계산한다. `gpt-realtime-whisper`가 filler를 생략하면 prompted report transcription을 추가해도 최종 count가 낮은 값으로 덮어써진다.

수정 후 원천 우선순위는 다음과 같다.

1. 성공한 Realtime OOB verbatim transcript
2. 성공한 `gpt-4o-mini-transcribe` verbatim transcript
3. legacy run의 기존 report transcript
4. 어떤 축어 원천도 없으면 `unavailable`

Realtime control transcript는 최종 filler 통계의 authoritative source로 사용하지 않는다.

### 4.2 제품 OpenAI port가 spike의 발화 분할을 사용하지 않음

현재 제품 포트의 고정 주기 commit과 낮은 입력 threshold를 다음 spike 정책으로 교체한다.

- session 설정 검증 완료 후 1,500ms noise calibration
- threshold: noise floor median + 10dB
- threshold clamp: `-60dB..-20dB`
- onset attack: 200ms
- silence release/commit: 650ms
- safety max commit: 10초
- meter tick: 50ms
- calibration 완료 후 `input_audio_buffer.clear`

동일한 VAD snapshot을 Realtime commit, pause tracking, utterance boundary 수집에 공통 사용한다.

### 4.3 partial과 확정 진행의 역할이 섞임

`PrompterProgressSnapshot`에 UI 전용 `displaySentenceId`를 추가한다.

- 안정된 partial: `displaySentenceId`만 변경
- final 또는 pause commit: 기존 current/committed sentence와 coverage 변경
- E5, command, animation, slide progression: 확정 evidence만 사용
- audience presentation state: 기존처럼 `speech` 제거

PR #597의 `+1/+2/+3` forward resync와 presenter remote auto-scroll을 선행 반영하고, remote에는 main rehearsal panel과 같은 manual-scroll pause와 `따라가기` 복귀를 추가한다.

## 5. 구현 단계

### 단계 1. 환경·엔진 계약 통일

다음 기본값을 코드, 환경 예제, local/staging/production bootstrap 문서에 통일한다.

```text
LIVE_STT_ENGINE=openai-realtime
OPENAI_REALTIME_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_REALTIME_TRANSCRIPTION_DELAY=xhigh

FILLER_TRANSCRIPTION_MODE=mini
OPENAI_FILLER_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_REALTIME_OOB_MODEL=gpt-realtime-2.1
```

- `.env.local`은 실제 값만 수정하고 커밋하지 않는다.
- runtime config 조회 실패 시 localStorage의 다른 provider로 전환하지 않고 fail-closed 처리한다.
- `web-speech`는 환경변수로 명시하는 rollback 수단으로 유지한다.
- client-secret response의 model/delay를 검증한다.
- `session.updated`가 delay를 생략하면 발급 응답의 delay를 권위값으로 사용한다.
- 명시적으로 다른 model/delay가 반환되면 세션을 실패시킨다.

### 단계 2. 프로덕션 Realtime runtime

spike를 제품 코드에서 직접 import하지 않고 검증된 session·VAD 로직을 제품 소유 모듈로 옮긴다.

- `start()`는 WebRTC 연결, session 설정 확인, calibration이 모두 끝난 후 resolve한다.
- muted/ended/disabled track과 data channel 비정상 종료를 명시적 오류로 처리한다.
- partial은 즉시 전달한다.
- final은 `item_id + content_index`를 utterance identity로 유지한다.
- commit sequence로 out-of-order completion을 정렬한다.
- 선행 final 누락 시 최대 2초 대기 후 `final_reorder_timeout` metadata와 함께 다음 결과를 진행한다.
- 예상치 못한 종료 시 provider fallback 없이 기존 오류 UI와 manual control을 유지한다.

제품 상세 진단 UI는 추가하지 않는다. 연결·설정·VAD·latency metadata는 opt-in browser console ring buffer에서만 확인한다.

### 단계 3. Live control downstream 정합화

- `displaySentenceId`로 provisional focus를 전달한다.
- committed progress와 reversible focus를 분리한다.
- E5는 STT 연결·calibration과 병렬로 현재·인접 slide를 prewarm한다.
- E5 semantic evidence는 final-only로 유지한다.
- E5 실패·지연은 lexical focus를 차단하지 않는다.
- presenter remote reconnect snapshot에서 현재 row를 복구한다.
- manual scroll 중 auto-follow를 중단하고 `따라가기`로 복귀한다.

keyword·command·animation은 다음 idempotency key를 공통 경계로 사용한다.

```text
sessionId + slideId/revision + utteranceId + contentIndex + cue/action/occurrenceId
```

- 한 transcript에서 발견된 신규 keyword를 모두 처리한다.
- 실제 처리한 keyword만 detected 상태로 승격한다.
- 동일 utterance의 partial confirmation과 final은 한 번만 실행한다.
- `advance-slide`는 기존 coverage/AdvanceController gate를 통과한다.
- keyword occurrence의 `beforeChars`와 `afterChars`를 실제 판정에 적용한다.
- speech-triggered animation은 main timeline jump와 분리된 overlay invocation으로 실행한다.

### 단계 4. 발화 경계 계약과 audio clipping

공통 VAD에서 recording clock 기준의 발화 경계를 수집한다.

```ts
type RehearsalUtteranceBoundary = {
  utteranceId: string;
  sequence: number;
  startMs: number;
  endMs: number;
  commitReason: "silence" | "max-duration" | "stopped";
  slideId: string | null;
  deckRevision: number;
};
```

- 첫 threshold crossing을 onset으로 기록하고 confirmation 시점으로 늦추지 않는다.
- pause/resume 구간을 제외해 MediaRecorder의 녹음 timeline과 같은 clock domain을 사용한다.
- clip 시작에 300ms pre-roll을 적용한다.
- 10초 safety commit fragment는 실제 침묵 전까지 하나의 coaching utterance group으로 묶는다.
- 연속 발화가 60초를 넘을 때만 coaching용 group을 강제로 분리한다.
- 전체 recording upload가 끝난 뒤 worker가 기존 private audio에서 발화 clip을 메모리로 추출한다.
- 파생 clip을 storage asset으로 영속화하지 않고 전사 직후 폐기한다.

### 단계 5. 기본 prompted verbatim transcription

`FILLER_TRANSCRIPTION_MODE=mini`를 기본값으로 사용한다.

- 발화별 `gpt-4o-mini-transcribe` 호출
- language: `ko`
- response format: `json`
- concurrency: 2
- 발화별 timeout: 30초
- transient 429/5xx: 한 번 재시도
- 결과는 utterance sequence로 다시 정렬

Prompt는 환경변수 자유 문자열이 아니라 코드 상수와 version ID로 관리한다.

```text
promptVersion: korean-filler-verbatim-v1
```

Prompt는 다음 원칙을 포함한다.

- 문법·조사·어미·비문을 교정하지 않음
- `음`, `어`, `으`, `아`와 반복·말더듬·문장 재시작을 보존
- 들리지 않은 filler를 추가하거나 추측하지 않음
- 한국어 축어 예시 포함
- 기존 pronunciation context는 별도 용어 섹션으로 병합

prompt는 filler 인식 가능성을 높이는 보조 수단이며 결과 보장을 의미하지 않는다.

### 단계 6. provisional coaching

브라우저 내부에 다음 비영속 이벤트를 추가한다.

```ts
type ProvisionalFillerEvent = {
  utteranceId: string;
  kind: "lexical-filler-candidate" | "acoustic-hesitation-candidate";
  surface?: string;
  detectedAtMs: number;
  status: "provisional" | "retracted" | "confirmed";
};
```

- partial에 standalone filler token이 있으면 lexical 후보를 만든다.
- onset 후 350~1,500ms 동안 script-aligned lexical evidence가 없고 pause가 오면 acoustic hesitation 후보를 만든다.
- 음향 evidence만으로 `음` 또는 `어`라고 단정하지 않는다.
- 뒤이어 정상 lexical evidence가 오면 후보를 retract한다.
- verbatim transcript가 동일 utterance에서 filler를 확인하면 confirm한다.
- provisional event는 final report count, E5, keyword, command, animation에 사용하지 않는다.

### 단계 7. 선택적 Realtime OOB 정밀 모드

`FILLER_TRANSCRIPTION_MODE=realtime-oob`일 때만 별도의 Realtime session을 연다.

- control session: `gpt-realtime-whisper`
- precision session: `gpt-realtime-2.1`
- 두 session은 같은 local VAD의 commit 경계를 사용한다.
- precision session은 일반 assistant response를 만들지 않는다.
- latest audio item을 참조하는 OOB response만 생성한다.

```json
{
  "type": "response.create",
  "response": {
    "conversation": "none",
    "output_modalities": ["text"],
    "instructions": "korean-filler-verbatim-oob-v1 prompt",
    "metadata": {
      "purpose": "filler-verbatim",
      "utteranceId": "..."
    },
    "input": [
      {
        "type": "item_reference",
        "id": "precision session audio item ID"
      }
    ]
  }
}
```

- OOB timeout: 12초
- OOB result는 `response_id`와 `metadata.utteranceId`로 correlation한다.
- OOB 실패 utterance는 rehearsal 종료 후 mini transcription 대상으로 보낸다.
- OOB 비용과 latency metadata를 별도 집계한다.
- OOB 결과가 기본 mini보다 실제 filler F1을 개선할 때만 사용자 선택 모드로 노출한다.

### 단계 8. deterministic filler·disfluency classifier

모델 출력에서 count를 직접 신뢰하지 않고 공통 classifier를 사용한다.

```ts
type FillerOccurrence = {
  utteranceId: string;
  surface: string;
  normalized: string;
  category: "vocalized-pause" | "hesitation" | "discourse-marker";
  charStart: number;
  charEnd: number;
  offsetScope: "utterance";
  evidenceKinds: Array<
    | "standalone-token"
    | "pause-boundary"
    | "punctuation-isolation"
    | "repetition-or-restart"
    | "not-in-script"
  >;
  slideId: string | null;
};
```

분류 규칙:

- Unicode token boundary와 longest phrase 우선 매칭
- 부분 문자열 매칭 금지
- standalone `음`, `어`, `으`는 `vocalized-pause`로 확정 가능
- `아`, `그`, `저`, `저기`, `뭐`, `그러니까`, `약간`, `이제`는 최소 2개 contextual evidence가 있어야 확정
- `음식`, `어제`, `그림`, `저기압` 내부 문자열 제외
- phrase로 소비한 token을 단일 filler로 중복 집계하지 않음
- 반복·말더듬·문장 재시작은 filler와 별도의 `DisfluencyOccurrence`로 집계
- 기존 `fillerWordCount`와 `fillerWordDetails`는 confirmed occurrence에서 파생
- classifier version: `korean-filler-classifier-v2`

### 단계 9. report source와 degraded 상태

기존 public report 필드는 유지하고 additive source metadata를 추가한다.

```ts
type VerbatimCoachingSource = {
  mode: "mini" | "realtime-oob" | "legacy";
  state: "completed" | "degraded" | "unavailable";
  model: string;
  promptVersion: string | null;
  classifierVersion: string;
  completedUtterances: number;
  totalUtterances: number;
};
```

- OOB 성공 결과가 해당 utterance의 authoritative source다.
- OOB 실패 시 mini 결과로 보완한다.
- 하나 이상의 utterance가 최종 실패하면 전체 source state는 `degraded`다.
- 모든 verbatim source가 없으면 filler measurement를 `unavailable`로 표시한다.
- `applyLiveTranscriptFillerAnalysis()`의 authoritative override를 제거한다.
- legacy report adapter는 기존 filler 필드를 읽되 `mode=legacy`와 `promptVersion=null`을 사용한다.
- shared schema를 변경할 때 `docs/contracts.md`와 schema test를 함께 갱신한다.

## 6. 실패 격리와 운영 규칙

| 실패 | 발표 제어 | coaching 처리 |
| --- | --- | --- |
| mini timeout/429/5xx | 계속 동작 | 한 번 재시도 후 해당 utterance 실패 |
| OOB connection/timeout | 계속 동작 | mini fallback queue에 추가 |
| classifier 오류 | 계속 동작 | 해당 utterance `unavailable` |
| E5 로딩 실패 | lexical focus·manual control 계속 | semantic evidence 생략 |
| Realtime control 실패 | manual control 유지, 오류 표시 | recording이 있으면 종료 후 mini 분석 가능 |
| presenter channel reconnect | tracker 계속 동작 | latest snapshot으로 focus 복구 |

다음 데이터는 server log와 업무 이벤트에 넣지 않는다.

- transcript 원문
- presenter script와 speaker notes
- raw audio와 audio base64
- API key, client secret, token, cookie
- prompt 원문

업무 이벤트는 ID, provider/model, prompt version, utterance count, duration, status, safe error code만 기록한다.

## 7. 테스트 계획

### 7.1 단위·계약 테스트

- model/delay 발급 응답과 session event 검증
- delay 미반환과 명시적 mismatch
- calibration buffer clear
- adaptive VAD attack/release, silence/max commit
- muted/ended/disabled track
- out-of-order final과 2초 reorder timeout
- pause/resume recording clock과 utterance boundary
- prompt version과 pronunciation context 병합
- OOB correlation, timeout, mini fallback
- classifier의 phrase 우선·부분 문자열 제외·중복 방지
- `completed/degraded/unavailable` source precedence
- 기존 report schema 하위 호환

### 7.2 통합 테스트

fake LiveSttPort와 synthetic audio fixture를 사용해 다음 전체 흐름을 검증한다.

1. 정확한 한국어 대본 발화
2. 조사·어미·띄어쓰기 변경
3. 문장 일부 생략
4. `+1/+2/+3` 문장 건너뛰기
5. 이전 문장 반복
6. 2~3초 침묵 후 재개
7. cue 한 번 발화
8. 유사하지만 무관한 발화
9. cue 반복 발화
10. `음`, `어`, `으`, 반복된 filler
11. `그`, `저`, `이제`, `약간`의 filler·일반 어휘 용례
12. `음식`, `어제`, `그림`, `저기압` 음절 오탐 방지
13. `제가 제가`, `결, 결론은`, 문장 재시작
14. mini와 OOB의 timeout·부분 실패·out-of-order 응답
15. coaching provider 실패 상태의 E5·scroll·keyword·animation 정상 동작

별도의 개인정보 전용 테스트는 수행하지 않는다.

### 7.3 수동 macOS Chrome 검증

실제 한국어 발화 최소 30건과 무관 발화 최소 20건을 사용한다.

- `gpt-realtime-whisper/xhigh` 실제 적용 확인
- onset → first partial
- first partial → `displaySentenceId`
- publish → presenter DOM focus/scroll
- silence commit → final
- mini prompted transcription 완료 시간
- OOB transcription 완료 시간과 비용 metadata
- filler precision/recall
- command·animation 중복과 false positive

합격 기준:

| 지표 | 기준 |
| --- | --- |
| onset → first partial p95 | 2.5초 이하 |
| first partial → focus publish p95 | 300ms 이하 |
| publish → remote DOM focus/scroll p95 | 150ms 이하 |
| silence commit → Realtime final p95 | 1.5초 이하 |
| 문장 alignment 성공률 | 95% 이상 |
| deterministic text fixture | precision/recall 100% |
| mini filler 평가 | precision 95% 이상, recall 90% 이상 |
| `음식/어제/그림/저기압` | 오탐 0건 |
| cue/animation | precision 100%, recall 95% 이상 |
| 중복 animation/command | 0건 |
| 무관 발화 control false positive | 0건 |
| coaching 실패 시 control path | 모든 통합 시나리오 통과 |

OOB를 정밀 모드로 공개하려면 mini 대비 filler macro F1이 3%p 이상 개선되고 false positive가 증가하지 않아야 한다.

## 8. 구현 순서와 커밋 경계

1. `docs/contracts.md` 검토와 additive schema 계약
2. 환경 기본값과 runtime config fail-closed
3. Realtime session 검증·adaptive VAD·final ordering
4. provisional focus·E5 prewarm·presenter follow
5. keyword·command·animation exactly-once
6. utterance boundary와 recording clock
7. `korean-filler-verbatim-v1` mini transcription
8. deterministic filler/disfluency classifier와 report source
9. provisional coaching event
10. optional Realtime OOB 정밀 모드
11. 통합 테스트와 macOS Chrome 수동 측정
12. 관련 spec·environment·runbook 문서 정합화

각 단계는 독립 커밋으로 유지한다. 선행 단계 테스트가 통과한 뒤 다음 단계로 진행하며, 원격 push와 배포는 별도 요청 전까지 수행하지 않는다.

## 9. 완료 조건

- 기본 Live STT가 `gpt-realtime-whisper/xhigh`로 명시적으로 동작한다.
- partial 기반 focus와 final 기반 확정 상태가 분리된다.
- E5·presenter scroll·keyword·animation이 Realtime 경로에서 회귀 없이 동작한다.
- filler final 통계가 Realtime transcript로 덮어써지지 않는다.
- `gpt-4o-mini-transcribe` prompted result가 기본 final filler source다.
- Realtime OOB가 opt-in 정밀 모드로 격리된다.
- filler·반복·말더듬 판정이 deterministic classifier에서 수행된다.
- coaching 실패가 발표 제어를 중단하지 않는다.
- 통합 테스트와 수동 Chrome 합격 기준을 충족한다.
- 실제 비밀값, transcript 원문, script, raw audio를 server log에 추가하지 않는다.
