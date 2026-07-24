import {
  IconDeviceTablet,
  IconLink,
  IconLinkOff,
} from "@tabler/icons-react";
import { useState } from "react";
import type {
  PresentationCompanionStatus as CompanionStatus,
  PresentationSessionPurpose,
} from "@orbit/shared";
import { disconnectPresenterCompanion } from "./presenterCompanionApi";
import {
  PresenterCompanionSetup,
  getPurposeLabel,
} from "./PresenterCompanionSetup";
import { usePresenterCompanionStatus } from "./usePresenterCompanionStatus";

export function PresenterCompanionStatus(props: {
  projectId: string;
  sessionId: string;
  sessionPurpose: PresentationSessionPurpose;
}) {
  const statusController = usePresenterCompanionStatus(props);
  const [showPairing, setShowPairing] = useState(false);

  async function disconnect() {
    try {
      await disconnectPresenterCompanion(props);
      statusController.setStatus({
        connected: false,
        connectedAt: null,
        pairingGeneration: null,
        rttBucket: null,
      });
      setShowPairing(false);
    } catch {
      void statusController.refresh();
    }
  }

  const connected = statusController.status?.connected === true;
  const state = statusController.statusUnavailable
    ? "unavailable"
    : connected
      ? "connected"
      : "waiting";

  return (
    <section
      aria-label="iPad 발표 도우미 상태"
      className="presenter-companion-status"
      data-state={state}
    >
      <span
        aria-hidden="true"
        className="presenter-companion-status-dot"
      />
      <div>
        <strong>
          <IconDeviceTablet aria-hidden="true" size={17} />
          {getPurposeLabel(props.sessionPurpose)} · iPad
        </strong>
        <span>
          {getStatusLabel(
            statusController.status,
            statusController.statusUnavailable,
          )}
        </span>
      </div>
      <button
        aria-expanded={showPairing}
        type="button"
        onClick={() => setShowPairing((value) => !value)}
      >
        <IconLink aria-hidden="true" size={16} />
        {connected ? "기기 교체" : "iPad 연결"}
      </button>
      {connected ? (
        <button type="button" onClick={() => void disconnect()}>
          <IconLinkOff aria-hidden="true" size={16} />
          연결 해제
        </button>
      ) : null}
      {showPairing ? (
        <PresenterCompanionSetup
          {...props}
          statusController={statusController}
          variant="popover"
        />
      ) : null}
    </section>
  );
}

export function getStatusLabel(
  status: CompanionStatus | null,
  unavailable: boolean,
) {
  if (unavailable) return "상태 확인 실패 · 발표는 계속됩니다";
  if (!status) return "상태 확인 중";
  if (!status.connected) return "연결 대기";
  switch (status.rttBucket) {
    case "fast":
      return "연결됨 · 빠름";
    case "moderate":
      return "연결됨 · 보통";
    case "slow":
      return "연결됨 · 느림";
    default:
      return "연결됨";
  }
}
