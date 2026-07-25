import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CircleDot,
  Eraser,
  Highlighter,
  Laptop,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";

const COLORS = ["#1590ff", "#ff4d55", "#ffd037", "#42ce69", "#ffffff"];
const WIDTHS = [3, 6, 10, 16];

function InkCanvas({
  className = "",
  tool = "pen",
  color = COLORS[0],
  width = 6,
  strokes,
  setStrokes,
  children,
}) {
  const svgRef = useRef(null);
  const [activeStroke, setActiveStroke] = useState(null);
  const [laser, setLaser] = useState(null);

  const pointFromEvent = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 1000,
      y: ((event.clientY - rect.top) / rect.height) * 560,
    };
  };

  const beginStroke = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);

    if (tool === "laser") {
      setLaser(point);
      return;
    }

    if (tool === "eraser") {
      setStrokes([]);
      return;
    }

    setActiveStroke({
      id: `${Date.now()}-${event.pointerId}`,
      tool,
      color,
      width,
      points: [point],
    });
  };

  const moveStroke = (event) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointFromEvent(event);
    if (tool === "laser") {
      setLaser(point);
      return;
    }
    setActiveStroke((current) =>
      current ? { ...current, points: [...current.points, point] } : current,
    );
  };

  const endStroke = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (activeStroke?.points.length > 1) {
      setStrokes((current) => [...current, activeStroke]);
    }
    setActiveStroke(null);
    window.setTimeout(() => setLaser(null), 320);
  };

  const visibleStrokes = activeStroke ? [...strokes, activeStroke] : strokes;

  return (
    <div className={`ink-canvas ${className}`}>
      {children}
      <svg
        ref={svgRef}
        viewBox="0 0 1000 560"
        preserveAspectRatio="none"
        aria-label="필기 입력 영역"
        onPointerDown={beginStroke}
        onPointerMove={moveStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      >
        {visibleStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={stroke.tool === "highlighter" ? 0.45 : 1}
          />
        ))}
        {laser ? (
          <>
            <circle cx={laser.x} cy={laser.y} r="25" fill="#ff3b30" opacity="0.16" />
            <circle cx={laser.x} cy={laser.y} r="9" fill="#ff4d55" />
          </>
        ) : null}
      </svg>
    </div>
  );
}

