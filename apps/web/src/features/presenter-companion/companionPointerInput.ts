import type {
  PresentationCompanionPoint,
  PresentationCompanionStroke,
} from "@orbit/shared";

export type ActiveCompanionPointer = {
  pointerId: number;
  pointerType: string;
};

type PointerSampleLike = {
  clientX: number;
  clientY: number;
  height?: number;
  pointerId: number;
  pointerType: string;
  pressure: number;
  timeStamp: number;
  width?: number;
};

type PointerEventLike = PointerSampleLike & {
  getCoalescedEvents?: () => PointerSampleLike[];
};

export function shouldAcceptCompanionPointer(
  event: PointerSampleLike,
  active: ActiveCompanionPointer | null,
): boolean {
  if (active) {
    return active.pointerId === event.pointerId;
  }
  if (event.pointerType === "pen") return true;
  if (
    event.pointerType === "touch" &&
    Math.max(event.width ?? 0, event.height ?? 0) >= 48
  ) {
    return false;
  }
  return event.pointerType === "touch" || event.pointerType === "mouse";
}

export function getCompanionPointerPoints(
  event: PointerEventLike,
  bounds: Pick<DOMRect, "height" | "left" | "top" | "width">,
  startedAt: number,
): PresentationCompanionPoint[] {
  let samples: PointerSampleLike[] = [event];
  try {
    const coalesced = event.getCoalescedEvents?.();
    if (coalesced?.length) samples = coalesced;
  } catch {
    // Safari can expose getCoalescedEvents before it is callable.
  }
  return samples.map((sample) => ({
    x: normalize(sample.clientX, bounds.left, bounds.width),
    y: normalize(sample.clientY, bounds.top, bounds.height),
    pressure: resolvePointerPressure(sample),
    t: clamp(sample.timeStamp - startedAt, 0, 120_000),
  }));
}

export function findHitStrokeId(
  strokes: PresentationCompanionStroke[],
  point: Pick<PresentationCompanionPoint, "x" | "y">,
  threshold = 0.025,
): string | null {
  let nearest: { distance: number; strokeId: string } | null = null;
  for (const stroke of strokes) {
    for (let index = 0; index < stroke.points.length; index += 1) {
      const candidate = stroke.points[index]!;
      const previous = stroke.points[index - 1];
      const distance = previous
        ? distanceToSegment(point, previous, candidate)
        : Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (
        distance <= threshold &&
        (!nearest || distance < nearest.distance)
      ) {
        nearest = { distance, strokeId: stroke.strokeId };
      }
    }
  }
  return nearest?.strokeId ?? null;
}

function distanceToSegment(
  point: Pick<PresentationCompanionPoint, "x" | "y">,
  start: Pick<PresentationCompanionPoint, "x" | "y">,
  end: Pick<PresentationCompanionPoint, "x" | "y">,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const position = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) /
      (dx * dx + dy * dy),
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + position * dx),
    point.y - (start.y + position * dy),
  );
}

export function resolvePointerPressure(
  event: Pick<PointerSampleLike, "pointerType" | "pressure">,
): number {
  if (Number.isFinite(event.pressure) && event.pressure > 0) {
    return clamp(event.pressure, 0, 1);
  }
  return event.pointerType === "pen" ? 0.35 : 0.5;
}

function normalize(value: number, start: number, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return clamp((value - start) / size, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
