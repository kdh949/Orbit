# 전역 소켓 목록 제거 전후 200 VU 측정

## 실행 조건

- 환경: staging
- 도구: Artillery
- 동시 사용자: 200 VU
- 시나리오: 청중 입장 → 응답 제출 → 결과 revision 이벤트 수신
- 응답 경로: `/api/v1/audience-sessions/:sessionId/activities/:activityId/response`
- 변경: 연결·해제 시 전체 소켓 목록 조회와 `users:list` 전송 제거
- 반영 커밋: [`d030216c`](https://github.com/kdh949/Orbit/commit/d030216c2db457d6eb489d43014cb418f1e7339c)

| 구간    | 실행 시각 (Asia/Seoul)       | 완료 | 실패 | 결과 revision 이벤트 p95 |
| ------- | ---------------------------- | ---: | ---: | -----------------------: |
| 변경 전 | 2026-09-03 05:41:25–05:45:15 |  193 |    7 |                8,186.6ms |
| 변경 후 | 2026-09-04 01:59:10–02:02:40 |  200 |    0 |                  301.9ms |

revision 이벤트 시간은 응답 제출부터 `activity-results-updated`에서 기대 revision 이상을 수신할 때까지 계산합니다.

성공·실패와 p95는 Artillery 종료 결과, 서버 지연·DB·프로파일은 같은 실행 구간의 Grafana·Prometheus·Pyroscope 기록을 사용했습니다.

## 관련 변경

- [PR #69](https://github.com/kdh949/Orbit/pull/69)
- [개인 구현 요약](kdh949.md#socket-broadcast)
