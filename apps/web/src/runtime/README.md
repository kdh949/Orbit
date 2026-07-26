# Web runtime

여러 feature가 공유하는 browser capability를 둔다. 이 계층은 Web API와
workspace package를 사용할 수 있지만 `features/**` 내부 구현을 import하지
않는다.

- `presentation/`: 발표 창 배치, 화면 공유 bridge, activity runtime contract
- `presentation/channel/`: presenter state, BroadcastChannel protocol과 publisher
- `presentation/slideshow/`: 슬라이드 step, 전환 상태, 렌더링 정규화
- `speech/stt/`: Live STT port, engine registry, audio/PCM, Web Speech, OpenAI,
  Moonshine, Sherpa, reranking
- `speech/tracking/`: 문장 추출, 발음 정규화, lexical matching, prompter와
  script progress, keyword occurrence
- `speech/semantic/`: E5 embedding, semantic sentence matching, utterance
  decision과 debug state
- `speech/semantic/nli/`: browser NLI provider contract, worker protocol과
  browser/mock adapter
- 이후 semantic cue orchestration과 media capability도 같은 의존 방향을
  유지하며 이동한다.

Feature는 runtime을 사용할 수 있고 runtime은 feature를 알지 못한다.
