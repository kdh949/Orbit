import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { io, type Socket } from "socket.io-client";

import {
  attachAudienceStreamToWindow,
  registerAudienceStreamBridge,
  type AudienceStreamBridgeWindow,
} from "../../rehearsal/presenter/audienceStreamBridge";
import {
  calculateLatencySummary,
  collectCompanionSpikePoints,
  companionSpikeChannelName,
  companionSpikeEvents,
  companionSpikeIdentity,
  drawCompanionSpikeInk,
  isCompanionSpikeInk,
  isCompanionSpikeSignal,
  type CompanionSpikeCapabilities,
  type CompanionSpikeInk,
  type CompanionSpikeLatencySummary,
  type CompanionSpikePoint,
  type CompanionSpikeSignal,
} from "./companionSpike";
import "./companion-spike.css";

type JoinResult =
  | {
      expiresAt: string;
      hostKind: "presentation" | "rehearsal";
      joined: true;
      spikeId: string;
    }
  | { data: { code: string; message: string }; event: string };

export function CompanionSpikePage({ spikeId }: { spikeId: string }) {
  const [status, setStatus] = useState("연결 중");
  const [joined, setJoined] = useState(false);
  const [peerState, setPeerState] = useState("영상 대기");
  const [latestRttMs, setLatestRttMs] = useState<number | null>(null);
  const [latency, setLatency] =
    useState<CompanionSpikeLatencySummary | null>(null);
  const [capabilities, setCapabilities] = useState<CompanionSpikeCapabilities>(
    () => readCapabilities(spikeId),
  );
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<{
    sequence: number;
    startedAtMs: number;
    strokeId: string;
  } | null>(null);
  const previousPointRef = useRef<CompanionSpikePoint | undefined>(undefined);
  const pendingAckRef = useRef(new Map<string, number>());
  const samplesRef = useRef<number[]>([]);
  const measurementStartedAtRef = useRef(performance.now());

  const sendSignal = useCallback(
    (signal: CompanionSpikeSignal["signal"]) => {
      socketRef.current?.emit(companionSpikeEvents.signal, {
        signal,
        spikeId,
      });
    },
    [spikeId],
  );

  useEffect(() => {
    const socket = io({ withCredentials: true });
    socketRef.current = socket;
    const join = () => {
      socket.emit(
        companionSpikeEvents.join,
        { spikeId },
        (result: JoinResult) => {
          if ("joined" in result) {
            setJoined(true);
            setStatus("입력 가능");
            return;
          }
          setJoined(false);
          setStatus(result.data?.message ?? "Spike 세션에 연결할 수 없습니다.");
        },
      );
    };
    const handleDisconnect = () => {
      setJoined(false);
      setStatus("재연결 중");
      setPeerState("영상 연결 끊김");
    };
    const handleRevoked = () => {
      setJoined(false);
      setStatus("다른 iPad로 교체됨");
    };
    const handlePresence = (value: unknown) => {
      if (
        isRecord(value) &&
        value.connected === false &&
        value.reason === "host-disconnected"
      ) {
        setJoined(false);
        setStatus("발표자 host 연결 종료");
      }
    };
    const handleInkApplied = (value: unknown) => {
      if (
        !isRecord(value) ||
        typeof value.strokeId !== "string" ||
        typeof value.sequence !== "number"
      ) {
        return;
      }
      const key = `${value.strokeId}:${value.sequence}`;
      const sentAt = pendingAckRef.current.get(key);
      if (sentAt === undefined) return;
      pendingAckRef.current.delete(key);
      samplesRef.current.push(performance.now() - sentAt);
      const summary = calculateLatencySummary(
        samplesRef.current,
        performance.now() - measurementStartedAtRef.current,
      );
      setLatency(summary);
      socket.emit(companionSpikeEvents.metric, { ...summary, spikeId });
    };
    const handleSignal = (value: unknown) => {
      if (!isCompanionSpikeSignal(value) || value.spikeId !== spikeId) return;
      void applyCompanionSignal({
        payload: value,
        peerRef,
        pendingIce: pendingIceRef.current,
        sendSignal,
        setPeerState,
        videoRef,
      });
    };

    socket.on("connect", join);
    socket.on("disconnect", handleDisconnect);
    socket.on(companionSpikeEvents.revoked, handleRevoked);
    socket.on(companionSpikeEvents.presence, handlePresence);
    socket.on(companionSpikeEvents.inkApplied, handleInkApplied);
    socket.on(companionSpikeEvents.signal, handleSignal);
    if (socket.connected) join();
    return () => {
      socket.off("connect", join);
      socket.off("disconnect", handleDisconnect);
      socket.off(companionSpikeEvents.revoked, handleRevoked);
      socket.off(companionSpikeEvents.presence, handlePresence);
      socket.off(companionSpikeEvents.inkApplied, handleInkApplied);
      socket.off(companionSpikeEvents.signal, handleSignal);
      socket.disconnect();
      socketRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
    };
  }, [sendSignal, spikeId]);

  useEffect(() => {
    if (!joined) return;
    socketRef.current?.emit(companionSpikeEvents.capabilities, capabilities);
  }, [capabilities, joined]);

  useEffect(() => {
    if (!joined) return;
    const interval = window.setInterval(() => {
      const startedAt = performance.now();
      socketRef.current?.emit(
        companionSpikeEvents.ping,
        { spikeId },
        (result: unknown) => {
          if (
            isRecord(result) &&
            typeof result.serverReceivedAt === "string"
          ) {
            setLatestRttMs(performance.now() - startedAt);
          }
        },
      );
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [joined, spikeId]);

  const markObservedCapabilities = (event: PointerEvent) => {
    setCapabilities((current) => {
      const next = {
        ...current,
        coalescedEvents:
          current.coalescedEvents ||
          typeof event.getCoalescedEvents === "function",
        hoverObserved:
          current.hoverObserved ||
          (event.pointerType === "pen" && event.buttons === 0),
        pressureObserved:
          current.pressureObserved ||
          (event.pointerType === "pen" &&
            event.pressure > 0 &&
            event.pressure !== 0.5),
      };
      return shallowCapabilitiesEqual(current, next) ? current : next;
    });
  };

  const sendInk = (
    phase: CompanionSpikeInk["phase"],
    event: PointerEvent,
  ) => {
    const active = activeStrokeRef.current;
    const canvas = canvasRef.current;
    if (!active || !canvas || !joined) return;
    const points = collectCompanionSpikePoints(
      event,
      canvas.getBoundingClientRect(),
      active.startedAtMs,
    );
    const ink: CompanionSpikeInk = {
      phase,
      points,
      sentAtMs: performance.now(),
      sequence: active.sequence,
      spikeId,
      strokeId: active.strokeId,
    };
    active.sequence += 1;
    previousPointRef.current = drawCompanionSpikeInk(
      canvas,
      ink,
      previousPointRef.current,
    );
    pendingAckRef.current.set(
      `${ink.strokeId}:${ink.sequence}`,
      performance.now(),
    );
    socketRef.current?.emit(companionSpikeEvents.ink, ink);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!joined || activePointerRef.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = {
      sequence: 0,
      startedAtMs: event.nativeEvent.timeStamp,
      strokeId: createStrokeId(),
    };
    previousPointRef.current = undefined;
    markObservedCapabilities(event.nativeEvent);
    sendInk("start", event.nativeEvent);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    markObservedCapabilities(event.nativeEvent);
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    sendInk("move", event.nativeEvent);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    sendInk("end", event.nativeEvent);
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    previousPointRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <main className="companion-spike-page">
      <video
        aria-label="발표자 공유 화면"
        autoPlay
        muted
        playsInline
        ref={videoRef}
      />
      <div className="companion-spike-stage-grid" />
      <canvas
        aria-label="Apple Pencil 입력 영역"
        onPointerCancel={finishPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        ref={canvasRef}
      />
      <section className="companion-spike-hud">
        <strong>{status}</strong>
        <span>WebRTC: {peerState}</span>
        <span>
          RTT: {latestRttMs === null ? "—" : `${latestRttMs.toFixed(1)} ms`}
        </span>
        <span>
          Ink p95: {latency ? `${latency.p95Ms.toFixed(1)} ms` : "—"}
        </span>
        <span>
          pressure / hover: {formatBoolean(capabilities.pressureObserved)} /{" "}
          {formatBoolean(capabilities.hoverObserved)}
        </span>
      </section>
    </main>
  );
}

export function CompanionSpikeAudiencePage({ spikeId }: { spikeId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointByStrokeRef = useRef(new Map<string, CompanionSpikePoint>());
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    const registration = registerAudienceStreamBridge({
      identity: companionSpikeIdentity(spikeId),
      onAttach: (stream) => {
        setHasStream(true);
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => undefined);
      },
      onDetach: () => {
        setHasStream(false);
        if (videoRef.current) videoRef.current.srcObject = null;
      },
    });
    return () => {
      if (registration.ok) registration.unregister();
    };
  }, [spikeId]);

  useEffect(() => {
    const channel = new BroadcastChannel(companionSpikeChannelName(spikeId));
    const handleMessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (
        !isRecord(value) ||
        value.type !== "ink" ||
        !isCompanionSpikeInk(value.ink) ||
        value.ink.spikeId !== spikeId ||
        !canvasRef.current
      ) {
        return;
      }
      const previous = pointByStrokeRef.current.get(value.ink.strokeId);
      const next = drawCompanionSpikeInk(
        canvasRef.current,
        value.ink,
        previous,
      );
      if (next) pointByStrokeRef.current.set(value.ink.strokeId, next);
      else pointByStrokeRef.current.delete(value.ink.strokeId);
      channel.postMessage({
        appliedAtMs: performance.now(),
        sequence: value.ink.sequence,
        strokeId: value.ink.strokeId,
        type: "ink-applied",
      });
    };
    channel.addEventListener("message", handleMessage);
    channel.postMessage({ type: "audience-ready" });
    return () => {
      channel.removeEventListener("message", handleMessage);
      channel.close();
    };
  }, [spikeId]);

  return (
    <main className="companion-spike-page is-audience">
      <video autoPlay muted playsInline ref={videoRef} />
      <div className="companion-spike-stage-grid" />
      <canvas aria-label="청중 필기 overlay" ref={canvasRef} />
      {!hasStream ? (
        <p className="companion-spike-audience-message">화면 공유 대기</p>
      ) : null}
    </main>
  );
}

export function CompanionSpikeCapturePage({ spikeId }: { spikeId: string }) {
  const [status, setStatus] = useState("공유할 화면을 선택하세요.");
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const startCapture = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.opener) {
      setStatus("opener 또는 화면 캡처 API를 사용할 수 없습니다.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        void previewRef.current.play().catch(() => undefined);
      }
      const result = attachAudienceStreamToWindow({
        identity: companionSpikeIdentity(spikeId),
        shareEpochId: `share_spike_${spikeId}`,
        stream,
        targetWindow:
          window.opener as unknown as AudienceStreamBridgeWindow,
      });
      setStatus(
        result.ok
          ? "surface swap stream을 발표자 host와 iPad에 전달 중입니다."
          : `stream 전달 실패: ${result.code}`,
      );
    } catch {
      setStatus("화면 캡처가 취소되었거나 실패했습니다.");
    }
  };

  return (
    <main className="companion-spike-capture">
      <div>
        <p className="companion-spike-kicker">Task 0 · surface swap</p>
        <h1>원격 발표자 창에서 화면 캡처</h1>
        <p>{status}</p>
        <button onClick={startCapture} type="button">
          화면 선택 및 공유
        </button>
      </div>
      <video autoPlay muted playsInline ref={previewRef} />
    </main>
  );
}

