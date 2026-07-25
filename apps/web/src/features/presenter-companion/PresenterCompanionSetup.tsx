import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDeviceTablet,
  IconLoader2,
  IconPresentation,
  IconWifi,
  IconX,
} from "@tabler/icons-react";
import QRCode from "qrcode";
import { useEffect, useId, useState } from "react";
import type {
  PresentationCompanionPairingResponse,
  PresentationSessionPurpose,
} from "@orbit/shared";
import { GradientButton } from "../../components/ui";
import { createPresenterCompanionPairing } from "./presenterCompanionApi";
import {
  usePresenterCompanionStatus,
  type PresenterCompanionStatusController,
} from "./usePresenterCompanionStatus";
import "./presenter-companion.css";

type PresenterCompanionSetupVariant = "popover" | "preflight";

export function PresenterCompanionSetup(props: {
  projectId: string;
  sessionId: string;
  sessionPurpose: PresentationSessionPurpose;
  statusController?: PresenterCompanionStatusController;
  title?: string;
  variant?: PresenterCompanionSetupVariant;
}) {
  const variant = props.variant ?? "preflight";
  const internalStatusController = usePresenterCompanionStatus(
    {
      projectId: props.projectId,
      sessionId: props.sessionId,
    },
    { enabled: !props.statusController },
  );
  const statusController = props.statusController ?? internalStatusController;
  const [pairing, setPairing] =
    useState<PresentationCompanionPairingResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "creating" | "ready" | "failed">(
    "idle",
  );
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(variant === "preflight");
  const contentId = useId();
  const connected = statusController.status?.connected === true;
  const connectionState = statusController.statusUnavailable
    ? "failed"
    : connected
      ? "ready"
      : "pending";

  useEffect(() => {
    if (!pairing) {
      setQrDataUrl(null);
      setQrFailed(false);
      return;
    }
    let active = true;
    setQrFailed(false);
    void QRCode.toDataURL(pairing.pairingUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    }).then(
      (value) => {
        if (active) setQrDataUrl(value);
      },
      () => {
        if (active) {
          setQrDataUrl(null);
          setQrFailed(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [pairing]);

  async function createPairing() {
    setPhase("creating");
    setError("");
    try {
      const next = await createPresenterCompanionPairing(props);
      setPairing(next);
      setPhase("ready");
      void statusController.refresh();
    } catch (cause) {
      setPairing(null);
      setPhase("failed");
      setError(
        cause instanceof Error
          ? cause.message
          : "iPad 연결을 준비하지 못했습니다.",
      );
    }
  }

  return (
    <section
      aria-label="iPad 발표 도우미 연결"
      className="presenter-companion-setup"
      data-expanded={String(!collapsed)}
      data-variant={variant}
    >
      {variant === "preflight" ? (
        <button
          aria-controls={contentId}
          aria-expanded={!collapsed}
          className="presenter-companion-setup-toggle"
          type="button"
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="presenter-companion-setup-toggle-icon">
            <IconDeviceTablet aria-hidden="true" size={20} />
          </span>
          <span className="presenter-companion-setup-toggle-copy">
            <span>
              <strong>{props.title ?? "iPad 발표 도우미"}</strong>
              <small>선택</small>
            </span>
            <small>연결하지 않아도 발표를 시작할 수 있어요.</small>
          </span>
          <span
            className="presenter-companion-setup-summary"
            data-state={connected ? "connected" : "optional"}
          >
            {connected ? (
              <>
                <IconCheck aria-hidden="true" size={14} />
                연결됨
              </>
            ) : (
              "연결 안 함"
            )}
          </span>
          {collapsed ? (
            <IconChevronDown aria-hidden="true" size={20} />
          ) : (
            <IconChevronUp aria-hidden="true" size={20} />
          )}
        </button>
      ) : (
        <div className="presenter-companion-heading">
          <div>
            <strong>{props.title ?? "iPad 연결"}</strong>
            <span>{getPurposeLabel(props.sessionPurpose)}</span>
          </div>
        </div>
      )}

      {!collapsed ? (
        <div className="presenter-companion-setup-content" id={contentId}>
          <div className="presenter-companion-pairing-layout">
            <div className="presenter-companion-pairing">
              <div className="presenter-companion-pairing-details">
                <div>
                  <strong>iPad 카메라로 QR을 스캔하세요</strong>
                  <small>
                    연결 코드는 2분 동안 한 번만 사용할 수 있습니다.
                  </small>
                </div>
                {pairing ? (
                  <small>
                    이 코드는 {formatPairingExpiry(pairing.expiresAt)}까지
                    유효합니다.
                  </small>
                ) : null}
                <GradientButton
                  className="presenter-companion-pairing-action"
                  disabled={phase === "creating"}
                  onClick={() => void createPairing()}
                  type="button"
                >
                  {phase === "creating"
                    ? "연결 코드 만드는 중"
                    : pairing
                      ? "새 연결 코드 만들기"
                      : "iPad 연결"}
                </GradientButton>
              </div>
              <div className="presenter-companion-qr">
                {qrDataUrl ? (
                  <img alt="iPad 연결 QR 코드" src={qrDataUrl} />
                ) : qrFailed ? (
                  <span role="alert">
                    <IconX aria-hidden="true" size={24} />
                    QR 코드를 만들지 못했습니다.
                  </span>
                ) : (
                  <span role="status">
                    {phase === "creating" ? (
                      <IconLoader2
                        aria-hidden="true"
                        className="presenter-companion-spin"
                        size={24}
                      />
                    ) : (
                      <IconDeviceTablet aria-hidden="true" size={26} />
                    )}
                    {phase === "creating"
                      ? "연결 코드를 만드는 중입니다."
                      : "연결 코드를 만들어 주세요."}
                  </span>
                )}
              </div>
            </div>

            <div
              aria-label="iPad 준비 상태"
              className="presenter-companion-readiness"
            >
              <SetupStatusRow
                detail={
                  statusController.statusUnavailable
                    ? "상태를 확인하지 못했어요."
                    : connected
                      ? "발표 도우미와 연결되어 있어요."
                      : "QR을 스캔하면 자동으로 연결돼요."
                }
                icon={IconWifi}
                label="iPad 연결"
                state={connectionState}
                value={
                  statusController.statusUnavailable
                    ? "확인 실패"
                    : connected
                      ? "연결됨"
                      : "대기 중"
                }
              />
              <SetupStatusRow
                detail={
                  connected
                    ? "발표 화면을 받을 준비가 됐어요."
                    : "연결 후 자동으로 준비됩니다."
                }
                icon={IconPresentation}
                label="발표 화면"
                state={connected ? "ready" : "pending"}
                value={connected ? "준비됨" : "대기 중"}
              />
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function SetupStatusRow(props: {
  detail: string;
  icon: typeof IconWifi;
  label: string;
  state: "failed" | "pending" | "ready";
  value: string;
}) {
  const Icon = props.icon;
  return (
    <div className="presenter-companion-readiness-row" data-state={props.state}>
      <span className="presenter-companion-readiness-icon">
        <Icon aria-hidden="true" size={22} />
      </span>
      <span>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </span>
      <span aria-live="polite" className="presenter-companion-readiness-value">
        {props.state === "ready" ? (
          <IconCheck aria-hidden="true" size={15} />
        ) : props.state === "pending" ? (
          <IconLoader2
            aria-hidden="true"
            className="presenter-companion-spin"
            size={15}
          />
        ) : (
          <IconX aria-hidden="true" size={15} />
        )}
        {props.value}
      </span>
    </div>
  );
}

export function getPurposeLabel(purpose: PresentationSessionPurpose) {
  return purpose === "presentation" ? "실전 발표" : "리허설";
}

function formatPairingExpiry(expiresAt: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(expiresAt));
}
