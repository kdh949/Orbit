import { IconCheck, IconMicrophone, IconMicrophoneOff, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  getRehearsalMicrophoneAudioConstraints,
  readRehearsalMicrophoneDeviceId,
  writeRehearsalMicrophoneDeviceId,
} from "../RehearsalWorkspace";
import "./rehearsal-mic-check-modal.css";

type MicrophonePermission = "checking" | "granted" | "prompt" | "denied" | "unsupported";
const microphoneVoiceTimeoutMs = 8000;

export function RehearsalMicCheckModal(props: {
  onClose: () => void;
  onStart: () => void;
  onStartWithoutMicrophone: () => void;
}) {
  const [permission, setPermission] = useState<MicrophonePermission>("checking");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(readRehearsalMicrophoneDeviceId);
  const [error, setError] = useState("");
  const [heardVoice, setHeardVoice] = useState(false);
  const [voiceTimedOut, setVoiceTimedOut] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const voiceTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let permissionStatus: PermissionStatus | null = null;

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
        const update = () => setPermission(permissionStatus!.state as MicrophonePermission);
        update();
        permissionStatus.onchange = update;
        if (permissionStatus.state === "granted") void startMicrophone(selectedDeviceId);
      } catch {
        if (!cancelled) setPermission("prompt");
      }
    }

    void syncPermission();
    return () => {
      cancelled = true;
      if (permissionStatus) permissionStatus.onchange = null;
      stopMicrophone();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  async function startMicrophone(deviceId = "") {
    stopMicrophone();
    setError("");
    setHeardVoice(false);
    setVoiceTimedOut(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...getRehearsalMicrophoneAudioConstraints(),
          ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
        },
      });
      streamRef.current = stream;
      setPermission("granted");

      const audioDevices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      setDevices(audioDevices);
      const activeDeviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId;
      if (activeDeviceId) {
        setSelectedDeviceId(activeDeviceId);
        writeRehearsalMicrophoneDeviceId(activeDeviceId);
      }
      startWaveform(stream);
    } catch (cause) {
      setPermission(cause instanceof DOMException && cause.name === "NotAllowedError" ? "denied" : "prompt");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "브라우저에서 마이크 사용을 허용해 주세요."
          : "마이크에 연결하지 못했습니다. 다른 마이크를 선택해 주세요.",
      );
    }
  }

  function startWaveform(stream: MediaStream) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    audioContextRef.current = audioContext;
    const samples = new Uint8Array(analyser.fftSize);
    let detectedVoice = false;

    voiceTimeoutRef.current = window.setTimeout(() => {
      voiceTimeoutRef.current = null;
      if (!detectedVoice) setVoiceTimedOut(true);
    }, microphoneVoiceTimeoutMs);

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(scale, scale);
      analyser.getByteTimeDomainData(samples);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const styles = getComputedStyle(canvas);
      context.strokeStyle = styles.getPropertyValue("--redesign-color-primary").trim() || "#0090ff";
      context.lineWidth = 3;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      let energy = 0;
      samples.forEach((sample, index) => {
        const normalized = (sample - 128) / 128;
        energy += normalized * normalized;
        const x = (index / (samples.length - 1)) * bounds.width;
        const y = bounds.height / 2 + normalized * bounds.height * 0.42;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      if (!detectedVoice && Math.sqrt(energy / samples.length) > 0.025) {
        detectedVoice = true;
        if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
        voiceTimeoutRef.current = null;
        setVoiceTimedOut(false);
        setHeardVoice(true);
      }
      animationFrameRef.current = window.requestAnimationFrame(draw);
    };
    draw();
  }

  function stopMicrophone() {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    if (voiceTimeoutRef.current !== null) window.clearTimeout(voiceTimeoutRef.current);
    voiceTimeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  const permissionGranted = permission === "granted";
  const hasMicrophoneError = permission === "denied" || Boolean(error) || voiceTimedOut;

  return (
    <div className="rehearsal-mic-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section aria-labelledby="rehearsal-mic-modal-title" aria-modal="true" className="rehearsal-mic-modal" role="dialog">
        <div className="rehearsal-mic-modal-scroll">
        <header>
          <div>
            <h2 id="rehearsal-mic-modal-title">리허설 전 마이크를 확인해 주세요</h2>
            <p>음성이 잘 전달되는지 간단히 확인합니다.</p>
          </div>
          <button aria-label="닫기" className="rehearsal-mic-modal-close" onClick={props.onClose} type="button">
            <IconX size={20} />
          </button>
        </header>

        <div className={`rehearsal-mic-step${permissionGranted ? " rehearsal-mic-step-active" : ""}`}>
          <span className="rehearsal-mic-step-number">1</span>
          <div>
            <div className="rehearsal-mic-step-heading">
              <strong>마이크 권한</strong>
              {permissionGranted ? <span className="rehearsal-mic-success"><IconCheck size={14} /> 권한 허용됨</span> : null}
            </div>
            {permissionGranted ? (
              <label className="rehearsal-mic-device">
                <span>사용할 마이크</span>
                <select value={selectedDeviceId} onChange={(event) => void startMicrophone(event.target.value)}>
                  {devices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label || `마이크 ${index + 1}`}</option>
                  ))}
                </select>
              </label>
            ) : (
              <button className="rehearsal-mic-permission-button" onClick={() => void startMicrophone()} type="button">
                <IconMicrophone size={17} /> 마이크 권한 허용
              </button>
            )}
            {error ? <p className="rehearsal-mic-error" role="alert">{error}</p> : null}
          </div>
        </div>

        <div className={`rehearsal-mic-step${heardVoice ? " rehearsal-mic-step-active" : ""}`}>
          <span className="rehearsal-mic-step-number">2</span>
          <div>
            <div className="rehearsal-mic-step-heading">
              <strong>인식 확인</strong>
              <span className={hasMicrophoneError ? "rehearsal-mic-error-status" : heardVoice ? "rehearsal-mic-success" : undefined}>
                {hasMicrophoneError ? <IconMicrophoneOff size={14} /> : null}
                {heardVoice ? <IconCheck size={14} /> : null}
                {hasMicrophoneError ? "음성 감지에 실패했어요" : heardVoice ? "목소리가 잘 들려요" : permissionGranted ? "목소리를 들려주세요" : "권한 허용 후 확인"}
              </span>
            </div>
            <canvas aria-label="실시간 마이크 입력 파형" className="rehearsal-mic-waveform" ref={canvasRef} role="img" />
          </div>
        </div>

        {hasMicrophoneError || heardVoice ? (
          <p className={`rehearsal-mic-result${hasMicrophoneError ? " rehearsal-mic-result-error" : ""}`} role="status">
            {hasMicrophoneError ? "마이크 연결을 확인해 주세요!" : "리허설 준비 완료!"}
          </p>
        ) : null}

        <footer>
          <button disabled={!permissionGranted} onClick={() => { stopMicrophone(); props.onStart(); }} type="button">리허설 시작</button>
          <button className="rehearsal-mic-skip" onClick={() => { stopMicrophone(); props.onStartWithoutMicrophone(); }} type="button">마이크 없이 시작</button>
        </footer>
        </div>
      </section>
    </div>
  );
}
