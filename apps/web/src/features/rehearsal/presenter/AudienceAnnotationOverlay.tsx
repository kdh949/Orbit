import type {
  Deck,
  PresentationCompanionAnnotationSnapshot,
  PresentationCompanionLaser,
  PresentationCompanionStroke,
} from "@orbit/shared";
import type { AudienceOutputMode } from "./presenterStateStore";
import {
  calculateContainRect,
  type SurfaceSize,
} from "../../presenter-companion/surfaceGeometry";

export function AudienceAnnotationOverlay(props: {
  canvas: Deck["canvas"];
  containerSize?: SurfaceSize;
  contentSize?: SurfaceSize | null;
  mode: AudienceOutputMode;
  laser?: PresentationCompanionLaser | null;
  scale: number;
  snapshot?: PresentationCompanionAnnotationSnapshot | null;
}) {
  const hasVisibleLaser =
    props.laser?.kind === "move" &&
    props.laser.surfaceId === props.snapshot?.surfaceId;
  if (
    props.mode === "black" ||
    !props.snapshot ||
    (props.mode === "screen-share" && !props.contentSize) ||
    (props.snapshot.strokes.length === 0 && !hasVisibleLaser)
  ) {
    return null;
  }
  const slideSize = {
    height: props.canvas.height * props.scale,
    width: props.canvas.width * props.scale,
  };
  const screenShareRect =
    props.mode === "screen-share" &&
    props.containerSize &&
    props.contentSize
      ? calculateContainRect(props.containerSize, props.contentSize)
      : null;
  const overlaySize = screenShareRect ?? slideSize;

  return (
    <svg
      aria-label="청중 주석"
      className="audience-annotation-overlay"
      data-surface-id={props.snapshot.surfaceId}
      data-surface-revision={props.snapshot.surfaceRevision}
      height={overlaySize.height}
      preserveAspectRatio="none"
      viewBox="0 0 1 1"
      style={
        screenShareRect
          ? {
              inset: "auto",
              left: screenShareRect.x,
              top: screenShareRect.y,
              transform: "none",
            }
          : undefined
      }
      width={overlaySize.width}
    >
      {props.snapshot.strokes.map((stroke) => (
        <path
          className={`audience-annotation-stroke audience-annotation-stroke--${stroke.color}`}
          d={createStrokePath(stroke)}
          fill="none"
          key={stroke.strokeId}
          opacity={stroke.tool === "highlighter" ? 0.35 : 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={stroke.width}
        />
      ))}
      {hasVisibleLaser && props.laser?.kind === "move" ? (
        <circle
          className="audience-laser-point"
          cx={props.laser.x}
          cy={props.laser.y}
          r={0.012}
        />
      ) : null}
    </svg>
  );
}

export function createStrokePath(
  stroke: PresentationCompanionStroke,
): string {
  const first = stroke.points[0];
  if (!first) return "";
  const commands = [`M ${first.x} ${first.y}`];
  if (stroke.points.length === 1) {
    commands.push(`L ${first.x} ${first.y}`);
  } else {
    for (const point of stroke.points.slice(1)) {
      commands.push(`L ${point.x} ${point.y}`);
    }
  }
  return commands.join(" ");
}
