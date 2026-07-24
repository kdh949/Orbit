ORBIT 100명 WebSocket + 답변 저장 테스트
=========================================

이 테스트는 실제 운영 세션에 테스트 답변 100건을 저장합니다.
발표 결과에 테스트 데이터가 포함되어도 괜찮을 때만 실행하세요.

검증 범위:
- 서로 다른 청중 identity/cookie 100개 발급
- Socket.IO WebSocket 100개를 10개씩 단계적으로 연결
- presentation:audience:join room acknowledgement 확인
- 현재 activity schema에 맞춘 고유 답변 100건 저장
- 각 소켓의 activity-results-updated 수신 확인
- 각 청중이 자신의 답변을 다시 읽을 수 있는지 확인
- 단계별 실패율과 p95 응답시간 출력
- 종료 시 모든 WebSocket 연결 해제

설치:
  npm install

실행:
  node .\orbit-audience-websocket-load-test.mjs --confirm-write-100

안전장치:
- www.tryorbit.site에만 연결
- 정확히 100명으로 고정
- 초당 최대 10명씩 단계 연결/제출
- 확인 인자가 없으면 실행 중단
- 단계별 실패율이 5%를 넘으면 중단
- 청중별 답변은 1회만 저장

주의:
- DDoS 테스트가 아니라 제한된 애플리케이션 동시성 테스트입니다.
- 실행할 때마다 새로운 테스트 답변 100건이 기록됩니다.
- 실행 중 발표자가 activity를 닫거나 바꾸지 마세요.
- 여러 터미널에서 동시에 실행하거나 연속 반복 실행하지 마세요.
