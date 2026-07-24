import type {
  PresentationCompanionAnnotationAck,
  PresentationCompanionAnnotationSnapshot,
  PresentationCompanionOutputState,
  PresentationCompanionPoint,
  PresentationCompanionStroke,
} from "@orbit/shared";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { renderCompanionAnnotations } from "./annotationRender";
import {
  findHitStrokeId,
  getCompanionPointerPoints,
  shouldAcceptCompanionPointer,
  type ActiveCompanionPointer,
} from "./companionPointerInput";
import {
  companionStrokeWidthOptions,
  CompanionToolbar,
  type CompanionDrawingTool,
  type CompanionInkColor,
} from "./CompanionToolbar";
import type { CompanionAnnotationCommandInput } from "./useCompanionSocket";
import type { SurfaceRect } from "./surfaceGeometry";

type ActiveStroke = {
  frameId: number | null;
  pendingPoints: PresentationCompanionPoint[];
  pointer: ActiveCompanionPointer;
  mode: "draw" | "laser";
  startedAt: number;
  strokeId: string;
};

export function createCompanionStrokeStart(input: {
  clientOperationId: string;
  color: CompanionInkColor;
  point: PresentationCompanionPoint;
  strokeId: string;
  tool: "highlighter" | "pen";
  width: number;
}): {
  command: CompanionAnnotationCommandInput;
  localStroke: PresentationCompanionStroke;
} {
  return {
    command: {
      kind: "stroke-begin",
      clientOperationId: input.clientOperationId,
      strokeId: input.strokeId,
      tool: input.tool,
      color: input.color,
      width: input.width,
      point: input.point,
    },
    localStroke: {
      strokeId: input.strokeId,
      tool: input.tool,
      color: input.color,
      width: input.width,
      points: [input.point],
    },
  };
}

