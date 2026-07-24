import QRCode from "qrcode";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { io, type Socket } from "socket.io-client";

import {
  attachAudienceStreamToWindow,
  registerAudienceStreamBridge,
  type AudienceStreamBridgeWindow,
} from "../../rehearsal/presenter/audienceStreamBridge";
import {
  companionSpikeChannelName,
  companionSpikeEvents,
  companionSpikeIdentity,
  companionSpikeUrl,
  drawCompanionSpikeInk,
  isCompanionSpikeInk,
  isCompanionSpikeSignal,
  type CompanionSpikeCapabilities,
  type CompanionSpikeHostKind,
  type CompanionSpikeLatencySummary,
  type CompanionSpikePoint,
  type CompanionSpikeSignal,
} from "./companionSpike";
import "./companion-spike.css";

type CompanionSpikeHostPanelProps = {
  hostKind: CompanionSpikeHostKind;
  projectId: string;
};

type SessionCreateResult =
  | {
      created: true;
      expiresAt: string;
      hostKind: CompanionSpikeHostKind;
      spikeId: string;
    }
  | { data: { code: string; message: string }; event: string };

type SessionResumeResult =
  | {
      expiresAt: string;
      hostKind: CompanionSpikeHostKind;
      resumed: true;
      spikeId: string;
    }
  | { data: { code: string; message: string }; event: string };