async function applyCompanionSignal(input: {
  payload: CompanionSpikeSignal;
  peerRef: { current: RTCPeerConnection | null };
  pendingIce: RTCIceCandidateInit[];
  sendSignal: (signal: CompanionSpikeSignal["signal"]) => void;
  setPeerState: (state: string) => void;
  videoRef: { current: HTMLVideoElement | null };
}) {
  if (input.payload.signal.kind === "description") {
    if (input.payload.signal.description.type !== "offer") return;
    input.peerRef.current?.close();
    const peer = new RTCPeerConnection({ iceServers: [] });
    input.peerRef.current = peer;
    input.pendingIce.splice(0);
    const negotiationStartedAt = performance.now();
    peer.onicecandidate = (event) => {
      input.sendSignal(
        event.candidate
          ? { candidate: event.candidate.toJSON(), kind: "ice" }
          : { kind: "end" },
      );
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (!input.videoRef.current) return;
      input.videoRef.current.srcObject = stream;
      void input.videoRef.current.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      input.setPeerState(
        peer.connectionState === "connected"
          ? `연결됨 (${Math.round(performance.now() - negotiationStartedAt)} ms)`
          : peer.connectionState,
      );
    };
    await peer.setRemoteDescription(input.payload.signal.description);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    input.sendSignal({ description: answer, kind: "description" });
    for (const candidate of input.pendingIce.splice(0)) {
      await peer.addIceCandidate(candidate);
    }
    return;
  }

  if (input.payload.signal.kind === "ice") {
    const peer = input.peerRef.current;
    if (!peer || !peer.remoteDescription) {
      input.pendingIce.push(input.payload.signal.candidate);
      return;
    }
    await peer.addIceCandidate(input.payload.signal.candidate);
  }
}

function readCapabilities(spikeId: string): CompanionSpikeCapabilities {
  return {
    coalescedEvents: false,
    hoverObserved: false,
    pointerEvents: "PointerEvent" in window,
    pressureObserved: false,
    screenHeight: Math.round(window.screen.height),
    screenWidth: Math.round(window.screen.width),
    spikeId,
    touchPoints: navigator.maxTouchPoints,
    webRtc: "RTCPeerConnection" in window,
  };
}

function shallowCapabilitiesEqual(
  left: CompanionSpikeCapabilities,
  right: CompanionSpikeCapabilities,
) {
  return (
    left.coalescedEvents === right.coalescedEvents &&
    left.hoverObserved === right.hoverObserved &&
    left.pressureObserved === right.pressureObserved
  );
}

function createStrokeId() {
  return typeof crypto.randomUUID === "function"
    ? `stroke_${crypto.randomUUID()}`
    : `stroke_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function formatBoolean(value: boolean) {
  return value ? "yes" : "no";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
