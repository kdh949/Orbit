export type SurfaceSize = {
  height: number;
  width: number;
};

export type SurfaceRect = SurfaceSize & {
  x: number;
  y: number;
};

export function calculateContainRect(
  container: SurfaceSize,
  content: SurfaceSize,
): SurfaceRect {
  if (
    !isPositiveFinite(container.width) ||
    !isPositiveFinite(container.height) ||
    !isPositiveFinite(content.width) ||
    !isPositiveFinite(content.height)
  ) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }
  const scale = Math.min(
    container.width / content.width,
    container.height / content.height,
  );
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    height,
    width,
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
