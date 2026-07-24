import type { PresentationCompanionStroke } from "@orbit/shared";

const annotationColorTokens = {
  "ink-black": "--redesign-color-on-surface",
  "ink-blue": "--redesign-color-info",
  "ink-red": "--redesign-color-error",
  "ink-green": "--redesign-color-success",
  "ink-yellow": "--redesign-color-warning",
} as const;

export function renderCompanionAnnotations(input: {
  canvas: HTMLCanvasElement;
  height: number;
  strokes: PresentationCompanionStroke[];
  width: number;
}) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  input.canvas.width = Math.round(input.width * ratio);
  input.canvas.height = Math.round(input.height * ratio);
  const context = input.canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, input.canvas.width, input.canvas.height);
  context.scale(ratio, ratio);
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of input.strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    context.save();
    context.globalAlpha = stroke.tool === "highlighter" ? 0.35 : 1;
    context.lineWidth = Math.max(
      1,
      stroke.width * Math.min(input.width, input.height),
    );
    context.strokeStyle = resolveAnnotationColor(
      input.canvas,
      stroke.color,
    );
    context.beginPath();
    context.moveTo(first.x * input.width, first.y * input.height);
    for (const point of stroke.points.slice(1)) {
      context.lineTo(point.x * input.width, point.y * input.height);
    }
    if (stroke.points.length === 1) {
      context.lineTo(first.x * input.width, first.y * input.height);
    }
    context.stroke();
    context.restore();
  }
}

function resolveAnnotationColor(
  element: Element,
  color: keyof typeof annotationColorTokens,
): string {
  const token = annotationColorTokens[color];
  return getComputedStyle(element).getPropertyValue(token).trim() ||
    "currentColor";
}
