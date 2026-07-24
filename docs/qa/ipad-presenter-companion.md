# iPad 발표 도우미 QA

## 자동 검증

| 범위 | 검증 |
| --- | --- |
| 계약 | strict pairing/bootstrap/output/annotation/laser/WebRTC schema |
| 보안 | one-time atomic exchange, UA-bound credential, safe Deck/asset projection, log redaction |
| realtime | authority lease, latest generation, bounded rate limit, reconnect/snapshot reconciliation |
| WebRTC | video-only sender, offer/answer/ICE correlation, `replaceTrack`, 2초 timeout 격리 |
| 좌표 | 16:9·4:3·portrait contain rect와 iPad/main overlay 정렬 |
| lifecycle | share restart cleanup, slide annotation restore, revoke Redis cleanup |
| rollback | flag off API/UI 차단과 인증된 reconnect join/heartbeat revoke |
| browser | pairing history 제거, private bootstrap fail-closed, presentation/rehearsal safe route |

자동 gate:

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:smoke --grep "iPad presenter companion"
node infra/scripts/check-env.mjs
docker compose config --quiet
```

로컬 DB migration을 포함하는 release gate에서는 아래 순서를 추가한다.

```bash
docker compose up -d postgres
pnpm db:migration:run
pnpm db:migration:revert
pnpm db:migration:run
```

## 출시 전 물리 iPad matrix

Task 0에서 후속 QA로 남긴 아래 matrix는 구현 완료를 막지 않지만 release
승인 전에 실제 기기로 완료해야 한다.

| 축 | 필수 조합 | 상태 |
| --- | --- | --- |
| host mode | 실전 발표, 리허설 | 대기 |
| iPadOS | release 시점 current, previous stable | 대기 |
| 입력 | Pencil hover 지원, hover 미지원 Pencil, touch-only | 대기 |
| 창 모드 | slide-window, surface swap | 대기 |
| output | slide 16:9, slide 4:3, black, share 16:9, share portrait | 대기 |
| 장애 | reload, sleep/wake, Wi-Fi 3초 차단, presenter 재연결, WebRTC 실패 | 대기 |
| 시간 | 10분 연속 drawing, 30분 연결 유지 | 대기 |

각 실행에는 기기 모델, iPadOS/Safari build, 네트워크 유형, p50/p95,
실패 reason code만 기록한다. pairing code/URL, credential, cookie, SDP/ICE,
point 배열, notes/script/transcript/private Deck marker는 스크린샷·trace·로그에
남기지 않는다.

## 물리 검증 절차와 기대 결과

1. slide 중앙·모서리에 pen/highlighter를 그리고 main audience stroke와
   시각적으로 겹치는지 확인한다.
   지원 기기에서는 Pencil pressure와 hover preview가 반영되고, 미지원
   Pencil/touch에서는 pressure 기본값과 pointer 전환이 안정적인지도 확인한다.
2. 4:3과 portrait share에서 letterbox를 터치해 stroke가 시작되지 않는지,
   content 내부 동일 지점 stroke가 main overlay와 겹치는지 확인한다.
3. share를 종료했다 다시 시작해 이전 share ink가 사라지고 새 epoch가
   비어 있는지 확인한다.
4. slide로 복귀해 해당 slide의 기존 ink가 복원되고 drawing이 자동으로
   다시 활성화되는지 확인한다.
5. Wi-Fi를 3초 끊고 복구해 중복 stroke 없이 snapshot으로 수렴하는지
   확인한다.
6. forced ICE failure에서 iPad share drawing만 잠기고 desktop capture와
   main audience output이 계속되는지 확인한다.
7. flag rollback에서 새 pairing이 닫히고 기존 presentation/audience/
   activity/rehearsal 동작이 유지되는지 확인한다.
