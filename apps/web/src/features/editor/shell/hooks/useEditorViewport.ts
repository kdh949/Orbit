import type { DeckCanvas } from "@orbit/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fitEditorZoomState,
  persistProjectEditorZoom,
  resolveEditorStageScale,
  stepEditorZoom,
  type EditorZoomState
} from "../editorZoom";

type ProjectEditorZoomState = {
  projectId: string;
  zoom: EditorZoomState;
};

export function useEditorViewport(args: {
  canvas: DeckCanvas;
  isRightPanelOpen: boolean;
  projectId: string;
  setIsRightPanelOpen: (open: boolean) => void;
}) {
  const { canvas, isRightPanelOpen, projectId, setIsRightPanelOpen } = args;
  const [projectEditorZoom, setProjectEditorZoom] =
    useState<ProjectEditorZoomState>(() => ({
      projectId,
      zoom: fitEditorZoomState
    }));
  const zoom =
    projectEditorZoom.projectId === projectId
      ? projectEditorZoom.zoom
      : fitEditorZoomState;
  const [editorViewportWidth, setEditorViewportWidth] = useState<number | null>(null);
  const [canvasViewport, setCanvasViewport] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const wasCompactEditorLayoutRef = useRef(false);

  useEffect(() => {
    setProjectEditorZoom((current) =>
      current.projectId === projectId
        ? current
        : { projectId, zoom: fitEditorZoomState }
    );
  }, [projectId]);

  useEffect(() => {
    if (projectEditorZoom.projectId !== projectId) return;
    persistProjectEditorZoom(projectId, projectEditorZoom.zoom);
  }, [projectEditorZoom, projectId]);

  useEffect(() => {
    const syncEditorViewportWidth = () => setEditorViewportWidth(window.innerWidth);
    syncEditorViewportWidth();
    window.addEventListener("resize", syncEditorViewportWidth);
    return () => window.removeEventListener("resize", syncEditorViewportWidth);
  }, []);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const syncCanvasViewport = () => {
      setCanvasViewport({
        height: viewport.clientHeight,
        width: viewport.clientWidth
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncCanvasViewport);

    syncCanvasViewport();
    resizeObserver?.observe(viewport);
    window.addEventListener("resize", syncCanvasViewport);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncCanvasViewport);
    };
  }, []);

  const stageScale = useMemo(
    () =>
      resolveEditorStageScale(
        zoom,
        canvas.width,
        canvasViewport?.width ?? editorViewportWidth,
        canvas.height,
        canvasViewport?.height
      ),
    [canvas.height, canvas.width, canvasViewport, editorViewportWidth, zoom]
  );

  const changeStageScale = useCallback(
    (direction: "in" | "out") => {
      setProjectEditorZoom({
        projectId,
        zoom: { mode: "manual", scale: stepEditorZoom(stageScale, direction) }
      });
    },
    [projectId, stageScale]
  );

  const fitStageToViewport = useCallback(() => {
    setProjectEditorZoom({ projectId, zoom: fitEditorZoomState });
    const viewport = canvasViewportRef.current;
    if (viewport) {
      viewport.scrollTo({ left: 0, top: 0 });
    }
  }, [projectId]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const handleCanvasZoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      changeStageScale(event.deltaY < 0 ? "in" : "out");
    };

    viewport.addEventListener("wheel", handleCanvasZoom, { passive: false });
    return () => viewport.removeEventListener("wheel", handleCanvasZoom);
  }, [changeStageScale]);

  useEffect(() => {
    if (editorViewportWidth === null) return;

    const isCompactLayout = editorViewportWidth <= 860;
    if (
      isCompactLayout &&
      !wasCompactEditorLayoutRef.current &&
      isRightPanelOpen
    ) {
      setIsRightPanelOpen(false);
    }
    wasCompactEditorLayoutRef.current = isCompactLayout;
  }, [editorViewportWidth, isRightPanelOpen, setIsRightPanelOpen]);

  return {
    canvasViewportRef,
    editorViewportWidth,
    fitStageToViewport,
    isStageFitToViewport: zoom.mode === "fit",
    stageScale,
    zoom,
    zoomIn: () => changeStageScale("in"),
    zoomOut: () => changeStageScale("out")
  };
}
