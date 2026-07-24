# iPad 발표 도우미 운영 Runbook

## 목적과 범위

이 문서는 실전 발표와 리허설의 iPad companion을 로컬에서 검증하고 제한
rollout·rollback·장애 대응하는 절차다. staging/production 배포는 별도 승인이
있을 때만 수행한다.

## 사전 조건

- `IPAD_PRESENTER_COMPANION_ENABLED=true`
- API와 Web이 같은 `WEB_ORIGIN` 계약을 사용
- Redis와 Socket.IO Redis adapter readiness 통과
- presentation purpose/audience access migration 적용
- HTTPS 또는 localhost secure context
- iPad와 desktop이 같은 네트워크에 있으며 TURN은 사용하지 않음

환경값의 실제 secret은 출력하지 않고 존재 여부와 env 계약만 확인한다.

```bash
node infra/scripts/check-env.mjs
docker compose config --quiet
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:smoke --grep "iPad presenter companion"
```

## 정상 동작 확인

1. 실전 발표 또는 리허설 session을 만들고 iPad 연결 패널을 연다.
2. 2분 이내 one-time QR/code를 iPad Safari에서 교환한다.
3. URL history와 DOM에 code가 남지 않는지 확인한다.
4. slide와 animation step, black output이 desktop audience와 일치하는지
   확인한다.
5. pen/highlighter/eraser/undo/clear/laser가 현재 surface에만 적용되는지
   확인한다.
6. 화면 공유 시 iPad video가 2초 안에 연결되고 audio track이 없는지
   확인한다.
7. 4:3·16:9·portrait share의 letterbox 밖에서 drawing이 시작되지 않고
   같은 시각점의 main overlay가 겹치는지 확인한다.

## 장애와 복구

- iPad reload, sleep/wake, `online`, `pageshow`는 같은 generation으로
  reconnect하고 authoritative output/snapshot을 다시 요청한다.
- 1.5초 annotation ack timeout, queue overflow, rejected ack는 pending
  command를 폐기하고 current surface snapshot을 재동기화한다.
- WebRTC 실패 또는 2초 ICE timeout은 iPad screen-share drawing만 잠근다.
  desktop capture와 main audience output은 계속 유지한다.
- presenter tab 연결이 끊기면 10초 authority lease가 만료될 때까지
  session/generation을 유지한다. 새 authority는 새 epoch와 snapshot으로
  복구한다.
- session close와 explicit disconnect는 active generation room에 revoke를
  보내고 socket을 끊은 뒤 generation/authority/presence와 pending pairing
  Redis key를 단일 연산으로 삭제한다.
- replacement는 generation을 증가시키고 이전 generation room만
  revoke/disconnect한다. 이전 presence는 generation mismatch로 즉시
  무효가 되고 TTL로 정리된다.
- session expiry 뒤에는 credential 검증이 즉시 fail-closed하며 generation,
  authority, presence, pending pairing은 각 bounded TTL 안에서 정리된다.

## Rollback

1. 승인된 환경 설정에서 `IPAD_PRESENTER_COMPANION_ENABLED=false`로 바꾸고
   API/Web task를 정상 방식으로 교체한다.
2. runtime config가 `ipadPresenterCompanionEnabled=false`인지 확인한다.
3. 새 pairing UI/API가 닫혔는지 확인한다.
4. 기존 socket은 process 교체로 끊긴다. flag-off API에 도달한 signed
   companion의 reconnect `join` 또는 다음 5초 heartbeat는 cookie와 current
   generation을 검증한 뒤 active generation을 revoke/disconnect한다.
5. 기존 presentation, audience, activity, rehearsal smoke가 계속 통과하는지
   확인한다.

DB의 additive purpose/audience field는 rollback 중 유지한다. 운영 데이터가
생긴 뒤 migration revert를 자동 실행하거나 staging/production을 이
runbook만으로 배포하지 않는다.

## 관측

`docs/conventions/logging.md`의 `presentation_companion.*` event만 사용한다.
pairing failure, command rejection, WebRTC failure, RTT bucket을 관찰하되
code/token/cookie/SDP/ICE/point/private content는 검색·첨부하지 않는다.
장애 자료에는 session/project의 승인된 opaque ID, generation, reason code,
state/latency bucket만 남긴다.
