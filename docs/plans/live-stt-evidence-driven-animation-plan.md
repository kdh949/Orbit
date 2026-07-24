# 라이브 STT 증거 기반 애니메이션 트리거 안정화

## 요약

기존 `openai-realtime`을 유지하면서, 라이브 자막·자동 스크롤에 쓰는 UI 전사와 애니메이션 dispatcher에 쓰는 action 전사를 분리한다. action 전사는 final 결과 또는 동일 `utteranceId`의 연속 revision에서 확인된 stable prefix만 사용한다.

## 구현

- `TranscriptEvidenceState`를 추가한다. 첫 partial은 보류하고, 다음 revision과 공통인 prefix 또는 final의 새 구간만 dispatchable evidence로 만든다. stale revision과 이미 방출한 prefix는 무시한다.
- 실전 발표·전체 리허설·부분 리허설은 UI용 `TranscriptRevisionState`를 유지하되, 애니메이션 dispatcher에는 공통 evidence 상태의 before/current transcript와 새 구간만 전달한다.
- `keywordOccurrenceRuntime`은 action이 실제로 연결한 occurrence만 후보로 삼고, 확정된 대본 span 안에서 앞에서 뒤 순서로 선택한다. 소비한 occurrence와 대본 역행 후보는 제외한다.
- dispatcher는 evidence가 보류 상태면 `evidence-pending`으로 종료한다. 자동 실행은 현재 step의 확정 occurrence 하나만 수행하고, 미래 occurrence는 pending으로만 유지한다.
- `animationDebug=1`은 UI 전사와 action 전사의 차이, revision/final 여부, 위치 후보, pending·consumed 상태 및 실행 이력을 브라우저 메모리에서 표시한다.

## 비범위와 후속 방향

- API, WebSocket, DB, Deck schema와 STT 제공자는 변경하지 않는다.
- 현재 Realtime 이벤트에 없는 단어별 timestamp를 수신 시각으로 추정하거나 저장하지 않는다.
- 안정화 후 반복 키워드·약어·문장 생략·빠른 발화 fixture로 정확도를 측정한다. 기준을 만족하지 못할 때만 word timing·VAD·result offset 제공자 비교 스파이크를 별도 계획으로 진행한다.

## 검증

- partial → stable prefix → final에서 occurrence가 한 번만 실행되는지 검증한다.
- 반복 키워드와 같은 keyword의 다중 occurrence에서 선택한 현재 step만 실행되는지 검증한다.
- 동일 occurrence의 다중 animation은 함께 실행되고, 서로 다른 occurrence는 한 이벤트에서 연쇄 실행되지 않는지 검증한다.
- 세 발표 모드에서 같은 fixture가 동일한 played/pending/consumed 상태를 만드는지 검증한다.
- 장표 이동·타임라인 복원·부분 리허설 재시작 후 이전 evidence가 재실행되지 않는지 검증한다.
