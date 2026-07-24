import {
  IconCheck,
  IconDeviceTablet,
  IconLoader2,
  IconPencil,
  IconPresentation,
  IconWifi,
  IconX,
} from "@tabler/icons-react";
import QRCode from "qrcode";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
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
  const statusController =
    props.statusController ?? internalStatusController;
  const [pairing, setPairing] =
    useState<PresentationCompanionPairingResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "creating" | "ready" | "failed"
  >("idle");
  const [error, setError] = useState("");
  const [inputDetected, setInputDetected] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  if (collapsed && variant === "preflight") {
    return (
      <section
        aria-label="iPad 발표 도우미 연결"
        className="presenter-companion-setup presenter-companion-setup-collapsed"
        data-variant={variant}
      >
        <div>
          <IconDeviceTablet aria-hidden="true" size={22} />
          <span>
            <strong>iPad 연결을 나중에 진행합니다</strong>
            <small>발표와 리허설은 그대로 시작할 수 있어요.</small>
          </span>
        </div>
        <button type="button" onClick={() => setCollapsed(false)}>
          연결 설정 열기
        </button>
      </section>
    );
  }

  const connected = statusController.status?.connected === true;
  const setupStep = connected ? (inputDetected ? 3 : 2) : 1;
  const connectionState = statusController.statusUnavailable
    ? "failed"
    : connected
      ? "ready"
      : "pending";

  return (
    <section
      aria-label="iPad 발표 도우미 연결"
      className="presenter-companion-setup"
      data-variant={variant}
    >
      <div className="presenter-companion-heading">
        <div>
          <strong>
            {props.title ??
              (variant === "preflight"
                ? "iPad 발표 도우미 준비"
                : "iPad 연결")}
          </strong>
          <span>{getPurposeLabel(props.sessionPurpose)}</span>
        </div>
      </div>

      {variant === "preflight" ? (
        <SetupProgress currentStep={setupStep} />
      ) : null}

      <div className="presenter-companion-pairing-layout">
        <div className="presenter-companion-pairing">
          <div>
            <strong>iPad 카메라로 연결하세요</strong>
            <small>
              연결 코드는 2분 동안 한 번만 사용할 수 있습니다.
            </small>
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
                  <IconDeviceTablet aria-hidden="true" size={28} />
                )}
                {phase === "creating"
                  ? "연결 코드를 만드는 중입니다."
                  : "연결 코드를 만들어 시작하세요."}
              </span>
            )}
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
          {variant === "preflight" && !connected ? (
            <button
              className="presenter-companion-later"
              type="button"
              onClick={() => setCollapsed(true)}
            >
              나중에 연결
            </button>
          ) : null}
        </div>

        <div
          aria-label="iPad 준비 상태"
          className="presenter-companion-readiness"
        >
          <SetupStatusRow
            detail={
              statusController.statusUnavailable
                ? "연결 상태를 확인하지 못했습니다."
                : connected
                  ? "발표 도우미와 연결되어 있어요."
                  : "iPad 연결 여부를 확인하는 중"
            }
            icon={IconWifi}
            label="iPad 연결"
            state={connectionState}
            value={
              statusController.statusUnavailable
                ? "확인 실패"
                : connected
                  ? "연결됨"
                  : "연결 확인 중"
            }
          />
          <SetupStatusRow
            detail={
              connected
                ? "발표 화면 수신 준비가 끝났어요."
                : "iPad에서 QR 코드를 스캔해 주세요."
            }
            icon={IconPresentation}
            label="발표 화면"
            state={connected ? "ready" : "pending"}
            value={connected ? "수신 준비됨" : "준비 중"}
          />
          {variant === "preflight" ? (
            <SetupStatusRow
              detail={
                inputDetected
                  ? "비공개 입력이 감지되었어요."
                  : "아래 패드에서 입력을 확인하세요."
              }
              icon={IconPencil}
              label="필기 입력"
              state={inputDetected ? "ready" : "pending"}
              value={inputDetected ? "입력 감지됨" : "입력 대기"}
            />
          ) : null}
        </div>
      </div>

      {variant === "preflight" ? (
        <PrivateDeviceCheckPad
          onInputDetected={() => setInputDetected(true)}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function SetupProgress(props: { currentStep: 1 | 2 | 3 }) {
  const steps = ["iPad 연결", "입력 테스트", "준비 완료"];
  return (
    <ol
      aria-label="iPad 기기 확인 진행 단계"
      className="presenter-companion-progress"
    >
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const complete = step < props.currentStep;
        const active = step === props.currentStep;
        return (
          <li
            data-state={
              complete ? "complete" : active ? "active" : "pending"
            }
            key={label}
          >
            <span>
              {complete ? (
                <IconCheck aria-hidden="true" size={14} />
              ) : (
                step
              )}
            </span>
            <small>{label}</small>
          </li>
        );
      })}
    </ol>
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
    <div
      className="presenter-companion-readiness-row"
      data-state={props.state}
    >
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

export function PrivateDeviceCheckPad(props: {
  onInputDetected?: (pointerType: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerRef = useRef<number | null>(null);

  function draw(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    context.fillStyle =
      getComputedStyle(canvas)
        .getPropertyValue("--redesign-color-primary")
        .trim() || "currentColor";
    context.beginPath();
    context.arc(
      ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) *
        canvas.width,
      ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) *
        canvas.height,
      Math.max(2, event.pressure * 6),
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  return (
    <div className="presenter-companion-device-check">
      <div>
        <strong>비공개 입력 테스트</strong>
        <small>
          이 테스트 선은 발표 화면이나 청중 화면으로 전송되지 않습니다.
        </small>
      </div>
      <canvas
        aria-label="iPad 입력 테스트 패드"
        height={120}
        ref={canvasRef}
        width={640}
        onPointerDown={(event) => {
          activePointerRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          props.onInputDetected?.(event.pointerType);
          draw(event);
        }}
        onPointerMove={draw}
        onPointerCancel={(event) => {
          if (activePointerRef.current === event.pointerId) {
            activePointerRef.current = null;
          }
        }}
        onPointerUp={(event) => {
          if (activePointerRef.current === event.pointerId) {
            activePointerRef.current = null;
          }
        }}
      />
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
