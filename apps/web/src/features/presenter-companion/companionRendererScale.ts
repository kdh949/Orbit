import type { SurfaceSize } from "./surfaceGeometry";

const companionShellHorizontalInset = 2 * 20;
const companionShellVerticalInset = 112;

export function calculateCompanionRendererScale(
  canvas: SurfaceSize,
  viewport: SurfaceSize,
) {
  const availableWidth = Math.max(
    1,
    viewport.width - companionShellHorizontalInset,
  );
  const availableHeight = Math.max(
    1,
    viewport.height - companionShellVerticalInset,
  );
  return Math.min(
    availableWidth / canvas.width,
    availableHeight / canvas.height,
  );
}