function StepProgress({ step }) {
  const steps = ["iPad 연결", "입력 테스트", "준비 완료"];

  return (
    <ol className="step-progress" aria-label="기기 확인 진행 단계">
      {steps.map((label, index) => {
        const number = index + 1;
        const state = number < step ? "complete" : number === step ? "active" : "";
        return (
          <li key={label} className={state}>
            <span className="step-dot">{number < step ? <Check size={14} /> : number}</span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StatusRow({
  icon: Icon,
  tone,
  title,
  detail,
  readyDetail,
  status,
  pendingLabel = "확인 중",
  readyLabel = "확인됨",
}) {
  const ready = status === "ready";

  return (
    <div className="status-row">
      <span className={`status-icon ${tone}`}><Icon size={22} /></span>
      <span className="status-copy">
        <strong>{title}</strong>
        <small>{ready && readyDetail ? readyDetail : detail}</small>
      </span>
      <span className={`status-value ${ready ? "ready" : ""}`}>
        {ready ? <Check size={15} /> : <LoaderCircle size={16} className="spinner" />}
        {ready ? readyLabel : pendingLabel}
      </span>
    </div>
  );
}

function DesktopSetup({ phase, setPhase, strokes, setStrokes }) {
  const [completed, setCompleted] = useState(false);
  const statuses = useMemo(() => {
    if (phase === "ready" || completed) return ["ready", "ready", "ready"];
    if (phase === "screen") return ["ready", "ready", "checking"];
    if (phase === "secure") return ["ready", "checking", "checking"];
    return ["checking", "checking", "checking"];
  }, [completed, phase]);

  const restartPairing = () => {
    setCompleted(false);
    setStrokes([]);
    setPhase("pairing");
  };

  const finish = () => {
    setCompleted(true);
    setPhase("ready");
  };

  return (
    <section className="desktop-panel" aria-label="PC 기기 확인 화면">
      <header className="desktop-header">
        <div>
          <h1>발표 전 기기 확인</h1>
          <span>실전 발표</span>
        </div>
      </header>

      <StepProgress step={completed ? 3 : phase === "ready" ? 2 : 1} />

      <div className="pairing-panel">
        <div className="qr-side">
          <h2>iPad 카메라로 연결하세요</h2>
          <p>연결 코드는 2분 동안 한 번만 사용할 수 있어요.</p>
          <img className="qr-code" src="/assets/connection-qr.svg" alt="iPad 연결 QR 코드" />
          <button className="gradient-button compact" onClick={restartPairing}>
            새 연결 코드 만들기
          </button>
          <button className="text-button" onClick={() => setPhase("idle")}>나중에 연결</button>
        </div>
        <div className="status-side">
          <StatusRow
            icon={Wifi}
            tone="blue"
            title="iPad 연결"
            detail="iPad 연결 여부를 확인하는 중"
            readyDetail="발표 도우미와 연결되어 있어요"
            status={statuses[0]}
            pendingLabel="연결 확인 중"
            readyLabel="연결됨"
          />
          <StatusRow
            icon={Laptop}
            tone="purple"
            title="발표 화면"
            detail="iPad에 발표 화면을 전송하는 중"
            status={statuses[1]}
          />
          <StatusRow
            icon={Pencil}
            tone="violet"
            title="Apple Pencil 입력"
            detail="필기 입력을 확인하는 중"
            status={strokes.length ? "ready" : statuses[2]}
          />
        </div>
      </div>

      <div className="input-test">
        <div>
          <h2>필기 입력 테스트</h2>
          <p>여기에 한 번 그려보세요. 이 필기는 청중 화면에 표시되지 않아요.</p>
        </div>
        <InkCanvas
          className="desktop-ink"
          strokes={strokes}
          setStrokes={setStrokes}
          color="#087ef1"
          width={6}
        >
          {strokes.length === 0 ? (
            <img src="/assets/sample-stroke.svg" alt="" className="sample-stroke" />
          ) : null}
        </InkCanvas>
      </div>

      <button className="gradient-button finish-button" onClick={finish}>
        {completed ? <><Check size={20} /> 준비 완료</> : "기기 확인 완료"}
      </button>
      {completed ? <div className="success-toast"><Check size={16} /> 리허설 준비가 끝났어요.</div> : null}
    </section>
  );
}

const TOOL_ITEMS = [
  { id: "pen", label: "펜", icon: Pencil },
  { id: "highlighter", label: "형광펜", icon: Highlighter },
  { id: "eraser", label: "지우개", icon: Eraser },
  { id: "laser", label: "레이저", icon: Sparkles },
];

function ToolButton({ tool, active, onClick }) {
  const Icon = tool.icon;
  return (
    <button
      className={`tool-button ${active ? "active" : ""}`}
      aria-pressed={active}
      aria-label={tool.label}
      onClick={onClick}
    >
      <span><Icon size={23} /></span>
      <small>{tool.label}</small>
    </button>
  );
}

function PenPalette({ color, setColor, width, setWidth }) {
  return (
    <div className="pen-palette" aria-label="펜 설정">
      <img src="/assets/pen-preview.svg" alt="" />
      <div className="width-row">
        {WIDTHS.map((value) => (
          <button
            key={value}
            aria-label={`펜 굵기 ${value}`}
            className={width === value ? "selected" : ""}
            onClick={() => setWidth(value)}
          >
            <span style={{ width: value, height: value }} />
          </button>
        ))}
      </div>
      <div className="color-row">
        {COLORS.map((value) => (
          <button
            key={value}
            aria-label={`펜 색상 ${value}`}
            className={color === value ? "selected" : ""}
            style={{ "--swatch": value }}
            onClick={() => setColor(value)}
          />
        ))}
      </div>
    </div>
  );
}

function TabletStage({ connected, strokes, setStrokes }) {
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(6);

  const undo = () => setStrokes((current) => current.slice(0, -1));

  return (
    <section className="tablet-panel" aria-label="iPad 발표 도우미 화면">
      <header className="tablet-header">
        <span>리허설</span>
        <strong>iPad 발표 도우미</strong>
        <span className={`connection-state ${connected ? "connected" : ""}`}>
          <i />
          {connected ? "연결됨" : "연결 대기"}
        </span>
      </header>

      <div className="stage-body">
        <aside className="tool-rail" aria-label="필기 도구">
          {TOOL_ITEMS.map((item) => (
            <ToolButton
              key={item.id}
              tool={item}
              active={tool === item.id}
              onClick={() => setTool(item.id)}
            />
          ))}
          <span className="tool-divider" />
          <button className="tool-button" onClick={undo} aria-label="실행 취소">
            <span><RotateCcw size={22} /></span>
            <small>실행 취소</small>
          </button>
          <button className="tool-button" onClick={() => setStrokes([])} aria-label="전체 지우기">
            <span><Trash2 size={22} /></span>
            <small>전체 지우기</small>
          </button>
        </aside>

        {(tool === "pen" || tool === "highlighter") ? (
          <PenPalette
            color={color}
            setColor={setColor}
            width={width}
            setWidth={setWidth}
          />
        ) : null}

        <div className="presentation-stage">
          <img src="/assets/stage-orbits.svg" alt="" className="stage-orbits" />
          <div className="stage-message">
            <h2>더 빠르게 결정하고,<br />더 명확하게 실행하다</h2>
            <img src="/assets/stage-arrow.svg" alt="" className="stage-arrow" />
          </div>
          <InkCanvas
            className="stage-ink"
            tool={tool}
            color={color}
            width={width}
            strokes={strokes}
            setStrokes={setStrokes}
          />
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [phase, setPhase] = useState("pairing");
  const [desktopStrokes, setDesktopStrokes] = useState([]);
  const [tabletStrokes, setTabletStrokes] = useState([]);

  useEffect(() => {
    const nextPhase = {
      pairing: "secure",
      secure: "screen",
      screen: "ready",
    }[phase];

    if (!nextPhase) return undefined;
    const timer = window.setTimeout(() => setPhase(nextPhase), 700);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <main className="prototype-board">
      <DesktopSetup
        phase={phase}
        setPhase={setPhase}
        strokes={desktopStrokes}
        setStrokes={setDesktopStrokes}
      />
      <TabletStage
        connected={phase !== "idle"}
        strokes={tabletStrokes}
        setStrokes={setTabletStrokes}
      />
    </main>
  );
}
