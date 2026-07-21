# GPT-Realtime-Whisper spike

제품의 문장 정렬, presenter state, animation runtime과 분리해
`gpt-realtime-whisper`의 브라우저 마이크 경로만 계측하는 페이지다.

## 실행

1. ORBIT API에 `OPENAI_API_KEY`가 존재하고 Web/API가 실행 중이어야 한다.
2. ORBIT에 로그인한 뒤 읽기 권한이 있는 `projectId`를 준비한다.
3. 다음 주소를 Chrome에서 연다.

```text
http://localhost:5173/gpt-realtime-whisper-spike.html?projectId=<projectId>
```

브라우저에는 장기 API key가 아닌 project-scoped ephemeral client secret만 전달된다.

## 측정값

- 연결: microphone, client secret, SDP answer, data channel open
- 입력: RMS dB, 자동 noise floor/threshold, 안정화된 로컬 speaking 상태
- 준비 상태: `session.updated` 설정 일치와 1.5초 무음 보정 완료 여부
- 분할: silence 우선 commit과 선택 가능한 6~12초 safety commit
- 전사: incremental delta, completed transcript, item ID, partial count
- 지연: speech onset → first delta, commit → completed, onset → completed
- 정확도: 사용자가 입력한 기준 문장과 final transcript 사이의 normalized Korean CER

CER는 NFC 정규화 후 공백, 문장부호, 기호를 제외한 문자 단위 편집 거리다.
기준 문장과 전사 원문은 브라우저 메모리에만 유지한다. JSON 내보내기는 원문 대신
길이와 지연, CER만 포함한다. 이벤트 trace도 event type, item ID, text length만 기록한다.

## 해석 주의사항

- `delay`별 비교는 같은 마이크, 같은 화자, 같은 문장, 같은 네트워크에서 반복한다.
- `지금 말하세요`가 표시되기 전에는 말하지 않는다.
- 주변 소음 측정 중에는 침묵을 유지한다.
- 표본이 적을 때 p95를 일반화하지 않는다.
- 합성 음성 결과는 회귀 비교용이며 실제 한국어 화자의 품질을 대신하지 않는다.
- `confidence`는 API가 logprobs를 보낸 경우에만 표시된다.
