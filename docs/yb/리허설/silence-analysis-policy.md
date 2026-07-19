# Silero VAD 기반 침묵 분석 정책

## 목적

리허설 원본 음성에서 실제 발화 사이의 비발화 구간을 찾는다. 이 지표는 말하지 않은 시간만 측정하며 의도한 멈춤, 말막힘, 긴장, 발표 품질을 추정하지 않는다.

## 처리 구조

```text
AudioContent
├── STT
└── decode_audio()  # mono float32 16kHz, 요청당 1회
    ├── analyze_volume()
    └── analyze_silence()
        └── Silero VAD
```

- `/audio/transcribe`가 `AudioContent`를 한 번 로드한다.
- 음량과 침묵 분석은 같은 `DecodedAudio`를 사용하지만 실패 상태는 독립적이다.
- `/audio/transcribe-private`는 STT 전용으로 유지한다.
- 모델은 프로세스당 한 번 로드하고 `torch.set_num_threads(1)`을 적용한다.

## VAD 설정

- 패키지: `silero-vad>=6.2,<6.3`
- 실행 환경은 VAD 추론에 GPU를 사용하지 않으므로 `torch`, `torchaudio`는 공식 PyTorch CPU 인덱스로 고정한다.
- sample rate: `16kHz`
- speech threshold: `0.5`
- minimum speech: `250ms`
- minimum silence: `250ms`
- speech padding: `30ms`
- 앞뒤 무음은 제외하고 첫 발화와 마지막 발화 사이만 분석한다.
- 총 감지 발화가 1초 미만이면 `INSUFFICIENT_SPEECH`로 측정하지 않는다.

## 구간과 집계

- 신규 분석은 `metricDefinitionVersion=2`, `longSilenceMs=5000`을 사용하며 기존 version 1 결과는 읽기 호환만 유지한다.
- `250ms 이상 5초 미만`: `brief`
- `5초 이상`: `long`
- 정확히 `250ms`는 `brief`, 정확히 `5초`는 `long`이다.
- 시작 시간순 최대 1,000개 구간을 반환한다.
- `detectedSegmentCount`, `longSilenceCount`, `totalSilenceSeconds`는 절단 전에 계산하고 `segmentsTruncated`로 절단 여부를 표시한다.
- `silenceRatio`의 분모는 첫 발화 시작부터 마지막 발화 종료까지의 `analysisWindow`다.
- 장표별 `longSilenceCount`는 구간 midpoint가 속한 canonical slide timeline에 배정한다.

## 계약 교체

신규 계약은 다음 필드를 사용한다.

- `silenceAnalysis`
- `metrics.longSilenceCount`
- `measurements.longSilenceCount`
- `slideInsights[].longSilenceCount`
- 평가 metric `long-silence-count`
- focus kind `silences`

다음 과거 pause 필드는 신규 결과에 저장하지 않는다.

- `metrics.pauseCount`
- `pauseDetails`, `pauseV2Details`
- `measurements.pauseV1`, `measurements.pauseV2`
- `slideInsights[].pauseCount`
- `pause-count`, `pauses`

과거 `report_json`은 읽기 경계에서 과거 pause 필드를 제거하고 `silenceAnalysis=unmeasured/LEGACY_REPORT`로 정규화한다. 과거 pause 결과와 새 VAD 결과는 비교하지 않으며, 기존 pause 기반 PracticeGoal도 평가하지 않는다.

## 실패 정책

허용 reason code:

- `AUDIO_DECODE_FAILED`
- `NO_AUDIO_STREAM`
- `EMPTY_AUDIO`
- `INSUFFICIENT_SPEECH`
- `VAD_INITIALIZATION_FAILED`
- `ANALYSIS_FAILED`
- `LEGACY_REPORT`

VAD 초기화 또는 추론 실패는 STT와 음량 분석을 실패시키지 않는다. raw audio, transcript 원문, waveform, speech probability 배열은 DB와 로그에 남기지 않는다.

## 표시와 관측성

- 리포트 타임라인은 `long` 구간만 문제 구간으로 표시한다.
- 전체·장표 분석 화면은 과거 version 1의 저장된 longSilenceCount를 그대로 표시하지 않고, silenceAnalysis.segments 중 5초 이상인 구간만 다시 집계한다. 장표 배정은 구간 midpoint 기준이다.
- `brief`는 구간 카드로 노출하지 않고 전체 침묵 통계에만 포함한다.
- 코칭 문구는 “5초 이상 발화가 없었던 구간” 또는 “긴 침묵 위험 구간”을 사용한다.
- Worker summary 로그:
  - measured: `rehearsal.silence_analysis.completed` (`info`)
  - unmeasured: `rehearsal.silence_analysis.unmeasured` (`warn`)
- summary 필드는 `runId`, `jobId`, `longSilenceCount`, `totalSilenceSeconds`, `silenceRatio`, `reasonCode`다.
- 구간별 시간은 `APP_ENV=local`의 `debug` 로그에서만 확인한다.
