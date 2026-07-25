# Rehearsal live STT

This directory owns browser live-control STT only.

- `LiveSttPort` is the consumer contract for rehearsal speech tracking.
- `ReportSttProvider` is server-side and lives in the Python worker, not here.
- OpenAI Realtime, Sherpa, Web Speech, and Moonshine implement the same port.
- `openai-realtime` is the default browser live STT engine. It requests a
  project-scoped client secret from the Orbit API, then connects to OpenAI
  Realtime over WebRTC with `gpt-realtime-whisper`.
- CI tests use contract tests and deterministic mock harness output.
- Real OpenAI/Sherpa/Web Speech/Moonshine model runs are local/manual because
  external provider access and large browser model assets are not available in CI.

Web Speech is treated as non-local for consent purposes. MDN documents that
some browsers, including Chrome, can use a server-based recognition engine for
`SpeechRecognition`, sending audio to a web service.

OpenAI Realtime does not receive Orbit bias phrases as prompt steering for
`gpt-realtime-whisper`. Keep `updateBiasPhrases()` implemented for the common
port contract and let the existing SpeechTracker/postprocess matching handle
domain terms.
