import {
  IconCheck,
  IconMicrophone,
  IconMicrophoneOff,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  getRehearsalMicrophoneAudioConstraints,
  readRehearsalMicrophoneDeviceId,
  writeRehearsalMicrophoneDeviceId,
} from "../presenter-shell/microphoneSettings";
import "../rehearsal/preflight/rehearsal-mic-check-modal.css";

type PermissionState =
  | "checking"
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

export function PresentationMicCheckModal(props: {
  companionSetup?: ReactNode;
  onClose: () => void;
  onStart: () => void;
  onStartWithoutMicrophone: () => void;
}) {
  const [permission, setPermission] = useState<PermissionState>("checking");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    readRehearsalMicrophoneDeviceId,
  );
  const [error, setError] = useState("");
  const [heardVoice, setHeardVoice] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: globalThis.PermissionStatus | null = null;

    async function syncPermission() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermission("unsupported");
        return;
      }
      try {
        permissionStatus = await navigator.permissions?.query({
          name: "microphone" as PermissionName,
        });
        if (!permissionStatus || cancelled) {
          if (!cancelled) setPermission("prompt");
          return;
        }
        const update = () =>
          setPermission(permissionStatus!.state as PermissionState);
        update();
        permissionStatus.onchange = update;
        if (permissionStatus.state === "granted") {
          void startPreview(selectedDeviceId);
        }
      } catch {
        if (!cancelled) setPermission("prompt");
      }
    }

    void syncPermission();
    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
      stopPreview();
    };
  }, []);

  async function startPreview(deviceId = "") {
    stopPreview();
    setError("");
    setHeardVoice(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...getRehearsalMicrophoneAudioConstraints(),
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
        video: false,
      });
      streamRef.current = stream;
      setPermission("granted");
      const audioDevices = (
        await navigator.mediaDevices.enumerateDevices()
      ).filter((device) => device.kind === "audioinput");
      setDevices(audioDevices);
      const activeDeviceId =
        stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId;
      if (activeDeviceId) {
        setSelectedDeviceId(activeDeviceId);
        writeRehearsalMicrophoneDeviceId(activeDeviceId);
      }
      drawWaveform(stream);
    } catch (cause) {
      setPermission(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "denied"
          : "prompt",
      );
      setError(
        "브라우저에서 마이크 사용을 허용하거나 마이크 없이 시작해 주세요.",
      );
    }
  }

  function drawWaveform(stream: MediaStream) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(stream).connect(analyser);
    contextRef.current = context;
    const samples = new Uint8Array(analyser.fftSize);

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const drawing = canvas.getContext("2d");
      if (!drawing) return;
      analyser.getByteTimeDomainData(samples);
      drawing.clearRect(0, 0, bounds.width, bounds.height);
      drawing.strokeStyle = "#8dd4ff";
      drawing.lineWidth = 3;
      drawing.beginPath();
      let energy = 0;
      samples.forEach((sample, index) => {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
        const x = (index / (samples.length - 1)) * bounds.width;
        const y = bounds.height / 2 + normalized * bounds.height * 0.4;
        if (index === 0) drawing.moveTo(x, y);
        else drawing.lineTo(x, y);
      });
      drawing.stroke();
      if (Math.sqrt(energy / samples.length) > 0.025) setHeardVoice(true);
      animationRef.current = requestAnimationFrame(draw);
    };
    draw();
  }

  function stopPreview() {
    if (animationRef.current !== null)
      cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }

  return (
    <div className="rehearsal-mic-modal-backdrop">
      <section
        aria-labelledby="presentation-mic-title"
        aria-modal="true"
        className={`rehearsal-mic-modal${
          props.companionSetup
            ? " rehearsal-mic-modal-with-companion"
            : ""
        }`}
        role="dialog"
      >
        <div className="rehearsal-mic-modal-scroll">
          <header>
            <div>
              <h2 id="presentation-mic-title">
                발표 전 마이크를 확인해 주세요
              </h2>
              <p>발표 음성을 기록하면 종료 후 말하기 분석을 제공합니다.</p>
            </div>
            <button
              aria-label="닫기"
              className="rehearsal-mic-modal-close"
              onClick={props.onClose}
              type="button"
            >
              <IconX size={20} />
            </button>
          </header>
          <div
            className={`rehearsal-mic-step${permission === "granted" ? " rehearsal-mic-step-active" : ""}`}
          >
            <span className="rehearsal-mic-step-number">1</span>
            <div>
              <div className="rehearsal-mic-step-heading">
                <strong>마이크 권한</strong>
                {permission === "granted" ? (
                  <span className="rehearsal-mic-success">
                    <IconCheck size={14} /> 권한 허용됨
                  </span>
                ) : null}
              </div>
              {permission === "granted" ? (
                <label className="rehearsal-mic-device">
                  <span>사용할 마이크</span>
                  <select
                    value={selectedDeviceId}
                    onChange={(event) => void startPreview(event.target.value)}
                  >
                    {devices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `마이크 ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <button
                  className="rehearsal-mic-permission-button"
                  onClick={() => void startPreview()}
                  type="button"
                >
                  <IconMicrophone size={17} /> 마이크 권한 허용
                </button>
              )}
              {error ? (
                <p className="rehearsal-mic-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
          <div
            className={`rehearsal-mic-step${heardVoice ? " rehearsal-mic-step-active" : ""}`}
          >
            <span className="rehearsal-mic-step-number">2</span>
            <div>
              <div className="rehearsal-mic-step-heading">
                <strong>인식 확인</strong>
                <span
                  className={heardVoice ? "rehearsal-mic-success" : undefined}
                >
                  {heardVoice ? (
                    <IconCheck size={14} />
                  ) : (
                    <IconMicrophoneOff size={14} />
                  )}
                  {heardVoice ? "목소리가 잘 들려요" : "목소리를 들려주세요"}
                </span>
              </div>
              <canvas
                aria-label="실시간 마이크 입력 파형"
                className="rehearsal-mic-waveform"
                ref={canvasRef}
                role="img"
              />
            </div>
          </div>
          {props.companionSetup}
          <footer>
            <button
              disabled={permission !== "granted"}
              onClick={() => {
                stopPreview();
                props.onStart();
              }}
              type="button"
            >
              발표 시작
            </button>
            <button
              className="rehearsal-mic-skip"
              onClick={() => {
                stopPreview();
                props.onStartWithoutMicrophone();
              }}
              type="button"
            >
              마이크 없이 시작
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
