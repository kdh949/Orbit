import { useEffect, useRef, useState } from "react";
import type { PresentationCompanionBootstrap } from "@orbit/shared";
import {
  IconAlertCircle,
  IconDeviceIpadHorizontal,
  IconLoader2,
} from "@tabler/icons-react";
import {
  exchangePresenterCompanionPairing,
  fetchPresenterCompanionBootstrap,
} from "./presenterCompanionApi";
import {
  getPurposeLabel,
} from "./PresenterCompanionSetup";
import { CompanionAudienceRenderer } from "./CompanionAudienceRenderer";
import { useCompanionSocket } from "./useCompanionSocket";
import { CompanionAnnotationCanvas } from "./CompanionAnnotationCanvas";
import { useCompanionWebRtc } from "./useCompanionWebRtc";
import type { SurfaceRect } from "./surfaceGeometry";
import "./presenter-companion.css";

export function CompanionPairingPage(props: { code: string }) {
  const [bootstrap, setBootstrap] =
    useState<PresentationCompanionBootstrap | null>(null);
  const [error, setError] = useState("");
  const exchangeRequestRef =
    useRef<Promise<PresentationCompanionBootstrap> | null>(null);

  useEffect(() => {
    if (!exchangeRequestRef.current) {
      const code = props.code;
      window.history.replaceState(null, "", "/companion/connecting");
      exchangeRequestRef.current = exchangePresenterCompanionPairing(code).then(
        (exchange) => {
          window.history.replaceState(
            null,
            "",
            `/companion/${encodeURIComponent(exchange.sessionId)}`,
          );
          return fetchPresenterCompanionBootstrap(exchange.sessionId);
        },
      );
    }
    let active = true;
    void exchangeRequestRef.current
      .then((value) => {
        if (active) setBootstrap(value);
      })
      .catch(() => {
        if (active) {
          setError("연결 코드가 만료되었거나 이미 사용되었습니다.");
        }
      });
    return () => {
      active = false;
    };
  }, [props.code]);

  return <CompanionShell bootstrap={bootstrap} error={error} />;
}

export function CompanionPage(props: { sessionId: string }) {
  const [bootstrap, setBootstrap] =
    useState<PresentationCompanionBootstrap | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetchPresenterCompanionBootstrap(props.sessionId)
      .then((value) => {
        if (active) setBootstrap(value);
      })
      .catch(() => {
        if (active) setError("iPad 발표 도우미 연결을 확인할 수 없습니다.");
      });
    return () => {
      active = false;
    };
  }, [props.sessionId]);

  return <CompanionShell bootstrap={bootstrap} error={error} />;
}

export function CompanionShell(props: {
  bootstrap: PresentationCompanionBootstrap | null;
  error?: string;
}) {
  if (props.error) {
    return (
      <main className="presenter-companion-page">
        <CompanionHeader state="error" statusLabel="연결 확인 필요" />
        <section className="presenter-companion-shell-message" role="alert">
          <IconAlertCircle aria-hidden="true" size={34} />
          <h1>iPad 연결을 확인해주세요</h1>
          <p>{props.error}</p>
        </section>
      </main>
    );
  }
  if (!props.bootstrap) {
    return (
      <main className="presenter-companion-page">
        <CompanionHeader state="loading" statusLabel="연결 중" />
        <section className="presenter-companion-shell-message" role="status">
          <IconLoader2
            aria-hidden="true"
            className="presenter-companion-spinner"
            size={34}
          />
          <h1>iPad 발표 도우미 연결 중</h1>
          <p>안전한 발표 화면을 준비하고 있습니다.</p>
        </section>
      </main>
    );
  }
  return <ConnectedCompanionShell bootstrap={props.bootstrap} />;
}

function ConnectedCompanionShell(props: {
  bootstrap: PresentationCompanionBootstrap;
}) {
  const companion = useCompanionSocket(props.bootstrap.sessionId);
  const [surfaceRect, setSurfaceRect] = useState<SurfaceRect | null>(
    null,
  );
  const webRtc = useCompanionWebRtc({
    sendSignal: companion.sendSignal,
    shareEpochId:
      companion.output?.outputMode === "screen-share"
        ? companion.output.shareEpochId ?? null
        : null,
    subscribeSignal: companion.subscribeSignal,
  });
  const screenShareWritable =
    companion.output?.outputMode !== "screen-share" ||
    (webRtc.status === "connected" && Boolean(surfaceRect));

  return (
    <main className="presenter-companion-page">
      <CompanionHeader
        purposeLabel={getPurposeLabel(props.bootstrap.sessionPurpose)}
        state={
          companion.annotationRecovering
            ? "recovering"
            : companion.status === "connected"
              ? "connected"
              : "loading"
        }
        statusLabel={
          companion.annotationRecovering
            ? "다시 동기화 중"
            : companion.status === "connected"
              ? "연결됨"
              : "연결 확인 중"
        }
      />
      {companion.error ? (
        <section className="presenter-companion-shell-message" role="alert">
          <IconAlertCircle aria-hidden="true" size={34} />
          <h1>iPad 연결을 확인해주세요</h1>
          <p>{companion.error}</p>
        </section>
      ) : (
        <div className="presenter-companion-stage">
          {companion.output?.outputMode === "screen-share" &&
          webRtc.status === "failed" ? (
            <p className="presenter-companion-stream-warning" role="status">
              iPad 화면 공유 연결을 확인해주세요. 발표자와 청중 화면은 계속
              진행됩니다.
            </p>
          ) : null}
          <CompanionAudienceRenderer
            deck={props.bootstrap.deck}
            onSurfaceRectChange={setSurfaceRect}
            output={companion.output}
            stream={webRtc.stream}
          />
          {companion.output ? (
            <CompanionAnnotationCanvas
              annotation={companion.annotation}
              canWrite={props.bootstrap.scopes.includes(
                "write-annotation",
              )}
              connected={
                companion.status === "connected" &&
                Boolean(companion.authorityEpochId) &&
                !companion.annotationRecovering &&
                screenShareWritable
              }
              lastAcknowledgement={companion.lastAnnotationAck}
              output={companion.output}
              sendCommand={companion.sendAnnotationCommand}
              sendLaser={companion.sendLaser}
              surfaceRect={surfaceRect}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}

function CompanionHeader(props: {
  purposeLabel?: string;
  state: "connected" | "error" | "loading" | "recovering";
  statusLabel: string;
}) {
  return (
    <header className="presenter-companion-shell-header">
      <span className="presenter-companion-shell-brand">
        <IconDeviceIpadHorizontal aria-hidden="true" size={22} />
        <strong>iPad 발표 도우미</strong>
      </span>
      <span className="presenter-companion-shell-context">
        {props.purposeLabel ?? "발표 화면"}
      </span>
      <span
        className="presenter-companion-shell-status"
        data-state={props.state}
        role="status"
      >
        <span aria-hidden="true" />
        {props.statusLabel}
      </span>
    </header>
  );
}