export function CompanionSpikeHostPanel({
  hostKind,
  projectId,
}: CompanionSpikeHostPanelProps) {
  const [spikeId, setSpikeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [companionConnected, setCompanionConnected] = useState(false);
  const [capabilities, setCapabilities] =
    useState<CompanionSpikeCapabilities | null>(null);
  const [latency, setLatency] =
    useState<CompanionSpikeLatencySummary | null>(null);
  const [peerState, setPeerState] = useState("대기");
  const [hasStream, setHasStream] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const companionConnectedRef = useRef(false);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audienceWindowRef = useRef<Window | null>(null);
  const audienceReadyRef = useRef(false);
  const pointByStrokeRef = useRef(new Map<string, CompanionSpikePoint>());

  const sendSignal = useCallback(
    (signal: CompanionSpikeSignal["signal"]) => {
      if (!spikeId) return;
      socketRef.current?.emit(companionSpikeEvents.signal, {
        signal,
        spikeId,
      });
    },
    [spikeId],
  );

  const negotiate = useCallback(
    async (stream: MediaStream) => {
      if (!spikeId || !socketRef.current) return;
      peerRef.current?.close();
      pendingIceRef.current = [];
      const peer = new RTCPeerConnection({ iceServers: [] });
      peerRef.current = peer;
      setPeerState("협상 중");
      for (const track of stream.getVideoTracks()) {
        peer.addTrack(track, stream);
      }
      peer.onicecandidate = (event) => {
        sendSignal(
          event.candidate
            ? { candidate: event.candidate.toJSON(), kind: "ice" }
            : { kind: "end" },
        );
      };
      peer.onconnectionstatechange = () => {
        setPeerState(peer.connectionState);
      };
      try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal({ description: offer, kind: "description" });
      } catch {
        setPeerState("협상 실패");
      }
    },
    [sendSignal, spikeId],
  );

  const activateStream = useCallback(
    (stream: MediaStream) => {
      if (streamRef.current && streamRef.current !== stream) {
        stopStream(streamRef.current);
      }
      streamRef.current = stream;
      setHasStream(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      }
      for (const track of stream.getVideoTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (streamRef.current !== stream) return;
            streamRef.current = null;
            peerRef.current?.close();
            peerRef.current = null;
            setHasStream(false);
            setPeerState("공유 종료");
          },
          { once: true },
        );
      }
      if (companionConnectedRef.current) void negotiate(stream);
    },
    [negotiate],
  );

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const storageKey = `orbit.companionSpike.${hostKind}.${projectId}`;
    const createSession = () => {
      socket.emit(
        companionSpikeEvents.create,
        { hostKind, projectId },
        (result: SessionCreateResult) => {
          if ("created" in result) {
            window.sessionStorage.setItem(storageKey, result.spikeId);
            setSpikeId(result.spikeId);
            setError(null);
            return;
          }
          setError(result.data?.message ?? "Spike 세션을 만들지 못했습니다.");
        },
      );
    };
    const resumeOrCreateSession = () => {
      const savedSpikeId = window.sessionStorage.getItem(storageKey);
      if (!savedSpikeId) {
        createSession();
        return;
      }
      socket.emit(
        companionSpikeEvents.resume,
        { spikeId: savedSpikeId },
        (result: SessionResumeResult) => {
          if ("resumed" in result && result.resumed) {
            setSpikeId(result.spikeId);
            setError(null);
            return;
          }
          window.sessionStorage.removeItem(storageKey);
          createSession();
        },
      );
    };
    const handlePresence = (value: unknown) => {
      if (!isRecord(value) || typeof value.connected !== "boolean") return;
      companionConnectedRef.current = value.connected;
      setCompanionConnected(value.connected);
    };
    const handleCapabilities = (value: unknown) => {
      if (isCapabilities(value)) setCapabilities(value);
    };
    const handleMetric = (value: unknown) => {
      if (isLatency(value)) setLatency(value);
    };
    const handleSignal = (value: unknown) => {
      if (!isCompanionSpikeSignal(value)) return;
      void applyHostSignal(value, peerRef.current, pendingIceRef.current);
    };

    socket.on("connect", resumeOrCreateSession);
    socket.on(companionSpikeEvents.presence, handlePresence);
    socket.on(companionSpikeEvents.capabilities, handleCapabilities);
    socket.on(companionSpikeEvents.metric, handleMetric);
    socket.on(companionSpikeEvents.signal, handleSignal);
    if (socket.connected) resumeOrCreateSession();
    return () => {
      socket.off("connect", resumeOrCreateSession);
      socket.off(companionSpikeEvents.presence, handlePresence);
      socket.off(companionSpikeEvents.capabilities, handleCapabilities);
      socket.off(companionSpikeEvents.metric, handleMetric);
      socket.off(companionSpikeEvents.signal, handleSignal);
      socket.disconnect();
      socketRef.current = null;
      companionConnectedRef.current = false;
      peerRef.current?.close();
      peerRef.current = null;
      if (streamRef.current) stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [hostKind, projectId]);

  useEffect(() => {
    if (!spikeId) return;
    const url = companionSpikeUrl(window.location.origin, spikeId);
    void QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
    }).then(setQrDataUrl, () => setQrDataUrl(null));
  }, [spikeId]);

  useEffect(() => {
    if (!spikeId) return;
    const socket = socketRef.current;
    const channel = new BroadcastChannel(companionSpikeChannelName(spikeId));
    const handleInk = (value: unknown) => {
      if (!isCompanionSpikeInk(value) || value.spikeId !== spikeId) return;
      const previous = pointByStrokeRef.current.get(value.strokeId);
      const next = canvasRef.current
        ? drawCompanionSpikeInk(canvasRef.current, value, previous)
        : undefined;
      if (next) pointByStrokeRef.current.set(value.strokeId, next);
      else pointByStrokeRef.current.delete(value.strokeId);
      channel.postMessage({ ink: value, type: "ink" });
      if (
        !audienceWindowRef.current ||
        audienceWindowRef.current.closed ||
        !audienceReadyRef.current
      ) {
        socket?.emit(companionSpikeEvents.inkApplied, {
          appliedAtMs: performance.now(),
          sequence: value.sequence,
          spikeId,
          strokeId: value.strokeId,
        });
      }
    };
    const handleApplied = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (isRecord(value) && value.type === "audience-ready") {
        audienceReadyRef.current = true;
        return;
      }
      if (
        !isRecord(value) ||
        value.type !== "ink-applied" ||
        typeof value.strokeId !== "string" ||
        typeof value.sequence !== "number"
      ) {
        return;
      }
      socket?.emit(companionSpikeEvents.inkApplied, {
        appliedAtMs:
          typeof value.appliedAtMs === "number"
            ? value.appliedAtMs
            : performance.now(),
        sequence: value.sequence,
        spikeId,
        strokeId: value.strokeId,
      });
    };
    socket?.on(companionSpikeEvents.ink, handleInk);
    channel.addEventListener("message", handleApplied);
    return () => {
      socket?.off(companionSpikeEvents.ink, handleInk);
      channel.removeEventListener("message", handleApplied);
      channel.close();
    };
  }, [spikeId]);

  useEffect(() => {
    if (!spikeId) return;
    const registration = registerAudienceStreamBridge({
      identity: companionSpikeIdentity(spikeId),
      onAttach: activateStream,
      onDetach: () => {
        setHasStream(false);
        peerRef.current?.close();
        peerRef.current = null;
      },
    });
    return () => {
      if (registration.ok) registration.unregister();
    };
  }, [activateStream, spikeId]);

  useEffect(() => {
    if (companionConnected && streamRef.current) {
      void negotiate(streamRef.current);
    }
  }, [companionConnected, negotiate]);

  const openAudienceWindow = () => {
    if (!spikeId) return null;
    const target = window.open(
      `/companion-spike/${encodeURIComponent(spikeId)}/audience`,
      `orbit-companion-spike-audience-${spikeId}`,
      "popup,width=1280,height=800",
    );
    audienceWindowRef.current = target;
    audienceReadyRef.current = false;
    return target;
  };

  const startSlideWindow = async (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    if (!spikeId || !navigator.mediaDevices?.getDisplayMedia) {
      setError("이 브라우저에서는 화면 캡처를 시작할 수 없습니다.");
      return;
    }
    const audienceWindow = openAudienceWindow();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      activateStream(stream);
      if (audienceWindow) {
        void attachStreamWhenReady(spikeId, stream, audienceWindow);
      }
    } catch {
      setError("slide-window 화면 캡처가 취소되었거나 실패했습니다.");
    }
  };

  const startSurfaceSwap = () => {
    if (!spikeId) return;
    window.open(
      `/companion-spike/${encodeURIComponent(spikeId)}/capture`,
      `orbit-companion-spike-capture-${spikeId}`,
      "popup,width=960,height=700",
    );
  };

  const publicUrl =
    spikeId && typeof window !== "undefined"
      ? companionSpikeUrl(window.location.origin, spikeId)
      : null;

  return (
    <aside className="companion-spike-host" aria-label="iPad companion spike">
      <header>
        <div>
          <strong>iPad spike</strong>
          <small>{hostKind === "presentation" ? "실전 발표" : "리허설"} host</small>
        </div>
        <span
          className={
            companionConnected
              ? "companion-spike-status is-online"
              : "companion-spike-status"
          }
        >
          {companionConnected ? "iPad 연결됨" : "iPad 대기"}
        </span>
      </header>

      {error ? <p className="companion-spike-error">{error}</p> : null}
      {publicUrl ? (
        <div className="companion-spike-pairing">
          {qrDataUrl ? <img alt="iPad spike QR" src={qrDataUrl} /> : null}
          <div>
            <code>{spikeId}</code>
            <a href={publicUrl} rel="noreferrer" target="_blank">
              iPad 화면 열기
            </a>
          </div>
        </div>
      ) : (
        <p>Spike 세션 생성 중…</p>
      )}

      <div className="companion-spike-actions">
        <button disabled={!spikeId} onClick={startSlideWindow} type="button">
          slide-window 캡처
        </button>
        <button disabled={!spikeId} onClick={startSurfaceSwap} type="button">
          surface swap 캡처
        </button>
        <button disabled={!spikeId} onClick={openAudienceWindow} type="button">
          청중 spike 창
        </button>
      </div>

      <div className="companion-spike-preview">
        <video
          aria-label="공유 영상 미리보기"
          autoPlay
          muted
          playsInline
          ref={videoRef}
        />
        <canvas aria-label="수신 필기 미리보기" ref={canvasRef} />
        {!hasStream ? <span>공유 영상 대기</span> : null}
      </div>

      <dl className="companion-spike-metrics">
        <div>
          <dt>WebRTC</dt>
          <dd>{peerState}</dd>
        </div>
        <div>
          <dt>Pointer / coalesced</dt>
          <dd>
            {formatBoolean(capabilities?.pointerEvents)} /{" "}
            {formatBoolean(capabilities?.coalescedEvents)}
          </dd>
        </div>
        <div>
          <dt>Pressure / hover</dt>
          <dd>
            {formatBoolean(capabilities?.pressureObserved)} /{" "}
            {formatBoolean(capabilities?.hoverObserved)}
          </dd>
        </div>
        <div>
          <dt>Ink p50 / p95</dt>
          <dd>
            {latency
              ? `${latency.p50Ms.toFixed(1)} / ${latency.p95Ms.toFixed(1)} ms`
              : "—"}
          </dd>
        </div>
      </dl>
    </aside>
  );
}

