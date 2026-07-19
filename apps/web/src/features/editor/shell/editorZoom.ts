export const minimumManualEditorZoom = 0.25;
export const maximumManualEditorZoom = 2;
export const manualEditorZoomStep = 0.25;

const defaultEditorStageScale = 0.44;
const maximumFitEditorStageScale = 0.66;
const minimumFitEditorStageScale = 0.16;
const compactEditorBreakpoint = 760;
const compactEditorCanvasInset = 32;
const fittedEditorCanvasHorizontalInset = 52;
const fittedEditorCanvasVerticalInset = 88;
const editorZoomStoragePrefix = "orbit:editor-zoom:";

export type EditorZoomState =
  | { mode: "fit" }
  | { mode: "manual"; scale: number };

type EditorZoomStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export const fitEditorZoomState: Readonly<EditorZoomState> = Object.freeze({
  mode: "fit",
});

export function getEditorZoomStorageKey(projectId: string) {
  return `${editorZoomStoragePrefix}${encodeURIComponent(projectId)}`;
}

export function readProjectEditorZoom(
  projectId: string,
  storage?: Pick<EditorZoomStorage, "getItem">,
): EditorZoomState {
  try {
    const resolvedStorage = storage ?? getSessionStorage();
    if (!resolvedStorage) {
      return { mode: "fit" };
    }

    const serialized = resolvedStorage.getItem(getEditorZoomStorageKey(projectId));
    if (!serialized) {
      return { mode: "fit" };
    }

    const candidate = JSON.parse(serialized) as unknown;
    if (!isValidManualEditorZoom(candidate)) {
      return { mode: "fit" };
    }

    return candidate;
  } catch {
    return { mode: "fit" };
  }
}

export function persistProjectEditorZoom(
  projectId: string,
  state: EditorZoomState,
  storage?: Pick<EditorZoomStorage, "removeItem" | "setItem">,
) {
  try {
    const resolvedStorage = storage ?? getSessionStorage();
    if (!resolvedStorage) {
      return;
    }

    const key = getEditorZoomStorageKey(projectId);
    if (state.mode === "fit" || !isManualEditorZoomScale(state.scale)) {
      resolvedStorage.removeItem(key);
      return;
    }

    resolvedStorage.setItem(key, JSON.stringify(state));
  } catch {
    // sessionStorage can be unavailable in restricted browser contexts.
  }
}

export function resolveEditorStageScale(
  state: EditorZoomState,
  canvasWidth: number,
  viewportWidth: number | null,
  canvasHeight?: number,
  viewportHeight?: number | null,
) {
  if (state.mode === "manual" && isManualEditorZoomScale(state.scale)) {
    return state.scale;
  }

  return getResponsiveEditorStageScale(
    canvasWidth,
    viewportWidth,
    canvasHeight,
    viewportHeight,
  );
}

export function getResponsiveEditorStageScale(
  canvasWidth: number,
  viewportWidth: number | null,
  canvasHeight?: number,
  viewportHeight?: number | null,
) {
  if (
    viewportWidth &&
    viewportHeight &&
    canvasWidth > 0 &&
    canvasHeight &&
    canvasHeight > 0
  ) {
    const availableWidth = Math.max(
      0,
      viewportWidth - fittedEditorCanvasHorizontalInset,
    );
    const availableHeight = Math.max(
      0,
      viewportHeight - fittedEditorCanvasVerticalInset,
    );

    return Math.min(
      maximumFitEditorStageScale,
      Math.max(
        minimumFitEditorStageScale,
        Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight),
      ),
    );
  }

  if (!viewportWidth || viewportWidth > compactEditorBreakpoint || canvasWidth <= 0) {
    return defaultEditorStageScale;
  }

  const availableWidth = Math.max(0, viewportWidth - compactEditorCanvasInset);
  return Math.min(
    defaultEditorStageScale,
    Math.max(minimumFitEditorStageScale, availableWidth / canvasWidth),
  );
}

export function stepEditorZoom(
  currentScale: number,
  direction: "in" | "out",
) {
  const safeScale = Number.isFinite(currentScale)
    ? currentScale
    : minimumManualEditorZoom;
  const step = direction === "in" ? manualEditorZoomStep : -manualEditorZoomStep;
  const stepped = Math.round((safeScale + step) * 100) / 100;

  return Math.min(
    maximumManualEditorZoom,
    Math.max(minimumManualEditorZoom, stepped),
  );
}

export const getSteppedEditorZoomScale = stepEditorZoom;

function isValidManualEditorZoom(candidate: unknown): candidate is EditorZoomState {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  return record.mode === "manual" && isManualEditorZoomScale(record.scale);
}

function isManualEditorZoomScale(scale: unknown): scale is number {
  return (
    typeof scale === "number" &&
    Number.isFinite(scale) &&
    scale >= minimumManualEditorZoom &&
    scale <= maximumManualEditorZoom
  );
}

function getSessionStorage(): EditorZoomStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}