export function CompanionAnnotationCanvas(props: {
  annotation: PresentationCompanionAnnotationSnapshot | null;
  canWrite: boolean;
  connected: boolean;
  lastAcknowledgement: PresentationCompanionAnnotationAck | null;
  output: PresentationCompanionOutputState;
  sendCommand: (command: CompanionAnnotationCommandInput) => boolean;
  sendLaser: (
    input:
      | { kind: "hide" }
      | { kind: "move"; x: number; y: number },
  ) => boolean;
  surfaceRect?: SurfaceRect | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const [tool, setTool] = useState<CompanionDrawingTool>("pen");
  const [color, setColor] = useState<CompanionInkColor>("ink-blue");
  const [widths, setWidths] = useState({
    highlighter: 0.025,
    pen: 0.008,
  });
  const [localStrokes, setLocalStrokes] = useState<
    PresentationCompanionStroke[]
  >([]);
  const [hiddenStrokeIds, setHiddenStrokeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [clearOptimistic, setClearOptimistic] = useState(false);
  const [laserPoint, setLaserPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const surfaceId =
    props.output.outputMode === "black" ? null : props.output.surfaceId;
  const disabled =
    !props.canWrite ||
    !props.connected ||
    props.output.outputMode === "black";
  const selectedWidth =
    tool === "highlighter" ? widths.highlighter : widths.pen;
  const widthOptions =
    tool === "highlighter"
      ? companionStrokeWidthOptions.highlighter
      : companionStrokeWidthOptions.pen;
  const acceptedStrokes = props.annotation?.strokes ?? [];
  const visibleStrokes = useMemo(() => {
    const accepted = clearOptimistic
      ? []
      : acceptedStrokes.filter(
          (stroke) => !hiddenStrokeIds.has(stroke.strokeId),
        );
    return [...accepted, ...localStrokes];
  }, [
    acceptedStrokes,
    clearOptimistic,
    hiddenStrokeIds,
    localStrokes,
  ]);

  useEffect(() => {
    const acceptedIds = new Set(
      props.annotation?.strokes.map((stroke) => stroke.strokeId) ?? [],
    );
    setLocalStrokes((current) =>
      current.filter((stroke) => !acceptedIds.has(stroke.strokeId)),
    );
    setHiddenStrokeIds(new Set());
    setClearOptimistic(false);
  }, [
    props.annotation?.authorityEpochId,
    props.annotation?.surfaceId,
    props.annotation?.surfaceRevision,
  ]);

  useEffect(() => {
    if (props.lastAcknowledgement?.accepted !== false) return;
    setLocalStrokes([]);
    setHiddenStrokeIds(new Set());
    setClearOptimistic(false);
  }, [props.lastAcknowledgement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    renderCompanionAnnotations({
      canvas,
      height: Math.max(1, bounds.height),
      strokes: visibleStrokes,
      width: Math.max(1, bounds.width),
    });
  }, [visibleStrokes]);

  useEffect(() => {
    if (!disabled) return;
    const active = activeStrokeRef.current;
    if (active && active.frameId !== null) {
      cancelAnimationFrame(active.frameId);
    }
    if (active?.mode === "laser") {
      props.sendLaser({ kind: "hide" });
    }
    activeStrokeRef.current = null;
    setLocalStrokes([]);
    setHiddenStrokeIds(new Set());
    setClearOptimistic(false);
    setLaserPoint(null);
  }, [disabled, surfaceId]);

  useEffect(
    () => () => {
      const active = activeStrokeRef.current;
      if (active && active.frameId !== null) {
        cancelAnimationFrame(active.frameId);
      }
    },
    [],
  );

  const send = (command: CompanionAnnotationCommandInput) =>
    props.sendCommand(command);
  const flushPendingPoints = () => {
    const active = activeStrokeRef.current;
    if (!active) return;
    active.frameId = null;
    if (active.mode === "laser") {
      const point = active.pendingPoints.at(-1);
      active.pendingPoints.length = 0;
      if (point) {
        props.sendLaser({ kind: "move", x: point.x, y: point.y });
      }
      return;
    }
    while (active.pendingPoints.length > 0) {
      const points = active.pendingPoints.splice(0, 64);
      if (
        !send({
          kind: "stroke-points",
          clientOperationId: createOpaqueId("op"),
          strokeId: active.strokeId,
          points,
        })
      ) {
        active.pendingPoints.length = 0;
        return;
      }
    }
  };
  const scheduleFlush = () => {
    const active = activeStrokeRef.current;
    if (!active || active.frameId !== null) return;
    active.frameId = requestAnimationFrame(flushPendingPoints);
  };
  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (
      disabled ||
      !shouldAcceptCompanionPointer(event.nativeEvent, activeStrokeRef.current?.pointer ?? null)
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const startedAt = event.timeStamp;
    const points = getCompanionPointerPoints(
      event.nativeEvent,
      bounds,
      startedAt,
    );
    const first = points[0];
    if (!first) return;

    if (tool === "eraser") {
      const strokeId = findHitStrokeId(visibleStrokes, first);
      if (
        strokeId &&
        send({
          kind: "stroke-delete",
          clientOperationId: createOpaqueId("op"),
          strokeId,
        })
      ) {
        setLocalStrokes((current) =>
          current.filter((stroke) => stroke.strokeId !== strokeId),
        );
        setHiddenStrokeIds((current) => new Set(current).add(strokeId));
      }
      return;
    }
    if (tool === "laser") {
      if (!props.sendLaser({ kind: "move", x: first.x, y: first.y })) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      activeStrokeRef.current = {
        frameId: null,
        mode: "laser",
        pendingPoints: [],
        pointer: {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        },
        startedAt,
        strokeId: "laser",
      };
      setLaserPoint({ x: first.x, y: first.y });
      return;
    }

    const strokeId = createOpaqueId("stroke");
    const strokeStart = createCompanionStrokeStart({
      clientOperationId: createOpaqueId("op"),
      color,
      point: first,
      strokeId,
      tool,
      width: selectedWidth,
    });
    if (!send(strokeStart.command)) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activeStrokeRef.current = {
      frameId: null,
      mode: "draw",
      pendingPoints: [],
      pointer: {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
      },
      startedAt,
      strokeId,
    };
    setLocalStrokes((current) => [
      ...current,
      strokeStart.localStroke,
    ]);
  };
  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const active = activeStrokeRef.current;
    if (
      disabled ||
      !active ||
      !shouldAcceptCompanionPointer(event.nativeEvent, active.pointer)
    ) {
      return;
    }
    const points = getCompanionPointerPoints(
      event.nativeEvent,
      event.currentTarget.getBoundingClientRect(),
      active.startedAt,
    );
    if (points.length === 0) return;
    if (active.mode === "laser") {
      const point = points.at(-1)!;
      active.pendingPoints = [point];
      setLaserPoint({ x: point.x, y: point.y });
      scheduleFlush();
      return;
    }
    active.pendingPoints.push(...points);
    setLocalStrokes((current) =>
      current.map((stroke) =>
        stroke.strokeId === active.strokeId
          ? { ...stroke, points: [...stroke.points, ...points] }
          : stroke,
      ),
    );
    scheduleFlush();
  };
  const finishPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const active = activeStrokeRef.current;
    if (!active || active.pointer.pointerId !== event.pointerId) return;
    if (active.mode === "laser") {
      if (active.frameId !== null) cancelAnimationFrame(active.frameId);
      active.pendingPoints.length = 0;
      props.sendLaser({ kind: "hide" });
      setLaserPoint(null);
      activeStrokeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    if (active.frameId !== null) cancelAnimationFrame(active.frameId);
    flushPendingPoints();
    send({
      kind: "stroke-end",
      clientOperationId: createOpaqueId("op"),
      strokeId: active.strokeId,
    });
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const handleUndo = () => {
    if (
      !send({
        kind: "undo",
        clientOperationId: createOpaqueId("op"),
      })
    ) {
      return;
    }
    if (localStrokes.length > 0) {
      setLocalStrokes((current) => current.slice(0, -1));
      return;
    }
    const lastAccepted = acceptedStrokes
      .filter((stroke) => !hiddenStrokeIds.has(stroke.strokeId))
      .at(-1);
    if (lastAccepted) {
      setHiddenStrokeIds((current) =>
        new Set(current).add(lastAccepted.strokeId),
      );
    }
  };
  const handleClear = () => {
    if (
      send({
        kind: "clear-surface",
        clientOperationId: createOpaqueId("op"),
      })
    ) {
      setLocalStrokes([]);
      setClearOptimistic(true);
    }
  };

  if (props.output.outputMode === "black") return null;

  return (
    <>
      <canvas
        aria-label="iPad 주석 입력"
        className="presenter-companion-annotation-canvas"
        data-content-rect={
          props.output.outputMode === "screen-share" &&
          props.surfaceRect
            ? "contain"
            : "slide"
        }
        onPointerCancel={finishPointer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        ref={canvasRef}
        style={
          props.output.outputMode === "screen-share" &&
          props.surfaceRect
            ? {
                height: props.surfaceRect.height,
                left: props.surfaceRect.x,
                position: "absolute",
                top: props.surfaceRect.y,
                width: props.surfaceRect.width,
              }
            : undefined
        }
      />
      {laserPoint ? (
        <span
          aria-hidden="true"
          className="presenter-companion-local-laser"
          style={{
            left:
              props.output.outputMode === "screen-share" &&
              props.surfaceRect
                ? props.surfaceRect.x +
                  laserPoint.x * props.surfaceRect.width
                : `${laserPoint.x * 100}%`,
            top:
              props.output.outputMode === "screen-share" &&
              props.surfaceRect
                ? props.surfaceRect.y +
                  laserPoint.y * props.surfaceRect.height
                : `${laserPoint.y * 100}%`,
          }}
        />
      ) : null}
      <CompanionToolbar
        canClear={visibleStrokes.length > 0}
        canUndo={visibleStrokes.length > 0}
        color={color}
        disabled={disabled}
        onClear={handleClear}
        onColorChange={setColor}
        onToolChange={setTool}
        onUndo={handleUndo}
        onWidthChange={(width) => {
          if (tool !== "pen" && tool !== "highlighter") return;
          setWidths((current) => ({ ...current, [tool]: width }));
        }}
        tool={tool}
        width={selectedWidth}
        widthOptions={widthOptions}
      />
    </>
  );
}

function createOpaqueId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