async function applyHostSignal(
  payload: CompanionSpikeSignal,
  peer: RTCPeerConnection | null,
  pendingIce: RTCIceCandidateInit[],
) {
  if (!peer) return;
  if (payload.signal.kind === "description") {
    if (payload.signal.description.type !== "answer") return;
    await peer.setRemoteDescription(payload.signal.description);
    for (const candidate of pendingIce.splice(0)) {
      await peer.addIceCandidate(candidate);
    }
    return;
  }
  if (payload.signal.kind === "ice") {
    if (!peer.remoteDescription) {
      pendingIce.push(payload.signal.candidate);
      return;
    }
    await peer.addIceCandidate(payload.signal.candidate);
  }
}

async function attachStreamWhenReady(
  spikeId: string,
  stream: MediaStream,
  targetWindow: Window,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (targetWindow.closed) return;
    const result = attachAudienceStreamToWindow({
      identity: companionSpikeIdentity(spikeId),
      shareEpochId: `share_spike_${spikeId}`,
      stream,
      targetWindow: targetWindow as unknown as AudienceStreamBridgeWindow,
    });
    if (result.ok) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
  }
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function formatBoolean(value: boolean | undefined) {
  if (value === undefined) return "—";
  return value ? "yes" : "no";
}

function isCapabilities(value: unknown): value is CompanionSpikeCapabilities {
  if (!isRecord(value)) return false;
  return (
    typeof value.spikeId === "string" &&
    typeof value.pointerEvents === "boolean" &&
    typeof value.coalescedEvents === "boolean" &&
    typeof value.pressureObserved === "boolean" &&
    typeof value.hoverObserved === "boolean" &&
    typeof value.webRtc === "boolean" &&
    typeof value.screenWidth === "number" &&
    typeof value.screenHeight === "number" &&
    typeof value.touchPoints === "number"
  );
}

function isLatency(value: unknown): value is CompanionSpikeLatencySummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.count === "number" &&
    typeof value.durationMs === "number" &&
    typeof value.maxMs === "number" &&
    typeof value.p50Ms === "number" &&
    typeof value.p95Ms === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
